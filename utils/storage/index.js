const env = require('../../config/env');
const LocalStorage = require('./LocalStorage');
const CdnStorage = require('./CdnStorage');

function getStorage() {
  if (env.STORAGE_DRIVER === 'cdn') {
    return new CdnStorage();
  }
  return new LocalStorage();
}

module.exports = { getStorage };
