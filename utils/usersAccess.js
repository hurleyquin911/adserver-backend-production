const AppError = require('./AppError');
const { isUsersName } = require('../constant/roles');

const USERS_WRITE_MESSAGE = 'Role Users hanya dapat melihat data';
const USERS_ADVERTISER_MESSAGE = 'Role Users tidak dapat mengakses data Advertiser';

function assertNotUsers(user, message = USERS_WRITE_MESSAGE) {
  if (isUsersName(user?.role?.name)) {
    throw new AppError('FORBIDDEN', message, 403);
  }
}

module.exports = {
  assertNotUsers,
  USERS_WRITE_MESSAGE,
  USERS_ADVERTISER_MESSAGE,
};
