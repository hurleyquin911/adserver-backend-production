const { z } = require('zod');
const { Op, fn, col } = require('sequelize');
const db = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { rangeStart, rangeEnd } = require('../utils/reportTz');
const { defaultFromTo, emptyTotals, addRow, withRates } = require('../utils/reportMetrics');
const {
  invalidatePublisherCache,
  normalizePublisherHost,
  isUnknownHost,
  UNKNOWN_HOST,
  upsertAdvertiserPublisher,
} = require('../utils/publisherIdentity');
const { COMMON_SLOT_SIZES } = require('../constant/slotSizes');
const { countEligibleBySize } = require('../utils/universalSelect');
const { sizeKey } = require('../utils/slotSize');
const {
  assertAdvertiserAccess,
  isUnscoped,
  advertiserScopeWhere,
} = require('../utils/scope');

const statusEnum = z.enum(['active', 'pending', 'blocked']);

const createSchema = z.object({
  host: z.string().min(1).max(255),
  status: statusEnum.default('active'),
  advertiser_id: z.coerce.number().int().positive().optional(),
});

const updateSchema = z
  .object({
    host: z.string().min(1).max(255).optional(),
    status: statusEnum.optional(),
    advertiser_id: z.coerce.number().int().positive().optional(),
  })
  .refine((body) => body.host != null || body.status != null, {
    message: 'Minimal satu field: host atau status',
  });

function serialize(row, metrics, detectedSizes, extra = {}) {
  return {
    id: String(row.id),
    host: row.host,
    status: extra.status || row.status,
    first_seen_at: extra.first_seen_at || row.first_seen_at,
    last_seen_at: extra.last_seen_at || row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    advertiser_id: extra.advertiser_id != null ? String(extra.advertiser_id) : null,
    advertiser_name: extra.advertiser_name || null,
    metrics: metrics || undefined,
    detected_sizes: detectedSizes || [],
  };
}

function parseHost(raw) {
  const host = normalizePublisherHost(raw);
  if (isUnknownHost(host) || host === UNKNOWN_HOST) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Host tidak valid. Contoh: publisher.com, news.example, localhost:5500',
      400
    );
  }
  return host;
}

/** Brand filter: wajib untuk non-SA; opsional untuk SA via query. */
function resolveListAdvertiserId(req) {
  const raw = req.query.advertiser_id;
  if (raw != null && String(raw).trim() !== '') {
    const id = Number(raw);
    if (!Number.isFinite(id) || id < 1) {
      throw new AppError('VALIDATION_ERROR', 'advertiser_id tidak valid', 400);
    }
    if (!assertAdvertiserAccess(req.user, id)) {
      throw new AppError('FORBIDDEN', 'Tidak punya akses ke brand ini', 403);
    }
    return id;
  }
  if (!isUnscoped(req.user)) {
    if (req.user.advertiser_id == null) {
      throw new AppError('FORBIDDEN', 'Akun belum terikat brand', 403);
    }
    return Number(req.user.advertiser_id);
  }
  return null;
}

