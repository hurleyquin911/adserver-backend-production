const AppError = require('../utils/AppError');
const { isAdminName, isUsersName } = require('../constant/roles');

function requireBillingRole(req, _res, next) {
  const roleName = req.user?.role?.name;
  if (!isAdminName(roleName) && !isUsersName(roleName)) {
    return next(new AppError('FORBIDDEN', 'Billing hanya tersedia untuk Admin dan Users', 403));
  }
  return next();
}

module.exports = requireBillingRole;
