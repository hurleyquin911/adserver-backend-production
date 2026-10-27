const AppError = require('../utils/AppError');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  if (err.name === 'ZodError' || err.name === '$ZodError') {
    const issues = Array.isArray(err.issues) ? err.issues : [];
    const first = issues[0];
    const message =
      first && typeof first.message === 'string' && first.message
        ? first.message
        : 'Validasi gagal';
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details: issues,
      },
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Data sudah ada' },
    });
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'Tidak bisa dihapus karena masih dipakai data lain',
      },
    });
  }

  console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server' },
  });
}

module.exports = errorHandler;
