function detectDevice(ua = '') {
  const s = String(ua).toLowerCase();
  if (/mobile|android|iphone|ipad/.test(s)) return 'mobile';
  if (/tablet/.test(s)) return 'tablet';
  return 'desktop';
}

function sanitizeInteractionName(name) {
  if (name == null || name === '') return null;
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
  return s || null;
}

module.exports = { detectDevice, sanitizeInteractionName };
