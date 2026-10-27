const fs = require('fs/promises');
const path = require('path');
const env = require('../../config/env');

class LocalStorage {
  constructor() {
    this.root = path.join(__dirname, '..', '..', 'public', 'creatives');
  }

  async upload(key, buffer) {
    const full = path.join(this.root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
    return key;
  }

  async delete(key) {
    const full = path.join(this.root, key);
    await fs.rm(full, { recursive: true, force: true });
  }

  async exists(key) {
    const full = path.join(this.root, key);
    try {
      await fs.access(full);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  getUrl(key) {
    const normalized = String(key).replace(/\\/g, '/');
    return `${env.PUBLIC_BASE_URL}/creatives/${normalized}`;
  }
}

module.exports = LocalStorage;
