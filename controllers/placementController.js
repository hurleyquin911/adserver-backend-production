const { z } = require('zod');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { createPlacementKey } = require('../utils/tokens');
const { assertAdvertiserAccess } = require('../utils/scope');

const schema = z.object({
  site_id: z.coerce.number().int().positive(),
  name: z.string().min(1).max(255),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
});

const assignSchema = z.object({
  creative_ids: z.array(z.coerce.number().int().positive()).default([]),
});

function serialize(row) {
  return {
    id: String(row.id),
    site_id: String(row.site_id),
    name: row.name,
    width: row.width,
    height: row.height,
    key: row.key,
    site: row.site ? { id: String(row.site.id), name: row.site.name } : undefined,
    creatives: (row.creatives || []).map((c) => ({
      id: String(c.id),
      name: c.name,
      width: c.width,
      height: c.height,
      status: c.status,
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const list = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.site_id) where.site_id = req.query.site_id;
  const rows = await db.Placement.findAll({
    where,
    include: [
      { model: db.Site, as: 'site' },
      { model: db.Creative, as: 'creatives', through: { attributes: [] } },
    ],
    order: [['id', 'DESC']],
  });
  res.json({ data: rows.map(serialize) });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await db.Placement.findByPk(req.params.id, {
    include: [
      { model: db.Site, as: 'site' },
      { model: db.Creative, as: 'creatives', through: { attributes: [] } },
    ],
  });
  if (!row) throw new AppError('NOT_FOUND', 'Placement tidak ditemukan', 404);
  res.json({ data: serialize(row) });
});

const create = asyncHandler(async (req, res) => {
  const body = schema.parse(req.body);
  const site = await db.Site.findByPk(body.site_id);
  if (!site) throw new AppError('VALIDATION_ERROR', 'Site tidak valid', 400);
  const row = await db.Placement.create({
    ...body,
    key: createPlacementKey(),
  });
  const full = await db.Placement.findByPk(row.id, {
    include: [
      { model: db.Site, as: 'site' },
      { model: db.Creative, as: 'creatives', through: { attributes: [] } },
    ],
  });
  res.status(201).json({ data: serialize(full) });
});

const update = asyncHandler(async (req, res) => {
  const body = schema.partial().parse(req.body);
  const row = await db.Placement.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Placement tidak ditemukan', 404);
  Object.assign(row, body);
  await row.save();
  const full = await db.Placement.findByPk(row.id, {
    include: [
      { model: db.Site, as: 'site' },
      { model: db.Creative, as: 'creatives', through: { attributes: [] } },
    ],
  });
  res.json({ data: serialize(full) });
});

const assignCreatives = asyncHandler(async (req, res) => {
  const body = assignSchema.parse(req.body);
  const placement = await db.Placement.findByPk(req.params.id);
  if (!placement) throw new AppError('NOT_FOUND', 'Placement tidak ditemukan', 404);

  if (body.creative_ids.length) {
    const creatives = await db.Creative.findAll({
      where: { id: body.creative_ids },
      include: [{ model: db.Campaign, as: 'campaign' }],
    });
    if (creatives.length !== body.creative_ids.length) {
      throw new AppError('VALIDATION_ERROR', 'Creative tidak valid', 400);
    }
    for (const c of creatives) {
      if (!assertAdvertiserAccess(req.user, c.campaign.advertiser_id)) {
        throw new AppError('FORBIDDEN', 'Akses ditolak', 403);
      }
    }
  }

  await placement.setCreatives(body.creative_ids);
  const full = await db.Placement.findByPk(placement.id, {
    include: [
      { model: db.Site, as: 'site' },
      { model: db.Creative, as: 'creatives', through: { attributes: [] } },
    ],
  });
  res.json({ data: serialize(full) });
});

const remove = asyncHandler(async (req, res) => {
  const row = await db.Placement.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Placement tidak ditemukan', 404);
  await row.destroy();
  res.json({ ok: true });
});

module.exports = { list, getOne, create, update, assignCreatives, remove };
