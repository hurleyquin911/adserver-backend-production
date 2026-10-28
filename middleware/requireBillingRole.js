const AppError = require('../utils/AppError');
const { isAdminName, isUsersName, isSuperadminName } = require('../constant/roles');

function requireBillingRole(req, _res, next) {
  const roleName = req.user?.role?.name;
  if (!isAdminName(roleName) && !isUsersName(roleName) && !isSuperadminName(roleName)) {
    return next(new AppError('FORBIDDEN', 'Role ini tidak memiliki akses Billing', 403));
  }
  return next();
}

module.exports = requireBillingRole;
