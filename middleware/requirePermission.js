const AppError = require('../utils/AppError');

function requirePermission(...needed) {
  return function check(req, res, next) {
    const perms = req.permissions || [];
    const ok = needed.every((p) => perms.includes(p));
    if (!ok) {
      return next(new AppError('FORBIDDEN', 'Akses ditolak', 403));
    }
    return next();
  };
}

module.exports = requirePermission;
