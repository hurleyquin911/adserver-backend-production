'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('permissions', [
      {
        code: 'report:aggregate',
        description: 'Run hourly report aggregation',
      },
    ]);

    const [permRows] = await queryInterface.sequelize.query(
      `SELECT id FROM permissions WHERE code = 'report:aggregate' LIMIT 1`
    );
    const [roleRows] = await queryInterface.sequelize.query(
      `SELECT id, name FROM roles WHERE name IN ('Super Admin', 'Admin')`
    );
    const permId = permRows[0] && permRows[0].id;
    if (!permId) return;
    const rows = roleRows.map((r) => ({
      role_id: r.id,
      permission_id: permId,
    }));
    if (rows.length) {
      await queryInterface.bulkInsert('role_permissions', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE rp FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'report:aggregate'`
    );
    await queryInterface.bulkDelete('permissions', { code: 'report:aggregate' });
  },
};
