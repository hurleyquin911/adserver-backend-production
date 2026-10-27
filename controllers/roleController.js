const { z } = require('zod');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { SYSTEM_ROLE_NAMES, isSuperadminName } = require('../constant/roles');

const upsertSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(255).optional().nullable(),
  permission_ids: z.array(z.coerce.number().int().positive()).default([]),
});

function serializeRole(role) {
  return {
    id: String(role.id),
    name: role.name,
    description: role.description,
    permissions: (role.permissions || []).map((p) => ({
      id: String(p.id),
      code: p.code,
      description: p.description,
    })),
  };
}

const list = asyncHandler(async (req, res) => {
  const names = isSuperadminName(req.user.role?.name)
    ? SYSTEM_ROLE_NAMES
    : SYSTEM_ROLE_NAMES.filter((n) => !isSuperadminName(n));
  const roles = await db.Role.findAll({
    where: { name: names },
    include: [{ model: db.Permission, as: 'permissions', through: { attributes: [] } }],
    order: [['id', 'ASC']],
  });
  res.json({ data: roles.map(serializeRole) });
});

const listPermissions = asyncHandler(async (req, res) => {
  const permissions = await db.Permission.findAll({ order: [['id', 'ASC']] });
  res.json({
    data: permissions.map((p) => ({
      id: String(p.id),
      code: p.code,
      description: p.description,
    })),
  });
});

const getOne = asyncHandler(async (req, res) => {
  const role = await db.Role.findByPk(req.params.id, {
    include: [{ model: db.Permission, as: 'permissions', through: { attributes: [] } }],
  });
  if (!role || !SYSTEM_ROLE_NAMES.includes(role.name)) {
    throw new AppError('NOT_FOUND', 'Role tidak ditemukan', 404);
  }
  if (isSuperadminName(role.name) && !isSuperadminName(req.user.role?.name)) {
    throw new AppError('NOT_FOUND', 'Role tidak ditemukan', 404);
  }
  res.json({ data: serializeRole(role) });
});

const create = asyncHandler(async (_req, res) => {
  throw new AppError(
    'FORBIDDEN',
    'Role sistem tetap: Superadmin, Admin, Users. Tidak dapat menambah role baru.',
    403
  );
});

const update = asyncHandler(async (req, res) => {
  if (!isSuperadminName(req.user.role?.name)) {
    throw new AppError('FORBIDDEN', 'Hanya Superadmin yang dapat mengubah role', 403);
  }
  const body = upsertSchema
    .partial()
    .extend({
      permission_ids: z.array(z.coerce.number().int().positive()).optional(),
    })
    .parse(req.body);
  const role = await db.Role.findByPk(req.params.id);
  if (!role || !SYSTEM_ROLE_NAMES.includes(role.name)) {
    throw new AppError('NOT_FOUND', 'Role tidak ditemukan', 404);
  }
  // Nama role sistem tidak boleh diganti
  if (body.name != null && body.name !== role.name) {
    throw new AppError('VALIDATION_ERROR', 'Nama role sistem tidak dapat diubah', 400);
  }
  if (body.description !== undefined) role.description = body.description;
  await role.save();
  if (body.permission_ids) {
    await role.setPermissions(body.permission_ids);
  }
  const full = await db.Role.findByPk(role.id, {
    include: [{ model: db.Permission, as: 'permissions', through: { attributes: [] } }],
  });
  res.json({ data: serializeRole(full) });
});

module.exports = { list, listPermissions, getOne, create, update };
