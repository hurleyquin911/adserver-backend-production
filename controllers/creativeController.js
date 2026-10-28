const { z } = require('zod');
const path = require('path');
const { Op, fn, col } = require('sequelize');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { assertAdvertiserAccess, campaignScopeInclude } = require('../utils/scope');
const { getStorage } = require('../utils/storage');
const { extractAndValidateZip } = require('../utils/zipCreative');
const env = require('../config/env');
const { resetEligibleCache } = require('../utils/universalSelect');
const { rangeStart, rangeEnd } = require('../utils/reportTz');
const { defaultFromTo, emptyTotals, addRow, withRates } = require('../utils/reportMetrics');
const { isSuperadminName } = require('../constant/roles');
const { recordRateChange } = require('../utils/billingRateHistory');
const { hideAdRequests } = require('../utils/reportVisibility');

const httpUrl = z
  .string()
  .url()
  .refine((u) => {
    try {
      const proto = new URL(u).protocol;
      return proto === 'http:' || proto === 'https:';
    } catch {
      return false;
    }
  }, { message: 'click_url harus http atau https' });

const clickUrlField = z.union([httpUrl, z.literal(''), z.null()]).optional();

function normalizeClickUrl(value) {
  if (value == null || value === '') return null;
  return value;
}

const cpmUsdField = z.preprocess(
  (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!/^\d{1,6}(?:\.\d{1,4})?$/.test(normalized)) return Number.NaN;
      return Number(normalized);
    }
    return value;
  },
  z.number().finite().min(0).max(999999.9999).nullable().optional()
);
const cpmChangeReasonField = z.string().trim().min(5).max(500).optional();

function requireCpmChangeReason(schema) {
  return schema.superRefine((body, context) => {
    if (
      Object.hasOwn(body, 'cpm_usd') &&
      (typeof body.cpm_change_reason !== 'string' || body.cpm_change_reason.length < 5)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cpm_change_reason'],
        message: 'Jelaskan ketentuan perubahan harga (minimal 5 karakter)',
      });
    }
  });
}

const metaSchema = requireCpmChangeReason(z.object({
  campaign_id: z.coerce.number().int().positive(),
  name: z.string().min(1).max(255),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
  click_url: clickUrlField,
  cpm_usd: cpmUsdField,
  cpm_change_reason: cpmChangeReasonField,
  status: z.enum(['draft', 'active', 'paused']).default('draft'),
}));

const updateSchema = requireCpmChangeReason(z.object({
  name: z.string().min(1).max(255).optional(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  click_url: clickUrlField,
  cpm_usd: cpmUsdField,
  cpm_change_reason: cpmChangeReasonField,
  status: z.enum(['draft', 'active', 'paused']).optional(),
}));

function assertCpmWriteAccess(body, user) {
  if (Object.hasOwn(body, 'cpm_usd') && !isSuperadminName(user?.role?.name)) {
    throw new AppError('FORBIDDEN', 'Hanya Superadmin yang dapat mengatur CPM', 403);
  }
}

function serialize(row, storage, metrics, delivered) {
  const previewPath = path.posix.join(String(row.base_path), row.entry_file || 'index.html');
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    name: row.name,
    width: row.width,
    height: row.height,
    storage_driver: row.storage_driver,
    base_path: row.base_path,
    entry_file: row.entry_file,
    click_url: row.click_url,
    cpm_usd: row.cpm_usd == null ? null : Number(row.cpm_usd),
    status: row.status,
    file_size: Number(row.file_size || 0),
    preview_url: storage.getUrl(previewPath),
    campaign: row.campaign
      ? { id: String(row.campaign.id), name: row.campaign.name, advertiser_id: String(row.campaign.advertiser_id) }
      : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    delivered: delivered != null ? delivered : undefined,
    metrics: metrics || undefined,
  };
}

