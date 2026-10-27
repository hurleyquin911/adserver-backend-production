const crypto = require('crypto');

function generateTagKey() {
  return crypto.randomBytes(12).toString('hex');
}

function normalizeTagKey(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{16,32}$/.test(key)) return null;
  return key;
}

module.exports = { generateTagKey, normalizeTagKey };
