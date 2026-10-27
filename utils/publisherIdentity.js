const env = require('../config/env');
const db = require('../models');
const { hostFromUrl, isLoopbackHost } = require('./publisherOrigin');

const UNKNOWN_HOST = '(tidak diketahui)';
const LAST_SEEN_MIN_MS = 60 * 1000;

const byHost = new Map();
const lastSeenAt = new Map();

function isUnknownHost(host) {
  return !host || host === UNKNOWN_HOST;
}

/**
 * Huruf kecil, buang "www." di depan.
 * Loopback (localhost / 127.0.0.1 / [::1]) tetap host:port.
 */
function normalizePublisherHost(rawHost) {
  let host = String(rawHost || '')
    .trim()
    .toLowerCase();
  if (!host || host === 'null') return UNKNOWN_HOST;
  if (isLoopbackHost(host)) return host;
  host = host.replace(/:\d+$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  return host || UNKNOWN_HOST;
}

function hostFromRequest(req) {
  const origin = req.get('origin');
  if (origin && String(origin).trim().toLowerCase() !== 'null') {
    const fromOrigin = hostFromUrl(origin);
    if (fromOrigin) return normalizePublisherHost(fromOrigin);
  }
  const referer = req.get('referer');
  if (referer) {
    const fromRef = hostFromUrl(referer);
    if (fromRef) return normalizePublisherHost(fromRef);
  }
  return UNKNOWN_HOST;
}

async function touchLastSeen(publisher) {
  const id = Number(publisher.id);
  const now = Date.now();
  const prev = lastSeenAt.get(id) || 0;
  if (now - prev < LAST_SEEN_MIN_MS) return;
  lastSeenAt.set(id, now);
  const ts = new Date();
  publisher.last_seen_at = ts;
  await db.Publisher.update({ last_seen_at: ts }, { where: { id } });
}

async function upsertPublisher(host) {
  const cached = byHost.get(host);
  if (cached) {
    touchLastSeen(cached).catch((err) => console.error('publisher last_seen', err));
    return cached;
  }
  const now = new Date();
  const [row] = await db.Publisher.findOrCreate({
    where: { host },
    defaults: {
      host,
      status: env.PUBLISHER_DEFAULT_STATUS,
      first_seen_at: now,
      last_seen_at: now,
    },
  });
  byHost.set(host, row);
  lastSeenAt.set(Number(row.id), Date.now());
  return row;
}

function rememberPublisher(row) {
  if (!row) return;
  byHost.set(row.host, row);
}

function invalidatePublisherCache(hostOrId) {
  if (hostOrId == null) {
    byHost.clear();
    return;
  }
  if (typeof hostOrId === 'number' || /^\d+$/.test(String(hostOrId))) {
    const id = Number(hostOrId);
    for (const [host, row] of byHost) {
      if (Number(row.id) === id) byHost.delete(host);
    }
    return;
  }
  byHost.delete(String(hostOrId));
}

function resetPublisherCache() {
  byHost.clear();
  lastSeenAt.clear();
}

const LAST_BRAND_SEEN_MIN_MS = 60 * 1000;
const brandLastSeenAt = new Map();

/**
 * Catat / update relasi publisher × brand.
 * Status default dari PUBLISHER_DEFAULT_STATUS (biasanya active).
 */
async function upsertAdvertiserPublisher(advertiserId, publisher) {
  const advId = Number(advertiserId);
  const pubId = Number(publisher.id);
  const now = new Date();
  const [link] = await db.AdvertiserPublisher.findOrCreate({
    where: { advertiser_id: advId, publisher_id: pubId },
    defaults: {
      advertiser_id: advId,
      publisher_id: pubId,
      status: env.PUBLISHER_DEFAULT_STATUS,
      first_seen_at: now,
      last_seen_at: now,
    },
  });

  // Pending lama (sebelum auto-aktif) ikut diaktifkan saat terlihat lagi
  if (link.status === 'pending' && env.PUBLISHER_DEFAULT_STATUS === 'active') {
    link.status = 'active';
    await link.save();
  }

  const cacheKey = `${advId}:${pubId}`;
  const prev = brandLastSeenAt.get(cacheKey) || 0;
  if (Date.now() - prev >= LAST_BRAND_SEEN_MIN_MS) {
    brandLastSeenAt.set(cacheKey, Date.now());
    const ts = new Date();
    link.last_seen_at = ts;
    await db.AdvertiserPublisher.update(
      { last_seen_at: ts },
      { where: { id: link.id } }
    );
  }
  return link;
}

/**
 * Publisher dari Origin (utama) lalu Referer, atau dari ctx HMAC.
 * Jika advertiserId diberikan: status gate dari advertiser_publishers
 * (bukan status global publishers).
 * Host baru default active (lihat PUBLISHER_DEFAULT_STATUS).
 * blocked/pending/unknown -> rejected.
 */
async function resolvePublisher(req, { ctxPayload, advertiserId } = {}) {
  let host;
  if (ctxPayload && ctxPayload.host) {
    host = normalizePublisherHost(ctxPayload.host);
  } else {
    host = hostFromRequest(req);
  }

  if (isUnknownHost(host) && !env.ALLOW_UNKNOWN_PUBLISHER) {
    return {
      rejected: true,
      reason: 'unknown',
      host: UNKNOWN_HOST,
      publisher: null,
      link: null,
    };
  }
  if (isUnknownHost(host)) host = UNKNOWN_HOST;

  let publisher;
  if (ctxPayload && ctxPayload.pubId) {
    publisher = await db.Publisher.findByPk(ctxPayload.pubId);
    if (publisher) rememberPublisher(publisher);
  }
  if (!publisher) {
    publisher = await upsertPublisher(host);
  }

  touchLastSeen(publisher).catch((err) => console.error('publisher last_seen', err));

  let link = null;
  if (advertiserId != null) {
    link = await upsertAdvertiserPublisher(advertiserId, publisher);
    if (link.status === 'blocked' || link.status === 'pending') {
      return {
        rejected: true,
        reason: link.status,
        host: publisher.host,
        publisher,
        link,
      };
    }
    return { rejected: false, reason: null, host: publisher.host, publisher, link };
  }

  if (publisher.status === 'blocked' || publisher.status === 'pending') {
    return {
      rejected: true,
      reason: publisher.status,
      host: publisher.host,
      publisher,
      link: null,
    };
  }
  return { rejected: false, reason: null, host: publisher.host, publisher, link: null };
}

module.exports = {
  UNKNOWN_HOST,
  normalizePublisherHost,
  hostFromRequest,
  upsertPublisher,
  upsertAdvertiserPublisher,
  resolvePublisher,
  invalidatePublisherCache,
  resetPublisherCache,
  isUnknownHost,
};
