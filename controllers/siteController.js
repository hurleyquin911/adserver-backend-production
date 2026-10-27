const { z } = require('zod');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const {
  isValidDomainPattern,
  normalizeDomainPattern,
} = require('../utils/publisherOrigin');

const DOMAIN_HINT =
  'Format domain tidak valid. Contoh: publisher.com, *.publisher.com, localhost:5500, atau 127.0.0.1:5500';

const allowedDomainsSchema = z
  .array(z.string())
  .max(50)
  .transform((arr) => arr.map(normalizeDomainPattern).filter(Boolean))
  .refine((arr) => arr.every(isValidDomainPattern), { message: DOMAIN_HINT });

const schema = z.object({
  name: z.string().trim().min(1).max(255),
  domain: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v == null || String(v).trim() === '') return null;
      return String(v).trim();
    }),
  allowed_domains: allowedDomainsSchema.optional(),
});

function serialize(row) {
  return {
    id: String(row.id),
    name: row.name,
    domain: row.domain,
    allowed_domains: Array.isArray(row.allowed_domains) ? row.allowed_domains : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const list = asyncHandler(async (req, res) => {
  const rows = await db.Site.findAll({ order: [['id', 'DESC']] });
  res.json({ data: rows.map(serialize) });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await db.Site.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Site tidak ditemukan', 404);
  res.json({ data: serialize(row) });
});

const create = asyncHandler(async (req, res) => {
  const body = schema.parse(req.body);
  if (body.allowed_domains == null) body.allowed_domains = [];
  const row = await db.Site.create(body);
  res.status(201).json({ data: serialize(row) });
});

const update = asyncHandler(async (req, res) => {
  const body = schema.partial().parse(req.body);
  const row = await db.Site.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Site tidak ditemukan', 404);
  Object.assign(row, body);
  await row.save();
  res.json({ data: serialize(row) });
});

const remove = asyncHandler(async (req, res) => {
  const row = await db.Site.findByPk(req.params.id);
  if (!row) throw new AppError('NOT_FOUND', 'Site tidak ditemukan', 404);
  // placements.site_id = RESTRICT - hapus child dulu (creative_placements CASCADE, events SET NULL)
  await db.sequelize.transaction(async (transaction) => {
    const placements = await db.Placement.findAll({
      where: { site_id: row.id },
      transaction,
    });
    for (const placement of placements) {
      await placement.destroy({ transaction });
    }
    await row.destroy({ transaction });
  });
  res.json({ ok: true });
});

module.exports = { list, getOne, create, update, remove };
