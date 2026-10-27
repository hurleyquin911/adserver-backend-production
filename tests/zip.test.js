const { extractAndValidateZip, assertSafeEntryName } = require('../utils/zipCreative');
const { buildRawZip } = require('./helpers/rawZip');
const AppError = require('../utils/AppError');

describe('ZIP nyata tanpa normalisasi nama', () => {
  test('entri ../x ditolak', () => {
    const buf = buildRawZip([
      { name: '../x.html', data: '<html></html>' },
      { name: 'index.html', data: '<html></html>' },
    ]);
    expect(() => extractAndValidateZip(buf)).toThrow(AppError);
    try {
      extractAndValidateZip(buf);
    } catch (err) {
      expect(err.code).toBe('INVALID_ZIP');
    }
  });

  test('path absolut ditolak', () => {
    const buf = buildRawZip([
      { name: '/abs/path.js', data: 'alert(1)' },
      { name: 'index.html', data: '<html></html>' },
    ]);
    expect(() => extractAndValidateZip(buf)).toThrow(AppError);
  });

  test('zip bomb ukuran aktual ditolak', () => {
    const buf = buildRawZip([
      { name: 'index.html', data: Buffer.alloc(200, 97) },
    ]);
    expect(() => extractAndValidateZip(buf, { maxUncompressedBytes: 50 })).toThrow(AppError);
    try {
      extractAndValidateZip(buf, { maxUncompressedBytes: 50 });
    } catch (err) {
      expect(err.message).toMatch(/zip bomb|melebihi batas/i);
    }
  });

  test('ZIP tanpa index.html ditolak', () => {
    const buf = buildRawZip([{ name: 'style.css', data: 'body{}' }]);
    expect(() => extractAndValidateZip(buf)).toThrow(AppError);
  });

  test('assertSafeEntryName menolak traversal', () => {
    expect(() => assertSafeEntryName('../evil.js')).toThrow();
  });
});
