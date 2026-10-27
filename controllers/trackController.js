const { z } = require('zod');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyTrackingToken, hashIp } = require('../utils/tokens');
const eventBuffer = require('../utils/eventBuffer');
const { detectDevice, sanitizeInteractionName } = require('../utils/deviceType');
const { incrementDelivered } = require('../utils/deliveryCounter');
const { appendClickUtm } = require('../utils/clickUtm');

const trackSchema = z.object({
  t: z.string().min(1),
  type: z.enum(['impression', 'viewable_impression', 'click', 'interaction']),
  interaction_name: z.string().max(255).optional().nullable(),
  device_type: z.string().max(64).optional().nullable(),
});

const DEDUPE_TYPES = new Set(['impression', 'viewable_impression', 'click']);

function buildDedupeKey(serveId, type) {
  if (!DEDUPE_TYPES.has(type)) return null;
  return `${serveId}:${type}`;
}

function buildEvent(payload, type, req, interactionName, deviceType) {
  return {
    placement_id: payload.pid || null,
    creative_id: payload.cid || null,
    campaign_id: payload.campId || null,
    publisher_id: payload.pubId || null,
    advertiser_id: payload.advId || null,
    serve_id: payload.sid,
    type,
    interaction_name: interactionName || null,
    slot_size: payload.size || null,
    occurred_at: new Date(),
    device_type: deviceType || detectDevice(req.get('user-agent')),
    ip_hash: hashIp(req.ip),
    user_agent: (req.get('user-agent') || '').slice(0, 1000),
    referrer: (req.get('referer') || '').slice(0, 1000),
    dedupe_key: buildDedupeKey(payload.sid, type),
  };
}

const track = asyncHandler(async (req, res) => {
  const body = trackSchema.parse({
    ...req.body,
    ...req.query,
  });
  const payload = verifyTrackingToken(body.t);
  if (!payload || !payload.sid) {
    throw new AppError('INVALID_TOKEN', 'Token tracking tidak valid', 401);
  }

  const interactionName =
    body.type === 'interaction' ? sanitizeInteractionName(body.interaction_name) : null;
  const deviceType = body.device_type ? String(body.device_type).slice(0, 64) : null;
  const result = eventBuffer.enqueue(
    buildEvent(payload, body.type, req, interactionName, deviceType)
  );
  if (result.accepted && body.type === 'impression' && payload.campId) {
    incrementDelivered(payload.campId);
  }
  res.status(202).json({ ok: true, ...result });
});

const click = asyncHandler(async (req, res) => {
  const token = req.query.t;
  const payload = verifyTrackingToken(String(token || ''));
  if (!payload || !payload.sid) {
    throw new AppError('INVALID_TOKEN', 'Token tracking tidak valid', 401);
  }

  const creative = await db.Creative.findByPk(payload.cid);
  if (!creative || !creative.click_url) {
    throw new AppError('NOT_FOUND', 'Creative atau click_url tidak ditemukan', 404);
  }

  const result = eventBuffer.enqueue(buildEvent(payload, 'click', req, null, null));
  if (result.accepted && payload.campId) {
    /* click tidak menambah delivered */
  }

  let dest = creative.click_url;
  if (payload.host || payload.pubId) {
    dest = appendClickUtm(dest, {
      host: payload.host,
      campaignId: payload.campId,
      creativeId: payload.cid,
    });
  }
  res.redirect(302, dest);
});

module.exports = { track, click };
