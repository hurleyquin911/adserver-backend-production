const multer = require('multer');
const env = require('../config/env');
const AppError = require('../utils/AppError');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      return cb(new AppError('VALIDATION_ERROR', 'Hanya file .zip yang diizinkan', 400));
    }
    return cb(null, true);
  },
});

module.exports = upload;
