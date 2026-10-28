const { Op } = require('sequelize');
const { isSuperadminName, isAdminName } = require('../constant/roles');

/** Superadmin dan Admin beroperasi lintas brand; Users dibatasi ke brand akunnya. */
function isUnscoped(user) {
  return isSuperadminName(user?.role?.name) || isAdminName(user?.role?.name);
}

/** Filter yang tidak cocok baris mana pun untuk Users tanpa brand. */
function noneWhere(field) {
  return { [field]: -1 };
}

function advertiserScopeWhere(user, field = 'advertiser_id') {
  if (isUnscoped(user)) return {};
  if (user.advertiser_id == null) return noneWhere(field);
  return { [field]: user.advertiser_id };
}

function assertAdvertiserAccess(user, advertiserId) {
  if (isUnscoped(user)) return true;
  if (user.advertiser_id == null) return false;
  return String(user.advertiser_id) === String(advertiserId);
}

function campaignScopeInclude(user) {
  return advertiserScopeWhere(user, 'advertiser_id');
}

function mergeWhere(...parts) {
  const filtered = parts.filter((p) => p && Object.keys(p).length > 0);
  if (filtered.length === 0) return {};
  if (filtered.length === 1) return filtered[0];
  return { [Op.and]: filtered };
}

module.exports = {
  isUnscoped,
  advertiserScopeWhere,
  assertAdvertiserAccess,
  campaignScopeInclude,
  mergeWhere,
};
