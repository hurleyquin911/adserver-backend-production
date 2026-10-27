const { z } = require('zod');
const { Op, fn, col, literal } = require('sequelize');
const db = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { aggregateEvents } = require('../utils/aggregateEvents');
const env = require('../config/env');
const { mysqlOffset, nodeOffset, rangeStart, rangeEnd, formatInTz } = require('../utils/reportTz');
const { assertAdvertiserAccess, isUnscoped } = require('../utils/scope');
const { defaultFromTo, emptyTotals, addRow, withRates, legacySummary } = require('../utils/reportMetrics');
const { paceStatus } = require('../utils/pacing');

const filterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaign_id: z.coerce.number().int().positive().optional(),
  creative_id: z.coerce.number().int().positive().optional(),
  placement_id: z.coerce.number().int().positive().optional(),
  site_id: z.coerce.number().int().positive().optional(),
});

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  publisher_id: z.coerce.number().int().positive().optional(),
  creative_id: z.coerce.number().int().positive().optional(),
  size: z.string().max(12).optional(),
  device: z.string().max(64).optional(),
  granularity: z.enum(['day', 'hour']).optional(),
  by: z.enum(['publisher', 'campaign', 'creative', 'size', 'device', 'interaction']).optional(),
});

function daySqlExpr(column) {
  const fromOff = nodeOffset();
  const toOff = mysqlOffset(env.REPORT_TZ);
  return literal(`DATE(CONVERT_TZ(\`${column}\`, '${fromOff}', '${toOff}'))`);
}

function assertUnscoped(user) {
  if (!isUnscoped(user)) {
    throw new AppError('FORBIDDEN', 'Akses ditolak', 403);
  }
}

async function scopedCampaignIds(user) {
  if (isUnscoped(user)) return null;
  if (user.advertiser_id == null) return [];
  const rows = await db.Campaign.findAll({
    where: { advertiser_id: user.advertiser_id },
    attributes: ['id'],
  });
  return rows.map((r) => r.id);
}

async function assertReportIds(f, user) {
  if (f.campaign_id) {
    const camp = await db.Campaign.findByPk(f.campaign_id);
    if (!camp || !assertAdvertiserAccess(user, camp.advertiser_id)) {
      throw new AppError('NOT_FOUND', 'Campaign tidak ditemukan', 404);
    }
  }
  if (f.creative_id) {
    const creative = await db.Creative.findByPk(f.creative_id, {
      include: [{ model: db.Campaign, as: 'campaign' }],
    });
    if (!creative || !assertAdvertiserAccess(user, creative.campaign.advertiser_id)) {
      throw new AppError('NOT_FOUND', 'Creative tidak ditemukan', 404);
    }
  }
}

