const { z } = require('zod');
const { fn, col, Op } = require('sequelize');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { advertiserScopeWhere, assertAdvertiserAccess } = require('../utils/scope');
const { cascadeDeleteAdvertiser } = require('../utils/cascadeDelete');
const { resetEligibleCache } = require('../utils/universalSelect');
const { generateTagKey } = require('../utils/tagKey');
const env = require('../config/env');

const httpUrl = z
  .string()
  .trim()
  .max(512)
  .refine((u) => {
    if (!u) return true;
    try {
      const proto = new URL(u).protocol;
      return proto === 'http:' || proto === 'https:';
    } catch {
      return false;
    }
  }, { message: 'website_url harus http atau https' });

const schema = z.object({
  name: z.string().min(1).max(255),
  website_url: z
    .union([httpUrl, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v == null || v === '' ? null : v)),
  notes: z
    .union([z.string().trim().max(4000), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v == null || v === '' ? null : v)),
  status: z.enum(['active', 'inactive']).default('active'),
});

function serialize(row, campaignCount = 0) {
  const tagKey = row.tag_key || null;
  return {
    id: String(row.id),
    name: row.name,
    website_url: row.website_url || null,
    notes: row.notes || null,
    status: row.status,
    tag_key: tagKey,
    tag_script: tagKey
      ? `<script src="${env.PUBLIC_BASE_URL}/ad/tag.js?a=${tagKey}"></script>`
      : null,
    campaign_count: Number(campaignCount) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function campaignCountMap(ids) {
  if (!ids.length) return new Map();
  const rows = await db.Campaign.findAll({
    attributes: ['advertiser_id', [fn('COUNT', col('id')), 'n']],
    where: { advertiser_id: { [Op.in]: ids } },
    group: ['advertiser_id'],
    raw: true,
  });
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.advertiser_id), Number(row.n) || 0);
  }
  return map;
}

const list = asyncHandler(async (req, res) => {
  const where = advertiserScopeWhere(req.user, 'id');
  const rows = await db.Advertiser.findAll({ where, order: [['id', 'DESC']] });
  const counts = await campaignCountMap(rows.map((row) => row.id));
  res.json({ data: rows.map((row) => serialize(row, counts.get(String(row.id)))) });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await db.Advertiser.findByPk(req.params.id);
  if (!row || !assertAdvertiserAccess(req.user, row.id)) {
    throw new AppError('NOT_FOUND', 'Brand tidak ditemukan', 404);
  }
  const campaignCount = await db.Campaign.count({ where: { advertiser_id: row.id } });
  res.json({ data: serialize(row, campaignCount) });
});

const create = asyncHandler(async (req, res) => {
  const body = schema.parse(req.body);
  let tagKey = generateTagKey();
  for (let i = 0; i < 5; i += 1) {
    const clash = await db.Advertiser.findOne({ where: { tag_key: tagKey } });
    if (!clash) break;
    tagKey = generateTagKey();
  }
  const row = await db.Advertiser.create({ ...body, tag_key: tagKey });
  res.status(201).json({ data: serialize(row) });
});

const update = asyncHandler(async (req, res) => {
  const body = schema.partial().parse(req.body);
  const row = await db.Advertiser.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Brand tidak ditemukan', 404);
  Object.assign(row, body);
  await row.save();
  resetEligibleCache();
  const campaignCount = await db.Campaign.count({ where: { advertiser_id: row.id } });
  res.json({ data: serialize(row, campaignCount) });
});

const remove = asyncHandler(async (req, res) => {
  const row = await db.Advertiser.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Brand tidak ditemukan', 404);
  await cascadeDeleteAdvertiser(row.id);
  resetEligibleCache();
  res.json({ ok: true });
});

module.exports = { list, getOne, create, update, remove };
