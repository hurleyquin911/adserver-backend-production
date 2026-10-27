'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM permissions WHERE code = 'publisher:manage' LIMIT 1`
    );
    if (!existing.length) {
      await queryInterface.bulkInsert('permissions', [
        {
          code: 'publisher:manage',
          description: 'Approve, block, and activate detected publishers',
        },
      ]);
    }

    const [permRows] = await queryInterface.sequelize.query(
      `SELECT id FROM permissions WHERE code = 'publisher:manage' LIMIT 1`
    );
    const permId = permRows[0] && permRows[0].id;
    if (!permId) return;

    const [roleRows] = await queryInterface.sequelize.query(
      `SELECT id FROM roles WHERE name IN ('Super Admin', 'Admin')`
    );
    for (const role of roleRows) {
      const [mapped] = await queryInterface.sequelize.query(
        `SELECT id FROM role_permissions
         WHERE role_id = :roleId AND permission_id = :permId LIMIT 1`,
        { replacements: { roleId: role.id, permId } }
      );
      if (!mapped.length) {
        await queryInterface.bulkInsert('role_permissions', [
          { role_id: role.id, permission_id: permId },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE rp FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'publisher:manage'`
    );
    await queryInterface.bulkDelete('permissions', { code: 'publisher:manage' });
  },
};
