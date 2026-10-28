const { Op, fn, col } = require('sequelize');
const { z } = require('zod');
const db = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { campaignScopeInclude } = require('../utils/scope');
const { rangeStart, rangeEnd } = require('../utils/reportTz');
const env = require('../config/env');
const { recordRateChange, normalizeRate } = require('../utils/billingRateHistory');

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Tanggal tidak valid');

const querySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
  })
  .refine((range) => range.from <= range.to, {
    message: 'Tanggal mulai harus sebelum atau sama dengan tanggal selesai',
    path: ['from'],
  });

const pricingChangeSchema = z.object({
  cpm_usd: z.preprocess(
    (value) => {
      if (value == null || value === '') return null;
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (!/^\d{1,6}(?:\.\d{1,4})?$/.test(normalized)) return Number.NaN;
        return Number(normalized);
      }
      return value;
    },
    z.number().finite().min(0).max(999999.9999).nullable()
  ),
  reason: z.string().trim().min(5).max(500),
});

function centsFor(impressions, cpmUsd) {
  return Math.round((Number(impressions) * Number(cpmUsd)) / 10);
}

async function loadBilling(query, user) {
  const { from, to } = querySchema.parse(query);
  const creatives = await db.Creative.findAll({
    include: [
      {
        model: db.Campaign,
        as: 'campaign',
        required: true,
        where: campaignScopeInclude(user),
        attributes: ['id', 'name', 'advertiser_id'],
        include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
      },
    ],
    order: [['id', 'DESC']],
  });

  const creativeIds = creatives.map((creative) => Number(creative.id));
  const aggregates = creativeIds.length
    ? await db.EventAggregate.findAll({
        attributes: ['creative_id', [fn('SUM', col('count')), 'impressions']],
        where: {
          creative_id: { [Op.in]: creativeIds },
          type: 'impression',
          bucket_at: { [Op.between]: [rangeStart(from, env.REPORT_TZ), rangeEnd(to, env.REPORT_TZ)] },
        },
        group: ['creative_id'],
        raw: true,
      })
    : [];
  const impressionsByCreative = new Map(
    aggregates.map((row) => [Number(row.creative_id), Number(row.impressions) || 0])
  );

  let totalImpressions = 0;
  let billableImpressions = 0;
  let totalAmountCents = 0;
  let unpricedCreativeCount = 0;
  const data = creatives.map((creative) => {
    const impressions = impressionsByCreative.get(Number(creative.id)) || 0;
    const cpmUsd = creative.cpm_usd == null ? null : Number(creative.cpm_usd);
    const amountCents = cpmUsd == null ? null : centsFor(impressions, cpmUsd);
    totalImpressions += impressions;
    if (cpmUsd == null) {
      unpricedCreativeCount += 1;
    } else {
      billableImpressions += impressions;
      totalAmountCents += amountCents;
    }

    return {
      id: String(creative.id),
      name: creative.name,
      size: `${creative.width}x${creative.height}`,
      campaign: {
        id: String(creative.campaign.id),
        name: creative.campaign.name,
      },
      impressions,
      cpm_usd: cpmUsd,
      amount_usd: amountCents == null ? null : amountCents / 100,
    };
  });

  return {
    data,
    summary: {
      total_impressions: totalImpressions,
      billable_impressions: billableImpressions,
      total_amount_usd: totalAmountCents / 100,
      unpriced_creative_count: unpricedCreativeCount,
    },
    meta: { from, to, timezone: env.REPORT_TZ, currency: 'USD' },
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const list = asyncHandler(async (req, res) => {
  res.json(await loadBilling(req.query, req.user));
});

const exportCsv = asyncHandler(async (req, res) => {
  const result = await loadBilling(req.query, req.user);
  const lines = [
    ['Creative', 'Campaign', 'Size', 'Impressions', 'CPM (USD)', 'Amount (USD)']
      .map(csvCell)
      .join(','),
    ...result.data.map((row) =>
      [
        row.name,
        row.campaign.name,
        row.size,
        row.impressions,
        row.cpm_usd == null ? 'Not configured' : row.cpm_usd.toFixed(4),
        row.amount_usd == null ? '' : row.amount_usd.toFixed(2),
      ]
        .map(csvCell)
        .join(',')
    ),
  ];
  const { from, to } = result.meta;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="billing-${from}-${to}.csv"`);
  res.send(lines.join('\r\n'));
});

const history = asyncHandler(async (req, res) => {
  const rows = await db.BillingRateHistory.findAll({
    include: [
      {
        model: db.Creative,
        as: 'creative',
        required: true,
        paranoid: false,
        attributes: ['id', 'name'],
        include: [
          {
            model: db.Campaign,
            as: 'campaign',
            required: true,
            where: campaignScopeInclude(req.user),
            attributes: ['id', 'name'],
          },
        ],
      },
      {
        model: db.User,
        as: 'changedBy',
        attributes: ['id', 'name', 'email'],
      },
    ],
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: 200,
  });

  res.json({
    data: rows.map((row) => ({
      id: String(row.id),
      creative: {
        id: String(row.creative.id),
        name: row.creative.name,
        campaign: {
          id: String(row.creative.campaign.id),
          name: row.creative.campaign.name,
        },
      },
      old_cpm_usd: normalizeRate(row.old_cpm_usd),
      new_cpm_usd: normalizeRate(row.new_cpm_usd),
      reason: row.reason,
      changed_by: row.changedBy
        ? { id: String(row.changedBy.id), name: row.changedBy.name }
        : null,
      changed_at: row.created_at,
    })),
  });
});

const updatePricing = asyncHandler(async (req, res) => {
  const body = pricingChangeSchema.parse(req.body);
  const updated = await db.sequelize.transaction(async (transaction) => {
    const creative = await db.Creative.findByPk(req.params.creativeId, {
      include: [{ model: db.Campaign, as: 'campaign' }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!creative || !creative.campaign) {
      throw new AppError('NOT_FOUND', 'Creative tidak ditemukan', 404);
    }

    const oldRate = creative.cpm_usd;
    await creative.update({ cpm_usd: body.cpm_usd }, { transaction });
    const historyRow = await recordRateChange({
      creativeId: creative.id,
      oldRate,
      newRate: creative.cpm_usd,
      changedBy: req.user.id,
      reason: body.reason,
      transaction,
    });
    return { creative, changed: Boolean(historyRow) };
  });

  res.json({
    data: {
      id: String(updated.creative.id),
      cpm_usd: normalizeRate(updated.creative.cpm_usd),
      changed: updated.changed,
    },
  });
});

module.exports = { list, exportCsv, history, updatePricing, loadBilling, centsFor, csvCell };
