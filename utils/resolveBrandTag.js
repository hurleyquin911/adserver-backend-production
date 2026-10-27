const db = require('../models');
const { normalizeTagKey } = require('./tagKey');

/**
 * Resolve brand aktif dari query `a` / data-advertiser / ctx.
 * @returns {{ advertiser: object } | { error: string }}
 */
async function resolveBrandFromTagKey(rawKey) {
  const tagKey = normalizeTagKey(rawKey);
  if (!tagKey) {
    return { error: 'Tag brand wajib (?a=...). Salin tag dari dashboard Brand.' };
  }
  const advertiser = await db.Advertiser.findOne({
    where: { tag_key: tagKey, status: 'active' },
  });
  if (!advertiser) {
    return { error: 'Tag brand tidak valid atau brand nonaktif' };
  }
  return { advertiser };
}

module.exports = { resolveBrandFromTagKey };
