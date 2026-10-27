const { requestUrlForLog } = require('../utils/requestLog');

describe('Morgan URL redaction', () => {
  test('menghapus query token pada /track/click dan /ad/*', () => {
    expect(requestUrlForLog({ originalUrl: '/track/click?t=secret.token' })).toBe('/track/click');
    expect(requestUrlForLog({ originalUrl: '/ad/frame?p=abc&t=secret' })).toBe('/ad/frame');
    expect(requestUrlForLog({ originalUrl: '/ad/serve?p=abc' })).toBe('/ad/serve');
    expect(requestUrlForLog({ originalUrl: '/auth/login' })).toBe('/auth/login');
  });
});
