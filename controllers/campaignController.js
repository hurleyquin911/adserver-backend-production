const { z } = require('zod');
const { Op, fn, col } = require('sequelize');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { campaignScopeInclude, assertAdvertiserAccess, mergeWhere } = require('../utils/scope');
const { resetEligibleCache } = require('../utils/universalSelect');

const schema = z
  .object({
    advertiser_id: z.coerce.number().int().positive(),
    name: z.string().min(1).max(255),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['draft', 'active', 'paused', 'ended']).default('draft'),
    priority: z.coerce.number().int().min(1).max(100).default(1),
    impression_goal: z.coerce.number().int().positive().nullable().optional(),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: 'end_date harus >= start_date',
    path: ['end_date'],
  });

function serialize(row, delivered, creativeCount) {
  return {
    id: String(row.id),
    advertiser_id: String(row.advertiser_id),
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    priority: row.priority,
    impression_goal: row.impression_goal,
    delivered: delivered != null ? delivered : undefined,
    creative_count: creativeCount != null ? creativeCount : undefined,
    advertiser: row.advertiser
      ? { id: String(row.advertiser.id), name: row.advertiser.name }
      : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const list = asyncHandler(async (req, res) => {
  const status = req.query.status;
  const where = mergeWhere(
    campaignScopeInclude(req.user),
    status ? { status } : {}
  );
  const rows = await db.Campaign.findAll({
    where,
    include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
    order: [['id', 'DESC']],
  });
  const ids = rows.map((r) => Number(r.id));
  const deliveredMap = new Map();
  const creativeCountMap = new Map();
  if (ids.length) {
    const agg = await db.EventAggregate.findAll({
      attributes: ['campaign_id', [fn('SUM', col('count')), 'total']],
      where: { campaign_id: { [Op.in]: ids }, type: 'impression' },
      group: ['campaign_id'],
      raw: true,
    });
    for (const r of agg) deliveredMap.set(Number(r.campaign_id), Number(r.total) || 0);

    const crCounts = await db.Creative.findAll({
      attributes: ['campaign_id', [fn('COUNT', col('id')), 'total']],
      where: { campaign_id: { [Op.in]: ids } },
      group: ['campaign_id'],
      raw: true,
    });
    for (const r of crCounts) creativeCountMap.set(Number(r.campaign_id), Number(r.total) || 0);
  }
  res.json({
    data: rows.map((r) =>
      serialize(r, deliveredMap.get(Number(r.id)) || 0, creativeCountMap.get(Number(r.id)) || 0)
    ),
  });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await db.Campaign.findByPk(req.params.id, {
    include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
  });
  if (!row || !assertAdvertiserAccess(req.user, row.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Campaign tidak ditemukan', 404);
  }
  const deliveredRow = await db.EventAggregate.findOne({
    attributes: [[fn('SUM', col('count')), 'total']],
    where: { campaign_id: row.id, type: 'impression' },
    raw: true,
  });
  const creativeCount = await db.Creative.count({ where: { campaign_id: row.id } });
  res.json({
    data: serialize(row, Number(deliveredRow?.total) || 0, creativeCount),
  });
});

const create = asyncHandler(async (req, res) => {
  const body = schema.parse(req.body);
  if (!assertAdvertiserAccess(req.user, body.advertiser_id)) {
    throw new AppError('FORBIDDEN', 'Akses ditolak', 403);
  }
  if (req.user.advertiser_id != null) {
    body.advertiser_id = Number(req.user.advertiser_id);
  }
  const adv = await db.Advertiser.findByPk(body.advertiser_id);
  if (!adv) throw new AppError('VALIDATION_ERROR', 'Brand tidak valid', 400);
  const row = await db.Campaign.create(body);
  resetEligibleCache();
  const full = await db.Campaign.findByPk(row.id, {
    include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
  });
  res.status(201).json({ data: serialize(full) });
});

const update = asyncHandler(async (req, res) => {
  const body = schema.partial().parse(req.body);
  const row = await db.Campaign.findByPk(req.params.id);
  if (!row || !assertAdvertiserAccess(req.user, row.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Campaign tidak ditemukan', 404);
  }
  if (body.advertiser_id != null && !assertAdvertiserAccess(req.user, body.advertiser_id)) {
    throw new AppError('FORBIDDEN', 'Akses ditolak', 403);
  }
  if (req.user.advertiser_id != null) delete body.advertiser_id;
  const next = { ...row.toJSON(), ...body };
  if (next.end_date < next.start_date) {
    throw new AppError('VALIDATION_ERROR', 'end_date harus >= start_date', 400);
  }
  Object.assign(row, body);
  await row.save();
  resetEligibleCache();
  const full = await db.Campaign.findByPk(row.id, {
    include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
  });
  res.json({ data: serialize(full) });
});

const remove = asyncHandler(async (req, res) => {
  const row = await db.Campaign.findByPk(req.params.id);
  if (!row || !assertAdvertiserAccess(req.user, row.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Campaign tidak ditemukan', 404);
  }
  await row.destroy();
  resetEligibleCache();
  res.json({ ok: true });
});

module.exports = { list, getOne, create, update, remove };