const list = asyncHandler(async (req, res) => {
  const { from, to } = defaultFromTo(req.query);
  const advertiserId = resolveListAdvertiserId(req);

  let rows;
  let linkByPubId = new Map();

  if (advertiserId != null) {
    const links = await db.AdvertiserPublisher.findAll({
      where: { advertiser_id: advertiserId },
      include: [{ model: db.Publisher, as: 'publisher', required: true }],
      order: [['last_seen_at', 'DESC']],
    });
    const advertiser = await db.Advertiser.findByPk(advertiserId);
    rows = links.map((l) => {
      linkByPubId.set(Number(l.publisher_id), {
        status: l.status,
        first_seen_at: l.first_seen_at,
        last_seen_at: l.last_seen_at,
        advertiser_id: advertiserId,
        advertiser_name: advertiser?.name || null,
      });
      return l.publisher;
    });
  } else {
    rows = await db.Publisher.findAll({ order: [['last_seen_at', 'DESC']] });
  }

  const ids = rows.map((r) => Number(r.id));
  const aggWhere = {
    publisher_id: { [Op.in]: ids },
    bucket_at: { [Op.between]: [rangeStart(from), rangeEnd(to)] },
    type: { [Op.in]: ['request', 'impression', 'click'] },
  };
  const agg = ids.length
    ? await db.EventAggregate.findAll({
        attributes: ['publisher_id', 'type', [fn('SUM', col('count')), 'total']],
        where: aggWhere,
        group: ['publisher_id', 'type'],
        raw: true,
      })
    : [];
  const byPub = new Map();
  for (const r of agg) {
    const id = Number(r.publisher_id);
    if (!byPub.has(id)) byPub.set(id, emptyTotals());
    addRow(byPub.get(id), r.type, r.total);
  }

  const sizesByPub = new Map();
  if (ids.length) {
    const eventWhere = {
      publisher_id: { [Op.in]: ids },
      type: 'request',
      slot_size: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
    };
    if (advertiserId != null) {
      eventWhere.advertiser_id = advertiserId;
    }
    const eventSizes = await db.Event.findAll({
      attributes: ['publisher_id', 'slot_size', [fn('COUNT', col('id')), 'total']],
      where: eventWhere,
      group: ['publisher_id', 'slot_size'],
      raw: true,
    });
    for (const r of eventSizes) {
      const publisherId = Number(r.publisher_id);
      const size = r.slot_size;
      if (!size) continue;
      if (!sizesByPub.has(publisherId)) sizesByPub.set(publisherId, new Map());
      sizesByPub.get(publisherId).set(size, Number(r.total) || 0);
    }
  }

  const eligible = await countEligibleBySize(
    advertiserId != null ? { advertiserId } : {}
  );
  const eligibleMap = new Map(eligible.map((s) => [s.size, s.count]));
  const sizeSeen = new Set();
  const placement_sizes = [];

  for (const s of COMMON_SLOT_SIZES) {
    const size = sizeKey(s.width, s.height);
    sizeSeen.add(size);
    const count = eligibleMap.get(size) || 0;
    placement_sizes.push({
      size,
      width: s.width,
      height: s.height,
      eligible_count: count,
      active: count > 0,
    });
  }
  for (const row of eligible) {
    if (sizeSeen.has(row.size)) continue;
    const [w, h] = row.size.split('x').map(Number);
    placement_sizes.push({
      size: row.size,
      width: w,
      height: h,
      eligible_count: row.count,
      active: true,
    });
  }
  placement_sizes.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (b.eligible_count !== a.eligible_count) return b.eligible_count - a.eligible_count;
    return a.size.localeCompare(b.size);
  });

  const pendingCount = rows.filter((r) => {
    const extra = linkByPubId.get(Number(r.id));
    return (extra?.status || r.status) === 'pending';
  }).length;

  // Brand list untuk filter Superadmin
  let brands = [];
  if (isUnscoped(req.user)) {
    brands = await db.Advertiser.findAll({
      where: advertiserScopeWhere(req.user, 'id'),
      attributes: ['id', 'name', 'status'],
      order: [['name', 'ASC']],
    });
  }

  res.json({
    data: rows.map((r) => {
      const id = Number(r.id);
      const sizeMap = sizesByPub.get(id);
      const detected_sizes = sizeMap
        ? [...sizeMap.entries()]
            .map(([size, requests]) => ({ size, requests }))
            .sort((a, b) => b.requests - a.requests || a.size.localeCompare(b.size))
        : [];
      const extra = linkByPubId.get(id) || {};
      return serialize(r, withRates(byPub.get(id) || emptyTotals()), detected_sizes, extra);
    }),
    meta: {
      from,
      to,
      pending_count: pendingCount,
      placement_sizes,
      active_sizes: placement_sizes.filter((s) => s.active).map((s) => s.size),
      advertiser_id: advertiserId != null ? String(advertiserId) : null,
      brands: brands.map((b) => ({
        id: String(b.id),
        name: b.name,
        status: b.status,
      })),
    },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await db.Publisher.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Publisher tidak ditemukan', 404);
  const advertiserId = resolveListAdvertiserId(req);
  let extra = {};
  if (advertiserId != null) {
    const link = await db.AdvertiserPublisher.findOne({
      where: { advertiser_id: advertiserId, publisher_id: row.id },
    });
    if (!link) throw new AppError('NOT_FOUND', 'Publisher tidak ditemukan untuk brand ini', 404);
    const advertiser = await db.Advertiser.findByPk(advertiserId);
    extra = {
      status: link.status,
      first_seen_at: link.first_seen_at,
      last_seen_at: link.last_seen_at,
      advertiser_id: advertiserId,
      advertiser_name: advertiser?.name || null,
    };
  }
  res.json({ data: serialize(row, undefined, undefined, extra) });
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const host = parseHost(body.host);
  let advertiserId = body.advertiser_id != null ? Number(body.advertiser_id) : null;
  if (!isUnscoped(req.user)) {
    advertiserId = Number(req.user.advertiser_id);
  }
  if (advertiserId == null) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Pilih brand (advertiser_id) saat menambah publisher',
      400
    );
  }
  if (!assertAdvertiserAccess(req.user, advertiserId)) {
    throw new AppError('FORBIDDEN', 'Tidak punya akses ke brand ini', 403);
  }

  const now = new Date();
  let row = await db.Publisher.findOne({ where: { host } });
  if (!row) {
    row = await db.Publisher.create({
      host,
      status: body.status,
      first_seen_at: now,
      last_seen_at: now,
    });
    invalidatePublisherCache(host);
  }

  const existingLink = await db.AdvertiserPublisher.findOne({
    where: { advertiser_id: advertiserId, publisher_id: row.id },
  });
  if (existingLink) {
    throw new AppError('CONFLICT', 'Publisher ini sudah terdaftar untuk brand tersebut', 409);
  }

  const link = await db.AdvertiserPublisher.create({
    advertiser_id: advertiserId,
    publisher_id: row.id,
    status: body.status,
    first_seen_at: now,
    last_seen_at: now,
  });
  const advertiser = await db.Advertiser.findByPk(advertiserId);
  res.status(201).json({
    data: serialize(row, undefined, undefined, {
      status: link.status,
      first_seen_at: link.first_seen_at,
      last_seen_at: link.last_seen_at,
      advertiser_id: advertiserId,
      advertiser_name: advertiser?.name || null,
    }),
  });
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const row = await db.Publisher.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Publisher tidak ditemukan', 404);

  let advertiserId =
    body.advertiser_id != null ? Number(body.advertiser_id) : resolveListAdvertiserId(req);
  if (!isUnscoped(req.user)) {
    advertiserId = Number(req.user.advertiser_id);
  }

  const oldHost = row.host;
  if (body.host != null) {
    const host = parseHost(body.host);
    if (host !== oldHost) {
      const clash = await db.Publisher.findOne({
        where: { host, id: { [Op.ne]: row.id } },
      });
      if (clash) {
        throw new AppError('CONFLICT', 'Publisher dengan host ini sudah ada', 409);
      }
      row.host = host;
    }
  }

  // Update status pada relasi brand jika ada konteks brand
  let link = null;
  if (advertiserId != null) {
    link = await db.AdvertiserPublisher.findOne({
      where: { advertiser_id: advertiserId, publisher_id: row.id },
    });
    if (!link) {
      link = await upsertAdvertiserPublisher(advertiserId, row);
    }
    if (body.status != null) {
      link.status = body.status;
      await link.save();
    }
  } else if (body.status != null) {
    row.status = body.status;
  }

  await row.save();
  invalidatePublisherCache(Number(row.id));
  invalidatePublisherCache(oldHost);
  invalidatePublisherCache(row.host);

  const advertiser = advertiserId != null ? await db.Advertiser.findByPk(advertiserId) : null;
  res.json({
    data: serialize(row, undefined, undefined, link
      ? {
          status: link.status,
          first_seen_at: link.first_seen_at,
          last_seen_at: link.last_seen_at,
          advertiser_id: advertiserId,
          advertiser_name: advertiser?.name || null,
        }
      : {}),
  });
});

const remove = asyncHandler(async (req, res) => {
  const row = await db.Publisher.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Publisher tidak ditemukan', 404);

  const advertiserId = resolveListAdvertiserId(req);
  // Non-SA / dengan brand: hanya putus relasi brand, jangan hapus host global
  if (advertiserId != null) {
    await db.AdvertiserPublisher.destroy({
      where: { advertiser_id: advertiserId, publisher_id: row.id },
    });
    res.json({ ok: true, unlinked: true });
    return;
  }

  if (!isUnscoped(req.user)) {
    throw new AppError('FORBIDDEN', 'Tidak boleh menghapus publisher global', 403);
  }

  const id = Number(row.id);
  const host = row.host;
  await db.sequelize.transaction(async (transaction) => {
    await db.AdvertiserPublisher.destroy({ where: { publisher_id: id }, transaction });
    await db.EventAggregate.destroy({ where: { publisher_id: id }, transaction });
    await row.destroy({ transaction });
  });
  invalidatePublisherCache(id);
  invalidatePublisherCache(host);
  res.json({ ok: true });
});

module.exports = { list, getOne, create, update, remove };
