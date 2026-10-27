'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE rp
       FROM role_permissions rp
       INNER JOIN roles r ON r.id = rp.role_id
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE (r.name = 'Users' AND p.code = 'campaign:write')
          OR (r.name = 'Admin' AND p.code = 'publisher:manage')`
    );

    await queryInterface.sequelize.query(
      `UPDATE roles
       SET description = CASE name
         WHEN 'Admin' THEN 'Operasional Brand yang diikat: campaign, creative, dan report'
         WHEN 'Users' THEN 'Melihat campaign dan mengelola creative serta report untuk Brand-nya'
         ELSE description
       END,
       updated_at = NOW()
       WHERE name IN ('Admin', 'Users')`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r
       INNER JOIN permissions p ON p.code = 'campaign:write'
       LEFT JOIN role_permissions rp
         ON rp.role_id = r.id AND rp.permission_id = p.id
       WHERE r.name = 'Users' AND rp.id IS NULL`
    );
    await queryInterface.sequelize.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r
       INNER JOIN permissions p ON p.code = 'publisher:manage'
       LEFT JOIN role_permissions rp
         ON rp.role_id = r.id AND rp.permission_id = p.id
       WHERE r.name = 'Admin' AND rp.id IS NULL`
    );

    await queryInterface.sequelize.query(
      `UPDATE roles
       SET description = CASE name
         WHEN 'Admin' THEN 'Operasional Brand yang diikat: campaign, creative, publisher, report'
         WHEN 'Users' THEN 'Mengelola campaign, creative, dan report untuk Brand-nya'
         ELSE description
       END,
       updated_at = NOW()
       WHERE name IN ('Admin', 'Users')`
    );
  },
};
