const env = require('../config/env');

function appendClickUtm(clickUrl, { host, campaignId, creativeId } = {}) {
  if (!env.CLICK_APPEND_UTM || !clickUrl) return clickUrl;
  let u;
  try {
    u = new URL(clickUrl);
  } catch {
    return clickUrl;
  }
  if (!u.searchParams.has('utm_source')) {
    u.searchParams.set('utm_source', host || '(tidak diketahui)');
  }
  if (!u.searchParams.has('utm_medium')) {
    u.searchParams.set('utm_medium', 'display');
  }
  if (!u.searchParams.has('utm_campaign')) {
    u.searchParams.set('utm_campaign', String(campaignId || ''));
  }
  if (!u.searchParams.has('utm_content')) {
    u.searchParams.set('utm_content', String(creativeId || ''));
  }
  return u.toString();
}

module.exports = { appendClickUtm };
