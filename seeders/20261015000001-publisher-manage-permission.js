'use strict';

/** Idempotent: migration 20261015000002 sudah menambah permission ini. */
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM permissions WHERE code = 'publisher:manage' LIMIT 1`
    );
    if (existing.length) return;

    await queryInterface.bulkInsert('permissions', [
      {
        code: 'publisher:manage',
        description: 'Approve, block, and activate detected publishers',
      },
    ]);
    const [permRows] = await queryInterface.sequelize.query(
      `SELECT id FROM permissions WHERE code = 'publisher:manage' LIMIT 1`
    );
    const permId = permRows[0] && permRows[0].id;
    if (!permId) return;
    const [roleRows] = await queryInterface.sequelize.query(
      `SELECT id FROM roles WHERE name IN ('Superadmin', 'Super Admin', 'Admin')`
    );
    const rows = roleRows.map((r) => ({ role_id: r.id, permission_id: permId }));
    if (rows.length) await queryInterface.bulkInsert('role_permissions', rows);
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
