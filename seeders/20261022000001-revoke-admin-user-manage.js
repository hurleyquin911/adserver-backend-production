'use strict';

/**
 * Hanya Superadmin yang boleh kelola Users & Roles.
 * Cabut permission user:manage dari role Admin (jika masih terpasang).
 */

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();

    await sequelize.query(
      `DELETE rp FROM role_permissions rp
       INNER JOIN roles r ON r.id = rp.role_id
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE r.name = 'Admin' AND p.code = 'user:manage'`
    );

    await sequelize.query(
      `UPDATE roles SET description = :d, updated_at = :now WHERE name = 'Admin'`,
      {
        replacements: {
          d: 'Operasional Brand yang diikat: campaign, creative, publisher, report',
          now,
        },
      }
    );
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const [[admin]] = await sequelize.query(
      `SELECT id FROM roles WHERE name = 'Admin' LIMIT 1`
    );
    const [[perm]] = await sequelize.query(
      `SELECT id FROM permissions WHERE code = 'user:manage' LIMIT 1`
    );
    if (!admin || !perm) return;

    const [existing] = await sequelize.query(
      `SELECT id FROM role_permissions
       WHERE role_id = :roleId AND permission_id = :permId LIMIT 1`,
      { replacements: { roleId: admin.id, permId: perm.id } }
    );
    if (existing.length) return;

    await queryInterface.bulkInsert('role_permissions', [
      {
        role_id: admin.id,
        permission_id: perm.id,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },
};
