'use strict';

const { USERS_READ_PERMISSIONS } = require('../constant/permissions');
const { USERS_ROLE_DESCRIPTION } = require('../constant/roles');

const PREVIOUS_USERS_DESCRIPTION =
  'Melihat campaign dan mengelola creative serta report untuk Brand-nya';

function sqlList(sequelize, codes) {
  return codes.map((code) => sequelize.escape(code)).join(', ');
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const readList = sqlList(sequelize, USERS_READ_PERMISSIONS);

    await sequelize.query(
      `DELETE rp
       FROM role_permissions rp
       INNER JOIN roles r ON r.id = rp.role_id
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE r.name = 'Users'
         AND p.code NOT IN (${readList})`
    );

    await sequelize.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r
       INNER JOIN permissions p ON p.code IN (${readList})
       LEFT JOIN role_permissions rp
         ON rp.role_id = r.id AND rp.permission_id = p.id
       WHERE r.name = 'Users' AND rp.id IS NULL`
    );

    await sequelize.query(
      `UPDATE roles
       SET description = :description, updated_at = NOW()
       WHERE name = 'Users'`,
      { replacements: { description: USERS_ROLE_DESCRIPTION } }
    );
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r
       INNER JOIN permissions p ON p.code = 'creative:upload'
       LEFT JOIN role_permissions rp
         ON rp.role_id = r.id AND rp.permission_id = p.id
       WHERE r.name = 'Users' AND rp.id IS NULL`
    );
    await sequelize.query(
      `UPDATE roles
       SET description = :description, updated_at = NOW()
       WHERE name = 'Users'`,
      { replacements: { description: PREVIOUS_USERS_DESCRIPTION } }
    );
  },
};
