const { Op, fn, col } = require('sequelize');
const db = require('../models');
const env = require('../config/env');

const counts = new Map();

function resetDeliveryCounters() {
  counts.clear();
}

function incrementDelivered(campaignId, by = 1) {
  const id = Number(campaignId);
  if (!id) return;
  const rec = counts.get(id) || { n: 0, lastRecount: Date.now() };
  rec.n += by;
  if (!rec.lastRecount) rec.lastRecount = Date.now();
  counts.set(id, rec);
}

function peekDelivered(campaignId) {
  const rec = counts.get(Number(campaignId));
  return rec ? rec.n : 0;
}

async function ensureCounters(campaignIds) {
  const ids = [...new Set((campaignIds || []).map(Number).filter(Boolean))];
  const ttl = Number(env.DELIVERY_RECOUNT_SECONDS) * 1000;
  const now = Date.now();
  const need = ids.filter((id) => {
    const rec = counts.get(id);
    return !rec || now - rec.lastRecount >= ttl;
  });
  if (!need.length) return;
  const rows = await db.Event.findAll({
    attributes: ['campaign_id', [fn('COUNT', col('id')), 'n']],
    where: { campaign_id: { [Op.in]: need }, type: 'impression' },
    group: ['campaign_id'],
    raw: true,
  });
  const found = new Set();
  for (const r of rows) {
    const id = Number(r.campaign_id);
    counts.set(id, { n: Number(r.n) || 0, lastRecount: now });
    found.add(id);
  }
  for (const id of need) {
    if (!found.has(id)) counts.set(id, { n: 0, lastRecount: now });
  }
}

function getDelivered(campaignId) {
  return peekDelivered(campaignId);
}

module.exports = {
  resetDeliveryCounters,
  incrementDelivered,
  peekDelivered,
  ensureCounters,
  getDelivered,
};
