const AppError = require('../AppError');

class CdnStorage {
  async upload() {
    throw new AppError(
      'NOT_IMPLEMENTED',
      'CdnStorage belum diimplementasikan. Isi adapter ini dengan kredensial CDN client.',
      501
    );
  }

  async delete() {
    throw new AppError('NOT_IMPLEMENTED', 'CdnStorage belum diimplementasikan', 501);
  }

  getUrl() {
    throw new AppError('NOT_IMPLEMENTED', 'CdnStorage belum diimplementasikan', 501);
  }
}

module.exports = CdnStorage;
