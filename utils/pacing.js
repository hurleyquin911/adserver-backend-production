const { rangeStart, rangeEnd } = require('./reportTz');

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * pacingFactor = clamp((expected + 0.05*goal + 1) / (delivered + 0.05*goal + 1), 0.25, 4)
 * expected = goal * (waktu berjalan / durasi periode, 0..1)
 * Tanpa goal, periode invalid, atau pacing mati: 1.
 */
function pacingFactor({
  goal,
  delivered,
  startDate,
  endDate,
  now = new Date(),
  enabled = true,
} = {}) {
  const g = Number(goal) || 0;
  if (!enabled || g <= 0 || !startDate || !endDate) return 1;
  const start = rangeStart(startDate);
  const end = rangeEnd(endDate);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) return 1;
  const elapsed = now.getTime() - start.getTime();
  const progress = clamp(elapsed / duration, 0, 1);
  const expected = g * progress;
  const soft = 0.05 * g + 1;
  const factor = (expected + soft) / (Number(delivered) + soft);
  return clamp(factor, 0.25, 4);
}

function campaignWeight(priority, factor) {
  return Math.max(1, Number(priority) || 1) * Number(factor || 1);
}

function paceStatus({ goal, delivered, startDate, endDate, now = new Date() } = {}) {
  const g = Number(goal) || 0;
  const d = Number(delivered) || 0;
  if (g <= 0) return 'tanpa target';
  if (d >= g) return 'selesai';
  const start = rangeStart(startDate);
  const end = rangeEnd(endDate);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) return 'on track';
  const progress = clamp((now.getTime() - start.getTime()) / duration, 0, 1);
  const expected = g * progress;
  if (expected <= 0) return d > 0 ? 'terlalu cepat' : 'on track';
  const ratio = d / expected;
  if (ratio >= 1.15) return 'terlalu cepat';
  if (ratio <= 0.85) return 'tertinggal';
  return 'on track';
}

function pickWeighted(items, weights, rng = Math.random) {
  if (!items.length) return null;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[items.length - 1];
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

module.exports = { clamp, pacingFactor, campaignWeight, pickWeighted, paceStatus };
