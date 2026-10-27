/**
 * Jangan tulis query string (berisi token) untuk serving & click tracking.
 */
function requestUrlForLog(req) {
  const raw = req.originalUrl || req.url || '';
  const pathOnly = String(raw).split('?')[0];
  if (pathOnly.startsWith('/ad/') || pathOnly === '/ad' || pathOnly.startsWith('/track/click')) {
    return pathOnly;
  }
  return raw;
}

module.exports = { requestUrlForLog };
