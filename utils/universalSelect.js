const { Op } = require('sequelize');
const db = require('../models');
const env = require('../config/env');
const { dayInTz } = require('./reportTz');
const { pacingFactor, campaignWeight, pickWeighted } = require('./pacing');
const { ensureCounters, getDelivered } = require('./deliveryCounter');
const { sizeKey } = require('./slotSize');

let cache = { at: 0, rows: [] };

function resetEligibleCache() {
  cache = { at: 0, rows: [] };
}

async function loadEligible(now = new Date()) {
  const ttl = Number(env.ELIGIBLE_CACHE_SECONDS) * 1000;
  if (ttl > 0 && cache.rows.length && Date.now() - cache.at < ttl) {
    return cache.rows;
  }
  const today = dayInTz(now);
  const rows = await db.Creative.findAll({
    where: { status: 'active' },
    include: [
      {
        model: db.Campaign,
        as: 'campaign',
        required: true,
        where: {
          status: 'active',
          start_date: { [Op.lte]: today },
          end_date: { [Op.gte]: today },
        },
        include: [
          {
            model: db.Advertiser,
            as: 'advertiser',
            required: true,
            where: { status: 'active' },
          },
        ],
      },
    ],
  });
  cache = { at: Date.now(), rows };
  return rows;
}

function pickCreativeFromCampaign(creatives, rng) {
  if (!creatives.length) return null;
  const idx = Math.min(creatives.length - 1, Math.floor(rng() * creatives.length));
  return creatives[idx];
}

/**
 * Pilih campaign berbobot (priority × pacing), lalu creative ukuran persis.
 * advertiserId wajib untuk tag per-brand (hanya creative brand itu).
 * RNG disuntik untuk tes.
 */
async function pickUniversal({
  sizes,
  advertiserId = null,
  rng = Math.random,
  now = new Date(),
} = {}) {
  const sizeSet = new Set((sizes || []).map((s) => s.key));
  if (!sizeSet.size) return null;

  const all = await loadEligible(now);
  const matching = all.filter((c) => {
    if (!sizeSet.has(sizeKey(c.width, c.height))) return false;
    if (advertiserId != null && Number(c.campaign?.advertiser_id) !== Number(advertiserId)) {
      return false;
    }
    return true;
  });
  if (!matching.length) return null;

  const byCamp = new Map();
  for (const c of matching) {
    const camp = c.campaign;
    if (!byCamp.has(camp.id)) byCamp.set(camp.id, { camp, creatives: [] });
    byCamp.get(camp.id).creatives.push(c);
  }

  const campIds = [...byCamp.keys()];
  await ensureCounters(campIds);

  const groups = [];
  for (const g of byCamp.values()) {
    const goal = Number(g.camp.impression_goal || 0);
    const delivered = getDelivered(g.camp.id);
    if (goal > 0 && delivered >= goal) continue;
    groups.push(g);
  }
  if (!groups.length) return null;

  const weights = groups.map((g) => {
    const goal = Number(g.camp.impression_goal || 0);
    const factor = pacingFactor({
      goal,
      delivered: getDelivered(g.camp.id),
      startDate: g.camp.start_date,
      endDate: g.camp.end_date,
      now,
      enabled: env.PACING_ENABLED,
    });
    return campaignWeight(g.camp.priority, factor);
  });

  const chosen = pickWeighted(groups, weights, rng);
  if (!chosen) return null;
  return pickCreativeFromCampaign(chosen.creatives, rng);
}

async function countEligibleBySize({ advertiserId = null } = {}) {
  const all = await loadEligible();
  const map = new Map();
  for (const c of all) {
    if (advertiserId != null && Number(c.campaign?.advertiser_id) !== Number(advertiserId)) {
      continue;
    }
    const key = sizeKey(c.width, c.height);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => a.size.localeCompare(b.size));
}

module.exports = {
  loadEligible,
  pickUniversal,
  countEligibleBySize,
  resetEligibleCache,
};