async function loadCampaignScoped(id, user) {
  const camp = await db.Campaign.findByPk(id, {
    include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
  });
  if (!camp || !assertAdvertiserAccess(user, camp.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Campaign tidak ditemukan', 404);
  }
  return camp;
}

async function buildWhere(query, user) {
  const f = filterSchema.parse(query);
  await assertReportIds(f, user);
  const where = {
    bucket_at: {
      [Op.between]: [rangeStart(f.from), rangeEnd(f.to)],
    },
  };
  if (f.campaign_id) where.campaign_id = f.campaign_id;
  if (f.creative_id) where.creative_id = f.creative_id;
  if (f.placement_id) where.placement_id = f.placement_id;

  const scoped = await scopedCampaignIds(user);
  if (scoped) {
    where.campaign_id = f.campaign_id
      ? { [Op.and]: [f.campaign_id, { [Op.in]: scoped }] }
      : { [Op.in]: scoped.length ? scoped : [0] };
  }

  if (f.site_id) {
    const placements = await db.Placement.findAll({
      where: { site_id: f.site_id },
      attributes: ['id'],
    });
    const placementIds = placements.map((p) => p.id);
    where.placement_id = {
      [Op.in]: placementIds.length ? placementIds : [0],
    };
    if (f.placement_id) {
      where.placement_id = placementIds.includes(f.placement_id) ? f.placement_id : 0;
    }
  }

  return { where, filters: f };
}

function campaignAggWhere(campaignId, parsed) {
  const where = {
    campaign_id: Number(campaignId),
    bucket_at: { [Op.between]: [rangeStart(parsed.from), rangeEnd(parsed.to)] },
  };
  if (parsed.publisher_id) where.publisher_id = parsed.publisher_id;
  if (parsed.creative_id) where.creative_id = parsed.creative_id;
  if (parsed.size) where.slot_size = parsed.size;
  if (parsed.device) where.device_type = parsed.device;
  return where;
}

function foldRows(rows) {
  const totals = emptyTotals();
  for (const r of rows) addRow(totals, r.type, r.total || r.count);
  return withRates(totals);
}

const summary = asyncHandler(async (req, res) => {
  const { where } = await buildWhere(req.query, req.user);
  const rows = await db.EventAggregate.findAll({
    attributes: ['type', [fn('SUM', col('count')), 'total']],
    where,
    group: ['type'],
    raw: true,
  });
  res.json({ data: legacySummary(rows) });
});

const byDay = asyncHandler(async (req, res) => {
  const { where } = await buildWhere(req.query, req.user);
  const dayExpr = daySqlExpr('bucket_at');
  const rows = await db.EventAggregate.findAll({
    attributes: [[dayExpr, 'day'], 'type', [fn('SUM', col('count')), 'total']],
    where,
    group: [dayExpr, 'type'],
    order: [[dayExpr, 'ASC']],
    raw: true,
  });
  res.json({ data: rows });
});

const byDevice = asyncHandler(async (req, res) => {
  const { where } = await buildWhere(req.query, req.user);
  const rows = await db.EventAggregate.findAll({
    attributes: [
      [fn('COALESCE', literal("NULLIF(device_type, '')"), 'unknown'), 'device_type'],
      'type',
      [fn('SUM', col('count')), 'total'],
    ],
    where,
    group: [literal("COALESCE(NULLIF(device_type, ''), 'unknown')"), 'type'],
    raw: true,
  });
  res.json({ data: rows });
});

const exportCsv = asyncHandler(async (req, res) => {
  const { where } = await buildWhere(req.query, req.user);
  const rows = await db.EventAggregate.findAll({
    where,
    order: [['bucket_at', 'ASC']],
    raw: true,
  });
  const header = 'bucket_at,campaign_id,creative_id,placement_id,publisher_id,device_type,slot_size,type,interaction_name,count\n';
  const body = rows
    .map(
      (r) =>
        `${formatInTz(r.bucket_at)},${r.campaign_id},${r.creative_id},${r.placement_id},${r.publisher_id},${r.device_type},${r.slot_size},${r.type},${r.interaction_name},${r.count}`
    )
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
  res.send(header + body);
});

const runAggregate = asyncHandler(async (req, res) => {
  const result = await aggregateEvents({ sinceHours: Number(req.query.hours || 48) });
  res.json(result);
});

async function lifetimeImpressions(campaignIds) {
  if (!campaignIds.length) return new Map();
  const rows = await db.EventAggregate.findAll({
    attributes: ['campaign_id', [fn('SUM', col('count')), 'total']],
    where: { campaign_id: { [Op.in]: campaignIds }, type: 'impression' },
    group: ['campaign_id'],
    raw: true,
  });
  const map = new Map();
  for (const r of rows) map.set(Number(r.campaign_id), Number(r.total) || 0);
  return map;
}

async function lifetimeCreativeImpressions(creativeIds) {
  if (!creativeIds.length) return new Map();
  const rows = await db.EventAggregate.findAll({
    attributes: ['creative_id', [fn('SUM', col('count')), 'total']],
    where: { creative_id: { [Op.in]: creativeIds }, type: 'impression' },
    group: ['creative_id'],
    raw: true,
  });
  const map = new Map();
  for (const r of rows) map.set(Number(r.creative_id), Number(r.total) || 0);
  return map;
}

const campaignsReport = asyncHandler(async (req, res) => {
  const parsed = rangeSchema.parse(req.query);
  const { from, to } = defaultFromTo(parsed);
  const scoped = await scopedCampaignIds(req.user);
  const campWhere = scoped ? { id: { [Op.in]: scoped.length ? scoped : [0] } } : {};
  const campaigns = await db.Campaign.findAll({
    where: campWhere,
    include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
    order: [['id', 'DESC']],
  });
  const ids = campaigns.map((c) => Number(c.id));
  const where = {
    campaign_id: { [Op.in]: ids.length ? ids : [0] },
    bucket_at: { [Op.between]: [rangeStart(from), rangeEnd(to)] },
  };
  const rows = await db.EventAggregate.findAll({
    attributes: ['campaign_id', 'type', [fn('SUM', col('count')), 'total']],
    where,
    group: ['campaign_id', 'type'],
    raw: true,
  });
  const byCamp = new Map();
  for (const r of rows) {
    const id = Number(r.campaign_id);
    if (!byCamp.has(id)) byCamp.set(id, emptyTotals());
    addRow(byCamp.get(id), r.type, r.total);
  }
  const deliveredMap = await lifetimeImpressions(ids);
  const now = new Date();
  const data = campaigns.map((c) => {
    const metrics = withRates(byCamp.get(Number(c.id)) || emptyTotals());
    const delivered = deliveredMap.get(Number(c.id)) || 0;
    const goal = c.impression_goal;
    const pct = goal ? Math.min(100, Number(((delivered / goal) * 100).toFixed(2))) : null;
    return {
      id: String(c.id),
      name: c.name,
      status: c.status,
      advertiser: c.advertiser
        ? { id: String(c.advertiser.id), name: c.advertiser.name }
        : null,
      start_date: c.start_date,
      end_date: c.end_date,
      priority: c.priority,
      impression_goal: goal,
      delivered,
      goal_pct: pct,
      pace_status: paceStatus({
        goal,
        delivered,
        startDate: c.start_date,
        endDate: c.end_date,
        now,
      }),
      metrics,
    };
  });
  res.json({ data, meta: { from, to } });
});

const creativesReport = asyncHandler(async (req, res) => {
  const parsed = rangeSchema.parse(req.query);
  const { from, to } = defaultFromTo(parsed);
  const scoped = await scopedCampaignIds(req.user);
  const campWhere = scoped ? { id: { [Op.in]: scoped.length ? scoped : [0] } } : undefined;
  const creatives = await db.Creative.findAll({
    include: [
      {
        model: db.Campaign,
        as: 'campaign',
        required: true,
        where: campWhere,
        include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
      },
    ],
    order: [['id', 'DESC']],
  });
  const ids = creatives.map((c) => Number(c.id));
  const where = {
    creative_id: { [Op.in]: ids.length ? ids : [0] },
    bucket_at: { [Op.between]: [rangeStart(from), rangeEnd(to)] },
  };
  const rows = await db.EventAggregate.findAll({
    attributes: ['creative_id', 'type', [fn('SUM', col('count')), 'total']],
    where,
    group: ['creative_id', 'type'],
    raw: true,
  });
  const byCreative = new Map();
  for (const r of rows) {
    const id = Number(r.creative_id);
    if (!byCreative.has(id)) byCreative.set(id, emptyTotals());
    addRow(byCreative.get(id), r.type, r.total);
  }
  const deliveredMap = await lifetimeCreativeImpressions(ids);
  const data = creatives.map((c) => {
    const metrics = withRates(byCreative.get(Number(c.id)) || emptyTotals());
    const delivered = deliveredMap.get(Number(c.id)) || 0;
    return {
      id: String(c.id),
      name: c.name,
      status: c.status,
      width: c.width,
      height: c.height,
      size: `${c.width}x${c.height}`,
      campaign: c.campaign
        ? {
            id: String(c.campaign.id),
            name: c.campaign.name,
            advertiser: c.campaign.advertiser
              ? { id: String(c.campaign.advertiser.id), name: c.campaign.advertiser.name }
              : null,
          }
        : null,
      delivered,
      metrics,
    };
  });
  res.json({ data, meta: { from, to } });
});

const campaignSummary = asyncHandler(async (req, res) => {
  const camp = await loadCampaignScoped(req.params.id, req.user);
  const parsed = rangeSchema.parse(req.query);
  const { from, to } = defaultFromTo(parsed);
  const rows = await db.EventAggregate.findAll({
    attributes: ['type', [fn('SUM', col('count')), 'total']],
    where: campaignAggWhere(camp.id, { ...parsed, from, to }),
    group: ['type'],
    raw: true,
  });
  const deliveredMap = await lifetimeImpressions([Number(camp.id)]);
  const delivered = deliveredMap.get(Number(camp.id)) || 0;
  const metrics = foldRows(rows);
  res.json({
    data: {
      campaign: {
        id: String(camp.id),
        name: camp.name,
        status: camp.status,
        start_date: camp.start_date,
        end_date: camp.end_date,
        priority: camp.priority,
        impression_goal: camp.impression_goal,
        advertiser: camp.advertiser
          ? { id: String(camp.advertiser.id), name: camp.advertiser.name }
          : null,
      },
      from,
      to,
      delivered,
      goal_pct: camp.impression_goal
        ? Math.min(100, Number(((delivered / camp.impression_goal) * 100).toFixed(2)))
        : null,
      pace_status: paceStatus({
        goal: camp.impression_goal,
        delivered,
        startDate: camp.start_date,
        endDate: camp.end_date,
      }),
      metrics,
    },
  });
});

const campaignTimeseries = asyncHandler(async (req, res) => {
  const camp = await loadCampaignScoped(req.params.id, req.user);
  const parsed = rangeSchema.parse(req.query);
  const { from, to } = defaultFromTo(parsed);
  const granularity = parsed.granularity || 'day';
  const where = campaignAggWhere(camp.id, { ...parsed, from, to });
  let rows;
  if (granularity === 'hour') {
    rows = await db.EventAggregate.findAll({
      attributes: ['bucket_at', 'type', [fn('SUM', col('count')), 'total']],
      where,
      group: ['bucket_at', 'type'],
      order: [['bucket_at', 'ASC']],
      raw: true,
    });
    rows = rows.map((r) => ({
      bucket: formatInTz(r.bucket_at),
      type: r.type,
      total: Number(r.total) || 0,
    }));
  } else {
    const dayExpr = daySqlExpr('bucket_at');
    const raw = await db.EventAggregate.findAll({
      attributes: [[dayExpr, 'day'], 'type', [fn('SUM', col('count')), 'total']],
      where,
      group: [dayExpr, 'type'],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });
    rows = raw.map((r) => ({
      bucket: r.day,
      type: r.type,
      total: Number(r.total) || 0,
    }));
  }
  res.json({ data: rows, meta: { from, to, granularity } });
});

const BREAKDOWN_FIELDS = {
  publisher: 'publisher_id',
  campaign: 'campaign_id',
  creative: 'creative_id',
  size: 'slot_size',
  device: 'device_type',
  interaction: 'interaction_name',
};

const campaignBreakdown = asyncHandler(async (req, res) => {
  const camp = await loadCampaignScoped(req.params.id, req.user);
  const parsed = rangeSchema.parse(req.query);
  const by = parsed.by || 'publisher';
  const field = BREAKDOWN_FIELDS[by];
  const { from, to } = defaultFromTo(parsed);
  const where = campaignAggWhere(camp.id, { ...parsed, from, to });
  if (by === 'interaction') {
    where.type = { [Op.in]: ['interaction'] };
  }
  const rows = await db.EventAggregate.findAll({
    attributes: [field, 'type', [fn('SUM', col('count')), 'total']],
    where,
    group: [field, 'type'],
    raw: true,
  });
  const grouped = new Map();
  for (const r of rows) {
    const key = String(r[field] ?? '');
    if (!grouped.has(key)) grouped.set(key, { key, ...emptyTotals() });
    addRow(grouped.get(key), r.type, r.total);
  }

  let labels = new Map();
  if (by === 'publisher') {
    const ids = [...grouped.keys()].map(Number).filter(Boolean);
    if (ids.length) {
      const pubs = await db.Publisher.findAll({ where: { id: { [Op.in]: ids } } });
      labels = new Map(pubs.map((p) => [String(p.id), p.host]));
    }
  } else if (by === 'creative') {
    const ids = [...grouped.keys()].map(Number).filter(Boolean);
    if (ids.length) {
      const crs = await db.Creative.findAll({ where: { id: { [Op.in]: ids } } });
      labels = new Map(crs.map((c) => [String(c.id), c.name]));
    }
  }

  const data = [...grouped.values()].map((row) => ({
    key: row.key,
    label: labels.get(row.key) || (row.key === '0' || row.key === '' ? '(tidak ada)' : row.key),
    metrics: withRates(row),
  }));
  res.json({ data, meta: { from, to, by } });
});

const campaignExport = asyncHandler(async (req, res) => {
  const camp = await loadCampaignScoped(req.params.id, req.user);
  const parsed = rangeSchema.parse(req.query);
  const by = parsed.by || 'publisher';
  const field = BREAKDOWN_FIELDS[by];
  const { from, to } = defaultFromTo(parsed);
  const where = campaignAggWhere(camp.id, { ...parsed, from, to });
  if (by === 'interaction') where.type = { [Op.in]: ['interaction'] };
  const rows = await db.EventAggregate.findAll({
    attributes: [field, 'type', [fn('SUM', col('count')), 'total']],
    where,
    group: [field, 'type'],
    raw: true,
  });
  const grouped = new Map();
  for (const r of rows) {
    const key = String(r[field] ?? '');
    if (!grouped.has(key)) grouped.set(key, { key, ...emptyTotals() });
    addRow(grouped.get(key), r.type, r.total);
  }
  const header = 'key,request,no_fill,impression,viewable_impression,click,interaction,interaction_unique,ctr,viewability_rate,interaction_rate\n';
  const lines = [...grouped.values()].map((row) => {
    const m = withRates(row);
    return [
      row.key,
      m.request,
      m.no_fill,
      m.impression,
      m.viewable_impression,
      m.click,
      m.interaction,
      m.interaction_unique,
      m.ctr,
      m.viewability_rate,
      m.interaction_rate,
    ].join(',');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campaign-${req.params.id}.csv"`);
  res.send(header + lines.join('\n'));
});

const publishersReport = asyncHandler(async (req, res) => {
  assertUnscoped(req.user);
  const parsed = rangeSchema.parse(req.query);
  const { from, to } = defaultFromTo(parsed);
  const where = {
    bucket_at: { [Op.between]: [rangeStart(from), rangeEnd(to)] },
  };
  const rows = await db.EventAggregate.findAll({
    attributes: ['publisher_id', 'type', [fn('SUM', col('count')), 'total']],
    where,
    group: ['publisher_id', 'type'],
    raw: true,
  });
  const grouped = new Map();
  for (const r of rows) {
    const id = Number(r.publisher_id) || 0;
    if (!grouped.has(id)) grouped.set(id, emptyTotals());
    addRow(grouped.get(id), r.type, r.total);
  }
  const pubs = await db.Publisher.findAll({ order: [['last_seen_at', 'DESC']] });
  const data = pubs.map((p) => ({
    id: String(p.id),
    host: p.host,
    status: p.status,
    first_seen_at: p.first_seen_at,
    last_seen_at: p.last_seen_at,
    metrics: withRates(grouped.get(Number(p.id)) || emptyTotals()),
  }));
  res.json({ data, meta: { from, to } });
});

function groupAggBy(rows, keyFn) {
  const grouped = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!grouped.has(key)) grouped.set(key, emptyTotals());
    addRow(grouped.get(key), r.type, r.total);
  }
  return grouped;
}

function sortByImpression(entries) {
  return entries.sort(
    (a, b) => (b.metrics.impression || 0) - (a.metrics.impression || 0)
  );
}

/** Slot publisher: prioritaskan yang paling sering diminta (termasuk no-fill). */
function sortByRequestThenImpression(entries) {
  return entries.sort((a, b) => {
    const reqDiff = (b.metrics.request || 0) - (a.metrics.request || 0);
    if (reqDiff) return reqDiff;
    return (b.metrics.impression || 0) - (a.metrics.impression || 0);
  });
}

const publisherDetailReport = asyncHandler(async (req, res) => {
  assertUnscoped(req.user);
  const pub = await db.Publisher.findByPk(req.params.id);
  if (!pub) throw new AppError('NOT_FOUND', 'Publisher tidak ditemukan', 404);
  const parsed = rangeSchema.parse(req.query);
  const { from, to } = defaultFromTo(parsed);
  const where = {
    publisher_id: pub.id,
    bucket_at: { [Op.between]: [rangeStart(from), rangeEnd(to)] },
  };

  const [campRows, creativeRows, sizeRows, deviceRows, dayRaw, totalRows] = await Promise.all([
    db.EventAggregate.findAll({
      attributes: ['campaign_id', 'type', [fn('SUM', col('count')), 'total']],
      where,
      group: ['campaign_id', 'type'],
      raw: true,
    }),
    db.EventAggregate.findAll({
      attributes: ['creative_id', 'type', [fn('SUM', col('count')), 'total']],
      where,
      group: ['creative_id', 'type'],
      raw: true,
    }),
    db.EventAggregate.findAll({
      attributes: ['slot_size', 'type', [fn('SUM', col('count')), 'total']],
      where,
      group: ['slot_size', 'type'],
      raw: true,
    }),
    db.EventAggregate.findAll({
      attributes: ['device_type', 'type', [fn('SUM', col('count')), 'total']],
      where,
      group: ['device_type', 'type'],
      raw: true,
    }),
    db.EventAggregate.findAll({
      attributes: [[daySqlExpr('bucket_at'), 'day'], 'type', [fn('SUM', col('count')), 'total']],
      where,
      group: [daySqlExpr('bucket_at'), 'type'],
      order: [[daySqlExpr('bucket_at'), 'ASC']],
      raw: true,
    }),
    db.EventAggregate.findAll({
      attributes: ['type', [fn('SUM', col('count')), 'total']],
      where,
      group: ['type'],
      raw: true,
    }),
  ]);

  const byCampaign = groupAggBy(campRows, (r) => Number(r.campaign_id) || 0);
  const byCreative = groupAggBy(creativeRows, (r) => Number(r.creative_id) || 0);
  const bySize = groupAggBy(sizeRows, (r) => String(r.slot_size || ''));
  const byDevice = groupAggBy(deviceRows, (r) => String(r.device_type || ''));

  const campIds = [...byCampaign.keys()].filter(Boolean);
  const creativeIds = [...byCreative.keys()].filter(Boolean);

  const [camps, creatives] = await Promise.all([
    campIds.length
      ? db.Campaign.findAll({
          where: { id: { [Op.in]: campIds } },
          include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
        })
      : [],
    creativeIds.length
      ? db.Creative.findAll({
          where: { id: { [Op.in]: creativeIds } },
          attributes: ['id', 'name', 'width', 'height', 'campaign_id'],
        })
      : [],
  ]);

  const campMeta = new Map(
    camps.map((c) => [
      Number(c.id),
      {
        name: c.name,
        status: c.status,
        advertiser: c.advertiser
          ? { id: String(c.advertiser.id), name: c.advertiser.name }
          : null,
      },
    ])
  );
  const creativeMeta = new Map(
    creatives.map((c) => [
      Number(c.id),
      {
        name: c.name,
        width: c.width,
        height: c.height,
        campaign_id: String(c.campaign_id),
      },
    ])
  );

  const campaigns = sortByImpression(
    [...byCampaign.entries()].map(([id, totals]) => {
      const meta = campMeta.get(id);
      return {
        campaign_id: String(id),
        name: meta?.name || (id === 0 ? '(tidak ada)' : `#${id}`),
        status: meta?.status || null,
        advertiser: meta?.advertiser || null,
        metrics: withRates(totals),
      };
    })
  );

  const creativeList = sortByImpression(
    [...byCreative.entries()].map(([id, totals]) => {
      const meta = creativeMeta.get(id);
      return {
        creative_id: String(id),
        name: meta?.name || (id === 0 ? '(tidak ada)' : `#${id}`),
        size: meta ? `${meta.width}x${meta.height}` : null,
        campaign_id: meta?.campaign_id || null,
        metrics: withRates(totals),
      };
    })
  );

  const sizes = sortByRequestThenImpression(
    [...bySize.entries()].map(([size, totals]) => ({
      size: size || '(tidak ada)',
      metrics: withRates(totals),
    }))
  );

  const devices = sortByImpression(
    [...byDevice.entries()].map(([device, totals]) => ({
      device: device || '(tidak diketahui)',
      metrics: withRates(totals),
    }))
  );

  const daily = dayRaw.map((r) => ({
    bucket: r.day,
    type: r.type,
    total: Number(r.total) || 0,
  }));

  res.json({
    data: {
      publisher: {
        id: String(pub.id),
        host: pub.host,
        status: pub.status,
        first_seen_at: pub.first_seen_at,
        last_seen_at: pub.last_seen_at,
        created_at: pub.created_at || pub.createdAt || null,
        updated_at: pub.updated_at || pub.updatedAt || null,
      },
      from,
      to,
      metrics: foldRows(totalRows),
      campaigns,
      creatives: creativeList,
      sizes,
      devices,
      daily,
    },
    meta: { from, to },
  });
});

const noFillReport = asyncHandler(async (req, res) => {
  assertUnscoped(req.user);
  const parsed = rangeSchema.parse(req.query);
  const { from, to } = defaultFromTo(parsed);
  const where = {
    bucket_at: { [Op.between]: [rangeStart(from), rangeEnd(to)] },
    type: { [Op.in]: ['request', 'no_fill'] },
  };
  const rows = await db.EventAggregate.findAll({
    attributes: ['publisher_id', 'slot_size', 'type', [fn('SUM', col('count')), 'total']],
    where,
    group: ['publisher_id', 'slot_size', 'type'],
    raw: true,
  });
  const grouped = new Map();
  for (const r of rows) {
    const key = `${r.publisher_id}|${r.slot_size || ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        publisher_id: Number(r.publisher_id) || 0,
        slot_size: r.slot_size || '',
        ...emptyTotals(),
      });
    }
    addRow(grouped.get(key), r.type, r.total);
  }
  const pubIds = [...new Set([...grouped.values()].map((g) => g.publisher_id).filter(Boolean))];
  const pubs = pubIds.length
    ? await db.Publisher.findAll({ where: { id: { [Op.in]: pubIds } } })
    : [];
  const hosts = new Map(pubs.map((p) => [Number(p.id), p.host]));
  const data = [...grouped.values()].map((g) => ({
    publisher_id: String(g.publisher_id),
    host: hosts.get(g.publisher_id) || (g.publisher_id ? `#${g.publisher_id}` : '(tidak diketahui)'),
    slot_size: g.slot_size || '(tidak ada)',
    metrics: withRates(g),
  }));
  res.json({ data, meta: { from, to } });
});

module.exports = {
  summary,
  byDay,
  byDevice,
  exportCsv,
  runAggregate,
  campaignsReport,
  creativesReport,
  campaignSummary,
  campaignTimeseries,
  campaignBreakdown,
  campaignExport,
  publishersReport,
  publisherDetailReport,
  noFillReport,
};
