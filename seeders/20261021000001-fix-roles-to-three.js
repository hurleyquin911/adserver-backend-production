'use strict';

/**
 * Migrasi data existing → 3 role: Superadmin, Admin, Users.
 * Idempotent. Tidak mengubah permission codes.
 */

async function ensureRole(queryInterface, sequelize, { name, description, now }) {
  const [rows] = await sequelize.query(`SELECT id FROM roles WHERE name = :name LIMIT 1`, {
    replacements: { name },
  });
  if (rows.length) return Number(rows[0].id);

  await queryInterface.bulkInsert('roles', [
    { name, description, created_at: now, updated_at: now },
  ]);
  const [created] = await sequelize.query(`SELECT id FROM roles WHERE name = :name LIMIT 1`, {
    replacements: { name },
  });
  return Number(created[0].id);
}

async function permissionIdByCode(sequelize, code) {
  const [rows] = await sequelize.query(`SELECT id FROM permissions WHERE code = :code LIMIT 1`, {
    replacements: { code },
  });
  return rows[0] ? Number(rows[0].id) : null;
}

async function setRolePermissions(queryInterface, sequelize, roleId, codes) {
  await sequelize.query(`DELETE FROM role_permissions WHERE role_id = :roleId`, {
    replacements: { roleId },
  });
  const rows = [];
  for (const code of codes) {
    const pid = await permissionIdByCode(sequelize, code);
    if (pid) rows.push({ role_id: roleId, permission_id: pid });
  }
  if (rows.length) await queryInterface.bulkInsert('role_permissions', rows);
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();

    // Rename Super Admin → Superadmin jika masih nama lama
    await sequelize.query(
      `UPDATE roles SET name = 'Superadmin', description = 'Akses penuh sistem, termasuk Users & Roles', updated_at = :now
       WHERE name = 'Super Admin'`,
      { replacements: { now } }
    );

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

    // Pindahkan user dari role lama ke Users
    await sequelize.query(
      `UPDATE users SET role_id = :usersId, updated_at = :now
       WHERE role_id IN (SELECT id FROM (SELECT id FROM roles WHERE name IN ('Campaign Manager', 'Viewer')) AS t)`,
      { replacements: { usersId, now } }
    );

    // Hapus role lama yang bukan 3 sistem
    await sequelize.query(
      `DELETE FROM role_permissions WHERE role_id IN (
         SELECT id FROM (SELECT id FROM roles WHERE name NOT IN ('Superadmin', 'Admin', 'Users')) AS t
       )`
    );
    await sequelize.query(
      `DELETE FROM roles WHERE name NOT IN ('Superadmin', 'Admin', 'Users')`
    );

    const superCodes = [
      'campaign:read',
      'campaign:write',
      'creative:upload',
      'placement:manage',
      'report:read',
      'report:aggregate',
      'publisher:manage',
      'user:manage',
    ];
    const adminCodes = [
      'campaign:read',
      'campaign:write',
      'creative:upload',
      'placement:manage',
      'report:read',
      'report:aggregate',
    ];
    const usersCodes = ['campaign:read', 'creative:upload', 'report:read'];

    await setRolePermissions(queryInterface, sequelize, superId, superCodes);
    await setRolePermissions(queryInterface, sequelize, adminId, adminCodes);
    await setRolePermissions(queryInterface, sequelize, usersId, usersCodes);

    await sequelize.query(
      `UPDATE roles SET description = :d, updated_at = :now WHERE id = :id`,
      {
        replacements: {
          id: adminId,
          d: 'Operasional Brand yang diikat: campaign, creative, dan report',
          now,
        },
      }
    );
  },

  async down() {
    // Tidak mengembalikan Campaign Manager / Viewer - data sudah digabung ke Users.
  },
};