async function getCampaignScoped(campaignId, user) {
  const campaign = await db.Campaign.findByPk(campaignId);
  if (!campaign || !assertAdvertiserAccess(user, campaign.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Campaign tidak ditemukan', 404);
  }
  return campaign;
}

const list = asyncHandler(async (req, res) => {
  const storage = getStorage();
  const { from, to } = defaultFromTo(req.query);
  const where = {};
  if (req.query.campaign_id) where.campaign_id = req.query.campaign_id;

  const rows = await db.Creative.findAll({
    where,
    include: [
      {
        model: db.Campaign,
        as: 'campaign',
        required: true,
        where: campaignScopeInclude(req.user),
        include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
      },
    ],
    order: [['id', 'DESC']],
  });
  const ids = rows.map((r) => Number(r.id));
  const agg = ids.length
    ? await db.EventAggregate.findAll({
        attributes: ['creative_id', 'type', [fn('SUM', col('count')), 'total']],
        where: {
          creative_id: { [Op.in]: ids },
          bucket_at: { [Op.between]: [rangeStart(from), rangeEnd(to)] },
          type: {
            [Op.in]: [
              'request',
              'impression',
              'viewable_impression',
              'click',
              'interaction',
              'interaction_unique',
              'no_fill',
            ],
          },
        },
        group: ['creative_id', 'type'],
        raw: true,
      })
    : [];
  const byCreative = new Map();
  for (const r of agg) {
    const id = Number(r.creative_id);
    if (!byCreative.has(id)) byCreative.set(id, emptyTotals());
    addRow(byCreative.get(id), r.type, r.total);
  }
  const lifeRows = ids.length
    ? await db.EventAggregate.findAll({
        attributes: ['creative_id', [fn('SUM', col('count')), 'total']],
        where: { creative_id: { [Op.in]: ids }, type: 'impression' },
        group: ['creative_id'],
        raw: true,
      })
    : [];
  const deliveredMap = new Map();
  for (const r of lifeRows) deliveredMap.set(Number(r.creative_id), Number(r.total) || 0);

  res.json({
    data: await Promise.all(rows.map(async (r) => {
      const metrics = hideAdRequests(
        withRates(byCreative.get(Number(r.id)) || emptyTotals()),
        req.user
      );
      const base = serialize(
        r,
        storage,
        metrics,
        deliveredMap.get(Number(r.id)) || 0
      );
      const previewPath = path.posix.join(String(r.base_path), r.entry_file || 'index.html');
      const previewReady = r.base_path !== 'pending' && (
        typeof storage.exists === 'function' ? await storage.exists(previewPath) : Boolean(r.entry_file)
      );
      return {
        ...base,
        preview_ready: previewReady,
        campaign: r.campaign
          ? {
              ...base.campaign,
              advertiser: r.campaign.advertiser
                ? {
                    id: String(r.campaign.advertiser.id),
                    name: r.campaign.advertiser.name,
                  }
                : undefined,
            }
          : undefined,
      };
    })),
    meta: { from, to },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const storage = getStorage();
  const row = await db.Creative.findByPk(req.params.id, {
    include: [
      {
        model: db.Campaign,
        as: 'campaign',
        include: [{ model: db.Advertiser, as: 'advertiser', attributes: ['id', 'name'] }],
      },
    ],
  });
  if (!row || !assertAdvertiserAccess(req.user, row.campaign.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Creative tidak ditemukan', 404);
  }
  const previewPath = path.posix.join(String(row.base_path), row.entry_file || 'index.html');
  const previewReady = row.base_path !== 'pending' && (
    typeof storage.exists === 'function' ? await storage.exists(previewPath) : Boolean(row.entry_file)
  );
  const data = serialize(row, storage);
  res.json({
    data: {
      ...data,
      preview_ready: previewReady,
      campaign: data.campaign
        ? {
            ...data.campaign,
            advertiser: row.campaign.advertiser
              ? {
                  id: String(row.campaign.advertiser.id),
                  name: row.campaign.advertiser.name,
                }
              : undefined,
          }
        : undefined,
    },
  });
});

const upload = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('VALIDATION_ERROR', 'File ZIP wajib diunggah', 400);
  const body = metaSchema.parse(req.body);
  assertCpmWriteAccess(body, req.user);
  body.click_url = normalizeClickUrl(body.click_url);
  const { cpm_change_reason: cpmChangeReason, ...creativeFields } = body;
  await getCampaignScoped(body.campaign_id, req.user);

  const { files, totalSize, entryFile } = extractAndValidateZip(req.file.buffer);
  const creative = await db.Creative.create({
    campaign_id: creativeFields.campaign_id,
    name: creativeFields.name,
    width: creativeFields.width,
    height: creativeFields.height,
    storage_driver: env.STORAGE_DRIVER,
    base_path: 'pending',
    entry_file: entryFile,
    click_url: creativeFields.click_url,
    cpm_usd: creativeFields.cpm_usd ?? null,
    status: creativeFields.status,
    file_size: totalSize,
  });

  const basePath = String(creative.id);
  const storage = getStorage();
  for (const file of files) {
    const key = path.posix.join(basePath, file.name);
    await storage.upload(key, file.data);
  }
  creative.base_path = basePath;
  await creative.save();
  if (creative.cpm_usd != null) {
    await recordRateChange({
      creativeId: creative.id,
      oldRate: null,
      newRate: creative.cpm_usd,
      changedBy: req.user.id,
      reason: cpmChangeReason,
    });
  }

  const full = await db.Creative.findByPk(creative.id, {
    include: [{ model: db.Campaign, as: 'campaign' }],
  });
  resetEligibleCache();
  res.status(201).json({ data: serialize(full, storage) });
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  assertCpmWriteAccess(body, req.user);
  if (Object.prototype.hasOwnProperty.call(body, 'click_url')) {
    body.click_url = normalizeClickUrl(body.click_url);
  }
  const { cpm_change_reason: cpmChangeReason, ...creativeFields } = body;
  const row = await db.Creative.findByPk(req.params.id, {
    include: [{ model: db.Campaign, as: 'campaign' }],
  });
  if (!row || !assertAdvertiserAccess(req.user, row.campaign.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Creative tidak ditemukan', 404);
  }

  const storage = getStorage();
  if (req.file) {
    const { files, totalSize, entryFile } = extractAndValidateZip(req.file.buffer);
    const basePath = row.base_path && row.base_path !== 'pending' ? String(row.base_path) : String(row.id);
    try {
      await storage.delete(basePath);
    } catch {
      // ignore: folder lama mungkin sudah tidak ada
    }
    for (const file of files) {
      const key = path.posix.join(basePath, file.name);
      await storage.upload(key, file.data);
    }
    row.base_path = basePath;
    row.entry_file = entryFile;
    row.file_size = totalSize;
    row.storage_driver = env.STORAGE_DRIVER;
  }

  if (Object.hasOwn(creativeFields, 'cpm_usd')) {
    await db.sequelize.transaction(async (transaction) => {
      const oldRate = row.cpm_usd;
      await row.update(creativeFields, { transaction });
      await recordRateChange({
        creativeId: row.id,
        oldRate,
        newRate: row.cpm_usd,
        changedBy: req.user.id,
        reason: cpmChangeReason,
        transaction,
      });
    });
  } else {
    Object.assign(row, creativeFields);
    await row.save();
  }
  resetEligibleCache();
  res.json({ data: serialize(row, storage) });
});

const remove = asyncHandler(async (req, res) => {
  const row = await db.Creative.findByPk(req.params.id, {
    include: [{ model: db.Campaign, as: 'campaign' }],
  });
  if (!row || !assertAdvertiserAccess(req.user, row.campaign.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'Creative tidak ditemukan', 404);
  }
  const storage = getStorage();
  try {
    await storage.delete(row.base_path);
  } catch {
    // ignore storage cleanup failures
  }
  await row.destroy();
  resetEligibleCache();
  res.json({ ok: true });
});

module.exports = { list, getOne, upload, update, remove };
