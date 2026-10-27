/** Tiga role sistem - tidak boleh ditambah lewat UI. */
const ROLE = {
  SUPERADMIN: 'Superadmin',
  ADMIN: 'Admin',
  USERS: 'Users',
};

const SYSTEM_ROLE_NAMES = [ROLE.SUPERADMIN, ROLE.ADMIN, ROLE.USERS];

/** Nama lama (seeder sebelumnya) → nama baru. */
const LEGACY_ROLE_ALIASES = {
  'Super Admin': ROLE.SUPERADMIN,
  'Campaign Manager': ROLE.USERS,
  Viewer: ROLE.USERS,
};

function normalizeRoleName(name) {
  const raw = String(name || '').trim();
  if (LEGACY_ROLE_ALIASES[raw]) return LEGACY_ROLE_ALIASES[raw];
  return raw;
}

function isSuperadminName(name) {
  return normalizeRoleName(name) === ROLE.SUPERADMIN;
}

function isAdminName(name) {
  return normalizeRoleName(name) === ROLE.ADMIN;
}

function isUsersName(name) {
  return normalizeRoleName(name) === ROLE.USERS;
}

module.exports = {
  ROLE,
  SYSTEM_ROLE_NAMES,
  LEGACY_ROLE_ALIASES,
  normalizeRoleName,
  isSuperadminName,
  isAdminName,
  isUsersName,
};
