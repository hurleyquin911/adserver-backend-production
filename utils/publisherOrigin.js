const env = require('../config/env');
const AppError = require('./AppError');

const DOMAIN_PATTERN =
  /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$|^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$|^\[::1\](?::\d+)?$/i;

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  return (
    h === 'localhost' ||
    /^localhost:\d+$/.test(h) ||
    h === '127.0.0.1' ||
    /^127\.0\.0\.1:\d+$/.test(h) ||
    h === '[::1]' ||
    /^\[::1\]:\d+$/.test(h)
  );
}

/** Buang http(s):// dan path. Port hanya dipertahankan untuk localhost / 127.0.0.1. */
function normalizeDomainPattern(value) {
  let s = String(value || '')
    .trim()
    .toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/^[^/@]+@/, '');
  s = s.split(/[/?#]/)[0] || '';
  s = s.replace(/\.+$/, '');
  if (!s) return '';

  const wildcard = s.startsWith('*.');
  let host = wildcard ? s.slice(2) : s;
  if (!host) return '';

  if (isLoopbackHost(host)) {
    return wildcard ? '' : host;
  }
  host = host.replace(/:\d+$/, '');
  return wildcard ? `*.${host}` : host;
}

function isValidDomainPattern(value) {
  const normalized = normalizeDomainPattern(value);
  return Boolean(normalized) && DOMAIN_PATTERN.test(normalized);
}

function parseDevAllowedHosts() {
  return String(env.DEV_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Hostname (tanpa port) via new URL(), bukan substring mentah.
 * Input host polos di-wrap `http://` agar userinfo (@) ter-parse benar.
 */
function parseHostname(input) {
  const raw = String(input || '').trim();
  if (!raw || raw === 'null') return null;
  try {
    const u = raw.includes('://') ? new URL(raw) : new URL(`http://${raw}`);
    return (u.hostname || '').toLowerCase() || null;
  } catch {
    return null;
  }
}

function parseHostWithPort(input) {
  const raw = String(input || '').trim();
  if (!raw || raw === 'null') return null;
  try {
    const u = raw.includes('://') ? new URL(raw) : new URL(`http://${raw}`);
    return (u.host || '').toLowerCase() || null;
  } catch {
    return null;
  }
}

function hostFromUrl(raw) {
  return parseHostWithPort(raw);
}

function hostFromReq(req) {
  const origin = req.get('origin');
  const fromOrigin = hostFromUrl(origin);
  if (fromOrigin) return fromOrigin;
  return hostFromUrl(req.get('referer'));
}

/**
 * `*.contoh.com` hanya cocok dengan subdomain (a.contoh.com),
 * bukan apex contoh.com - operator harus menuliskan keduanya jika perlu.
 */
function matchDomain(input, pattern) {
  const p = String(pattern || '')
    .trim()
    .toLowerCase();
  const hostname = parseHostname(input);
  if (!hostname || !p) return false;

  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return hostname !== base && hostname.endsWith(`.${base}`);
  }

  const patternHost = parseHostname(p);
  return Boolean(patternHost && hostname === patternHost);
}

function allowedList(site) {
  const raw = site && site.allowed_domains;
  return Array.isArray(raw) ? raw : [];
}

function assertPublisherAllowed(req, site) {
  const host = hostFromReq(req);
  const hostname = parseHostname(host);
  const allowed = allowedList(site);
  const devHosts = parseDevAllowedHosts();

  if (host && devHosts.includes(host.toLowerCase())) {
    return { originOk: true, host };
  }

  if (!allowed.length) {
    if (env.REQUIRE_ALLOWED_DOMAINS) {
      throw new AppError('FORBIDDEN', 'allowed_domains wajib diisi', 403);
    }
    console.warn('[adserver] allowed_domains kosong; serve diizinkan', {
      siteId: site && site.id,
      host,
    });
    return { originOk: true, host, unrestricted: true };
  }

  if (!hostname || !allowed.some((p) => matchDomain(host || hostname, p))) {
    throw new AppError('FORBIDDEN', 'Domain publisher tidak diizinkan', 403);
  }

  return { originOk: true, host };
}

module.exports = {
  normalizeDomainPattern,
  isValidDomainPattern,
  parseDevAllowedHosts,
  parseHostname,
  hostFromUrl,
  hostFromReq,
  matchDomain,
  assertPublisherAllowed,
  isLoopbackHost,
};
