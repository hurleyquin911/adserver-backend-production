const { assertNotUsers } = require('../utils/usersAccess');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Menolak mutasi oleh role Users meski permission tulis masih tertinggal di database. */
function denyUsersWrite(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  try {
    assertNotUsers(req.user);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = denyUsersWrite;
