'use strict';

/**
 * Fresh install: 3 role tetap - Superadmin, Admin, Users.
 * Idempotent: aman meski migration sudah menyisipkan permission lain
 * (report:aggregate, publisher:manage) dengan id auto-increment.
 */

async function ensurePermission(queryInterface, sequelize, { code, description }) {
  const [rows] = await sequelize.query(
    `SELECT id FROM permissions WHERE code = :code LIMIT 1`,
    { replacements: { code } }
  );
  if (rows.length) return Number(rows[0].id);

  await queryInterface.bulkInsert('permissions', [{ code, description }]);
  const [created] = await sequelize.query(
    `SELECT id FROM permissions WHERE code = :code LIMIT 1`,
    { replacements: { code } }
  );
  return Number(created[0].id);
}

async function ensureRole(queryInterface, sequelize, { name, description, now }) {
  const [rows] = await sequelize.query(
    `SELECT id FROM roles WHERE name = :name LIMIT 1`,
    { replacements: { name } }
  );
  if (rows.length) return Number(rows[0].id);

  await queryInterface.bulkInsert('roles', [
    { name, description, created_at: now, updated_at: now },
  ]);
  const [created] = await sequelize.query(
    `SELECT id FROM roles WHERE name = :name LIMIT 1`,
    { replacements: { name } }
  );
  return Number(created[0].id);
}

async function ensureRolePermission(queryInterface, sequelize, roleId, permissionId) {
  const [rows] = await sequelize.query(
    `SELECT id FROM role_permissions
     WHERE role_id = :roleId AND permission_id = :permissionId LIMIT 1`,
    { replacements: { roleId, permissionId } }
  );
  if (rows.length) return;

  await queryInterface.bulkInsert('role_permissions', [
    { role_id: roleId, permission_id: permissionId },
  ]);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();

    const permissionDefs = [
      { code: 'campaign:read', description: 'View campaigns and related data' },
      { code: 'campaign:write', description: 'Create and update campaigns' },
      { code: 'creative:upload', description: 'Upload and manage creatives' },
      { code: 'placement:manage', description: 'Manage sites and placements' },
      { code: 'report:read', description: 'View reports and analytics' },
      { code: 'user:manage', description: 'Manage users and roles' },
    ];

    const permissionIds = {};
    for (const def of permissionDefs) {
      permissionIds[def.code] = await ensurePermission(queryInterface, sequelize, def);
    }

    const superId = await ensureRole(queryInterface, sequelize, {
      name: 'Superadmin',
      description: 'Akses penuh sistem, termasuk Users & Roles',
      now,
    });
    const adminId = await ensureRole(queryInterface, sequelize, {
      name: 'Admin',
      description: 'Operasional Brand yang diikat: campaign, creative, dan report',
      now,
    });
    const usersId = await ensureRole(queryInterface, sequelize, {
      name: 'Users',
      description: 'Melihat campaign dan mengelola creative serta report untuk Brand-nya',
      now,
    });

    const superCodes = [
      'campaign:read',
      'campaign:write',
      'creative:upload',
      'placement:manage',
      'report:read',
      'user:manage',
    ];
    const adminCodes = [
      'campaign:read',
      'campaign:write',
      'creative:upload',
      'placement:manage',
      'report:read',
    ];
    const usersCodes = ['campaign:read', 'creative:upload', 'report:read'];

    for (const code of superCodes) {
      await ensureRolePermission(queryInterface, sequelize, superId, permissionIds[code]);
    }
    for (const code of adminCodes) {
      await ensureRolePermission(queryInterface, sequelize, adminId, permissionIds[code]);
    }
    for (const code of usersCodes) {
      await ensureRolePermission(queryInterface, sequelize, usersId, permissionIds[code]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('role_permissions', null, {});
    await queryInterface.bulkDelete('roles', null, {});
    await queryInterface.bulkDelete(
      'permissions',
      {
        code: [
          'campaign:read',
          'campaign:write',
          'creative:upload',
          'placement:manage',
          'report:read',
          'user:manage',
        ],
      },
      {}
    );
  },
};
