const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { advertiserScopeWhere, assertAdvertiserAccess, isUnscoped } = require('../utils/scope');
const {
  ROLE,
  SYSTEM_ROLE_NAMES,
  isSuperadminName,
  isAdminName,
  isUsersName,
} = require('../constant/roles');

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(255),
  role_id: z.coerce.number().int().positive(),
  advertiser_id: z.coerce.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  name: z.string().min(1).max(255).optional(),
  role_id: z.coerce.number().int().positive().optional(),
  advertiser_id: z.coerce.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
});

function publicUser(user) {
  return {
    id: String(user.id),
    email: user.email,
    name: user.name,
    role_id: String(user.role_id),
    advertiser_id: user.advertiser_id != null ? String(user.advertiser_id) : null,
    is_active: user.is_active,
    role: user.role ? { id: String(user.role.id), name: user.role.name } : undefined,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function superAdminRole() {
  return (
    (await db.Role.findOne({ where: { name: ROLE.SUPERADMIN } })) ||
    (await db.Role.findOne({ where: { name: 'Super Admin' } }))
  );
}

function requesterIsSuperAdmin(user) {
  return isSuperadminName(user.role?.name);
}

async function assertSystemRole(role) {
  if (!SYSTEM_ROLE_NAMES.includes(role.name) && role.name !== 'Super Admin') {
    throw new AppError('VALIDATION_ERROR', 'Role tidak valid. Hanya Superadmin, Admin, atau Users.', 400);
  }
}

function assertAdvertiserForRole(role, advertiserId) {
  const needsBrand = isUsersName(role.name);
  if (needsBrand && (advertiserId == null || advertiserId === '')) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Pilih Brand untuk role ${ROLE.USERS}`,
      400
    );
  }
  if ((isSuperadminName(role.name) || isAdminName(role.name)) && advertiserId != null && advertiserId !== '') {
    throw new AppError(
      'VALIDATION_ERROR',
      'Brand tidak diperlukan untuk Superadmin atau Admin',
      400
    );
  }
}

async function activeSuperAdminCount() {
  const role = await superAdminRole();
  if (!role) return 0;
  return db.User.count({ where: { role_id: role.id, is_active: true } });
}

async function assertNotLastSuperAdmin(target, { deactivating, demoting }) {
  const sa = await superAdminRole();
  if (!sa || Number(target.role_id) !== Number(sa.id)) return;
  const count = await activeSuperAdminCount();
  if (count <= 1 && (deactivating || demoting)) {
    throw new AppError('VALIDATION_ERROR', 'Tidak dapat menonaktifkan atau menghapus Superadmin terakhir', 400);
  }
}

async function assertCanAssignSuperAdmin(reqUser, roleId) {
  const sa = await superAdminRole();
  if (!sa) return;
  if (Number(roleId) === Number(sa.id) && !requesterIsSuperAdmin(reqUser)) {
    throw new AppError('FORBIDDEN', 'Hanya Superadmin yang dapat menetapkan role Superadmin', 403);
  }
}

async function assertCanChangeSuperAdminRole(reqUser, target, nextRoleId) {
  const sa = await superAdminRole();
  if (!sa) return;
  const targetIsSa = Number(target.role_id) === Number(sa.id);
  const nextIsSa = nextRoleId != null && Number(nextRoleId) === Number(sa.id);
  if ((targetIsSa || nextIsSa) && Number(target.role_id) !== Number(nextRoleId) && !requesterIsSuperAdmin(reqUser)) {
    throw new AppError('FORBIDDEN', 'Hanya Superadmin yang dapat mengubah role Superadmin', 403);
  }
}

/** Non-Superadmin tidak boleh melihat / mengubah / menghapus akun Superadmin. */
async function assertCanManageTargetUser(reqUser, target) {
  if (requesterIsSuperAdmin(reqUser)) return;
  const sa = await superAdminRole();
  if (sa && Number(target.role_id) === Number(sa.id)) {
    throw new AppError('NOT_FOUND', 'User tidak ditemukan', 404);
  }
}

const list = asyncHandler(async (req, res) => {
  const where = { ...advertiserScopeWhere(req.user) };
  if (!requesterIsSuperAdmin(req.user)) {
    const sa = await superAdminRole();
    if (sa) {
      where.role_id = { [db.Sequelize.Op.ne]: sa.id };
    }
  }
  const users = await db.User.findAll({
    where,
    include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
    order: [['id', 'ASC']],
  });
  res.json({ data: users.map(publicUser) });
});

const getOne = asyncHandler(async (req, res) => {
  const user = await db.User.findByPk(req.params.id, {
    include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
  });
  if (!user || !assertAdvertiserAccess(req.user, user.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'User tidak ditemukan', 404);
  }
  await assertCanManageTargetUser(req.user, user);
  res.json({ data: publicUser(user) });
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  if (!isUnscoped(req.user) && req.user.advertiser_id != null) {
    body.advertiser_id = Number(req.user.advertiser_id);
  }
  const role = await db.Role.findByPk(body.role_id);
  if (!role) throw new AppError('VALIDATION_ERROR', 'Role tidak valid', 400);
  await assertSystemRole(role);
  await assertCanAssignSuperAdmin(req.user, body.role_id);
  assertAdvertiserForRole(role, body.advertiser_id ?? null);

  const password_hash = await bcrypt.hash(body.password, 10);
  const user = await db.User.create({
    email: body.email,
    name: body.name,
    role_id: body.role_id,
    advertiser_id: body.advertiser_id ?? null,
    is_active: body.is_active ?? true,
    password_hash,
  });
  const full = await db.User.findByPk(user.id, {
    include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
  });
  res.status(201).json({ data: publicUser(full) });
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const user = await db.User.findByPk(req.params.id, {
    include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
  });
  if (!user || !assertAdvertiserAccess(req.user, user.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'User tidak ditemukan', 404);
  }
  await assertCanManageTargetUser(req.user, user);
  if (!isUnscoped(req.user) && req.user.advertiser_id != null) {
    delete body.advertiser_id;
  }
  if (body.role_id != null) {
    const role = await db.Role.findByPk(body.role_id);
    if (!role) throw new AppError('VALIDATION_ERROR', 'Role tidak valid', 400);
    await assertSystemRole(role);
    await assertCanChangeSuperAdminRole(req.user, user, body.role_id);
    const sa = await superAdminRole();
    const demoting = sa && Number(user.role_id) === Number(sa.id) && Number(body.role_id) !== Number(sa.id);
    if (demoting) {
      await assertNotLastSuperAdmin(user, { deactivating: false, demoting: true });
    }
  }
  if (body.is_active === false) {
    await assertNotLastSuperAdmin(user, { deactivating: true, demoting: false });
  }
  if (body.password) {
    user.password_hash = await bcrypt.hash(body.password, 10);
    delete body.password;
  }
  const nextRoleId = body.role_id != null ? body.role_id : user.role_id;
  const nextRole = await db.Role.findByPk(nextRoleId);
  const nextAdv = nextRole && (isSuperadminName(nextRole.name) || isAdminName(nextRole.name))
    ? null
    : body.advertiser_id !== undefined ? body.advertiser_id : user.advertiser_id;
  if (nextRole) assertAdvertiserForRole(nextRole, nextAdv);
  if (nextRole && (isSuperadminName(nextRole.name) || isAdminName(nextRole.name))) {
    body.advertiser_id = null;
  }
  Object.assign(user, body);
  await user.save();
  const full = await db.User.findByPk(user.id, {
    include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
  });
  res.json({ data: publicUser(full) });
});

const remove = asyncHandler(async (req, res) => {
  const user = await db.User.findByPk(req.params.id, {
    include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
  });
  if (!user || !assertAdvertiserAccess(req.user, user.advertiser_id)) {
    throw new AppError('NOT_FOUND', 'User tidak ditemukan', 404);
  }
  await assertCanManageTargetUser(req.user, user);
  if (String(user.id) === String(req.user.id)) {
    throw new AppError('VALIDATION_ERROR', 'Tidak dapat menghapus diri sendiri', 400);
  }
  await assertNotLastSuperAdmin(user, { deactivating: true, demoting: true });
  await user.destroy();
  res.json({ ok: true });
});

module.exports = { list, getOne, create, update, remove };
