const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const env = require('../config/env');
const db = require('../models');
const { COMMON_SLOT_SIZES } = require('../constant/slotSizes');
const { countEligibleBySize } = require('../utils/universalSelect');
const { parseOneSize, sizeKey } = require('../utils/slotSize');
const { assertAdvertiserAccess, isUnscoped } = require('../utils/scope');
const {
  getMacroSet,
  listMacroSets,
  serializeMacroSet,
  buildDspSnippets,
} = require('../utils/dspTag');

async function resolveTagAdvertiser(req) {
  const rawId = req.query.advertiser_id;
  if (rawId != null && String(rawId).trim() !== '') {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id < 1) {
      throw new AppError('VALIDATION_ERROR', 'advertiser_id tidak valid', 400);
    }
    if (!assertAdvertiserAccess(req.user, id)) {
      throw new AppError('FORBIDDEN', 'Tidak punya akses ke brand ini', 403);
    }
    const row = await db.Advertiser.findByPk(id);
    if (!row) throw new AppError('NOT_FOUND', 'Brand tidak ditemukan', 404);
    return row;
  }

  if (!isUnscoped(req.user)) {
    if (req.user.advertiser_id == null) {
      throw new AppError('FORBIDDEN', 'Akun belum terikat brand', 403);
    }
    const row = await db.Advertiser.findByPk(req.user.advertiser_id);
    if (!row) throw new AppError('NOT_FOUND', 'Brand tidak ditemukan', 404);
    return row;
  }

  const row = await db.Advertiser.findOne({
    where: { status: 'active' },
    order: [['id', 'ASC']],
  });
  if (!row) {
    throw new AppError('NOT_FOUND', 'Belum ada brand. Buat Brand dulu untuk mendapatkan tag.', 404);
  }
  return row;
}

const getTag = asyncHandler(async (req, res) => {
  const advertiser = await resolveTagAdvertiser(req);
  const base = env.PUBLIC_BASE_URL;
  const tagKey = advertiser.tag_key;
  const advertiserId = Number(advertiser.id);
  const eligible = await countEligibleBySize({ advertiserId });
  const eligibleMap = new Map(eligible.map((s) => [s.size, s.count]));

  const macroSet = getMacroSet(req.query.macros);
  const allSets = listMacroSets().map(serializeMacroSet);

  const seen = new Set();
  const sizes = [];

  for (const s of COMMON_SLOT_SIZES) {
    const key = sizeKey(s.width, s.height);
    if (seen.has(key)) continue;
    seen.add(key);
    sizes.push({
      ...buildDspSnippets(base, tagKey, s.width, s.height, macroSet),
      eligible_count: eligibleMap.get(key) || 0,
      common: true,
    });
  }

  for (const row of eligible) {
    if (seen.has(row.size)) continue;
    const parsed = parseOneSize(row.size);
    if (!parsed) continue;
    seen.add(row.size);
    sizes.push({
      ...buildDspSnippets(base, tagKey, parsed.width, parsed.height, macroSet),
      eligible_count: row.count,
      common: false,
    });
  }

  sizes.sort((a, b) => {
    if (b.eligible_count !== a.eligible_count) return b.eligible_count - a.eligible_count;
    return a.size.localeCompare(b.size);
  });

  const primary = sizes.find((s) => s.eligible_count > 0) || sizes[0];

  res.json({
    data: {
      advertiser: {
        id: String(advertiser.id),
        name: advertiser.name,
        tag_key: tagKey,
        status: advertiser.status,
      },
      standard: 'third-party-display',
      macros: {
        active: serializeMacroSet(macroSet),
        sets: allSets,
      },
      js: primary ? primary.script : null,
      iframe: primary ? primary.iframe : null,
      html: primary ? primary.html : null,
      example: primary ? primary.html : null,
      primary_size: primary ? primary.size : null,
      sizes,
      snippets: sizes,
    },
  });
});

module.exports = { getTag };
