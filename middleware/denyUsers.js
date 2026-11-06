const { assertNotUsers, USERS_ADVERTISER_MESSAGE } = require('../utils/usersAccess');

/** Menolak seluruh akses role Users, termasuk baca. */
function denyUsers(req, res, next) {
  try {
    assertNotUsers(req.user, USERS_ADVERTISER_MESSAGE);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = denyUsers;
