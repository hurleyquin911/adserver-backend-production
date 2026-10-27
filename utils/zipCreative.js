const path = require('path');
const AdmZip = require('adm-zip');
const AppError = require('./AppError');
const env = require('../config/env');

const SAFE_EXT = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.ogg',
  '.mp3',
  '.wav',
  '.ico',
  '.txt',
  '.xml',
]);

function assertSafeEntryName(name) {
  const normalized = String(name).replace(/\\/g, '/');
  const posixNorm = path.posix.normalize(normalized);
  if (
    normalized.includes('..') ||
    posixNorm.includes('..') ||
    posixNorm.startsWith('../') ||
    path.isAbsolute(normalized) ||
    normalized.startsWith('/') ||
    normalized.startsWith('\\') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new AppError('INVALID_ZIP', 'Path traversal terdeteksi di ZIP', 400);
  }
  return normalized.replace(/^(\.\/)+/, '');
}

function extractAndValidateZip(buffer, options = {}) {
  const maxUncompressed = options.maxUncompressedBytes ?? env.ZIP_MAX_UNCOMPRESSED_BYTES;
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new AppError('INVALID_ZIP', 'File ZIP tidak valid', 400);
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length === 0) {
    throw new AppError('INVALID_ZIP', 'ZIP kosong', 400);
  }
  if (entries.length > env.ZIP_MAX_FILES) {
    throw new AppError('INVALID_ZIP', 'Jumlah file di ZIP melebihi batas', 400);
  }

  let total = 0;
  let hasIndex = false;
  const files = [];

  for (const entry of entries) {
    const name = assertSafeEntryName(entry.entryName);
    const ext = path.extname(name).toLowerCase();
    if (!SAFE_EXT.has(ext)) {
      throw new AppError('INVALID_ZIP', `Ekstensi tidak diizinkan: ${ext || '(tanpa ekstensi)'}`, 400);
    }
    // Ukuran aktual hasil ekstraksi, bukan header ZIP.
    const data = entry.getData();
    total += data.length;
    if (total > maxUncompressed) {
      throw new AppError('INVALID_ZIP', 'Ukuran terekstrak ZIP melebihi batas (zip bomb)', 400);
    }
    if (name === 'index.html' || name.endsWith('/index.html')) {
      hasIndex = true;
    }
    files.push({ name, data });
  }

  if (!hasIndex) {
    throw new AppError('INVALID_ZIP', 'ZIP wajib berisi index.html', 400);
  }

  return { files, totalSize: total, entryFile: 'index.html' };
}

module.exports = { extractAndValidateZip, assertSafeEntryName, SAFE_EXT };
