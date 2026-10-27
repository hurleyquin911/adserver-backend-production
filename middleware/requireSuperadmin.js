const AppError = require('../utils/AppError');
const { isSuperadminName } = require('../constant/roles');

function requireSuperadmin(req, _res, next) {
  if (!isSuperadminName(req.user?.role?.name)) {
    return next(new AppError('FORBIDDEN', 'Akses ditolak', 403));
  }
  return next();
}

module.exports = requireSuperadmin;
