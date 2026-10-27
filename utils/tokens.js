const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_TTL });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.REFRESH_SECRET);
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 64);
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createServeId() {
  return crypto.randomBytes(16).toString('hex');
}

function createPlacementKey() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Token format: base64url(payloadJson).hmac
 * payload: { sid, pid, cid, campId, siteId, originOk, exp }
 */
function signTrackingToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', env.TRACKING_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function signPublisherCtx({ pubId, host, advId, tagKey }) {
  return signTrackingToken({
    k: 'ctx',
    pubId: Number(pubId),
    host: String(host),
    advId: advId != null ? Number(advId) : undefined,
    tagKey: tagKey ? String(tagKey) : undefined,
    exp: Date.now() + 10 * 60 * 1000,
  });
}

function verifyPublisherCtx(token) {
  const payload = verifyTrackingToken(token);
  if (!payload || payload.k !== 'ctx' || !payload.pubId) return null;
  return payload;
}

function verifyTrackingToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', env.TRACKING_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashIp,
  hashRefreshToken,
  createServeId,
  createPlacementKey,
  signTrackingToken,
  verifyTrackingToken,
  signPublisherCtx,
  verifyPublisherCtx,
};
