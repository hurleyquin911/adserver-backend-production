const { z } = require('zod');

const sizeTokenSchema = z
  .string()
  .regex(/^\d{1,4}x\d{1,4}$/i);

function parseOneSize(token) {
  const s = String(token || '').trim();
  const parsed = sizeTokenSchema.safeParse(s);
  if (!parsed.success) return null;
  const [wRaw, hRaw] = s.toLowerCase().split('x');
  const width = Number(wRaw);
  const height = Number(hRaw);
  if (width < 1 || width > 4000 || height < 1 || height > 4000) return null;
  return { width, height, key: `${width}x${height}` };
}

function parseSizeQuery(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { ok: false, error: 'Parameter size wajib' };
  if (parts.length > 5) return { ok: false, error: 'Maksimal 5 ukuran' };
  const sizes = [];
  const seen = new Set();
  for (const part of parts) {
    const one = parseOneSize(part);
    if (!one) return { ok: false, error: 'Format size tidak valid (contoh 300x250)' };
    if (seen.has(one.key)) continue;
    seen.add(one.key);
    sizes.push(one);
  }
  return { ok: true, sizes };
}

function sizeKey(width, height) {
  return `${Number(width)}x${Number(height)}`;
}

function sanitizePagePath(raw) {
  let s = String(raw || '');
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  s = s.split('?')[0].split('#')[0];
  if (!s) s = '/';
  if (!s.startsWith('/')) s = `/${s}`;
  return s.slice(0, 255);
}

module.exports = { parseOneSize, parseSizeQuery, sizeKey, sanitizePagePath };
