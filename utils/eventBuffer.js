const db = require('../models');

const buffer = [];
const DEDUPE_TYPES = new Set(['impression', 'viewable_impression', 'click']);
const INTERACTION_MAX = 50;
const INTERACTION_TTL_MS = 24 * 60 * 60 * 1000;

const interactionCounts = new Map();
let timer = null;
let flushing = false;

function dedupeKey(serveId, type) {
  return `${serveId}:${type}`;
}

function pruneInteractionCounts(now = Date.now()) {
  for (const [key, rec] of interactionCounts) {
    if (!rec || rec.exp <= now) interactionCounts.delete(key);
  }
}

function acceptInteraction(serveId) {
  const now = Date.now();
  let rec = interactionCounts.get(serveId);
  if (!rec || rec.exp <= now) {
    rec = { count: 0, exp: now + INTERACTION_TTL_MS };
  }
  if (rec.count >= INTERACTION_MAX) {
    return false;
  }
  rec.count += 1;
  interactionCounts.set(serveId, rec);
  return true;
}

function enqueue(event) {
  if (DEDUPE_TYPES.has(event.type)) {
    event.dedupe_key = event.dedupe_key || dedupeKey(event.serve_id, event.type);
  } else if (event.type === 'interaction') {
    event.dedupe_key = null;
    if (!acceptInteraction(event.serve_id)) {
      return { accepted: false, reason: 'limit' };
    }
  }

  buffer.push(event);
  if (buffer.length >= 100) {
    flush().catch((err) => console.error('event flush error', err));
  }
  return { accepted: true };
}

async function flush() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    await db.Event.bulkCreate(batch, { ignoreDuplicates: true });
  } catch (err) {
    console.error('bulkCreate events failed', err);
    buffer.unshift(...batch);
  } finally {
    flushing = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    pruneInteractionCounts();
    flush().catch((err) => console.error('event flush error', err));
  }, 2000);
  if (typeof timer.unref === 'function') timer.unref();
}

async function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await flush();
}

function getStats() {
  return {
    pending: buffer.length,
    flushing,
    interaction_keys: interactionCounts.size,
    interaction_max_per_serve: INTERACTION_MAX,
  };
}

module.exports = {
  enqueue,
  flush,
  start,
  stop,
  getStats,
  INTERACTION_MAX,
};
