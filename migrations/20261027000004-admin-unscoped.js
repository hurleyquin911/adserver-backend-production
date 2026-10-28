'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE users
       SET advertiser_id = NULL
       WHERE role_id IN (
         SELECT id FROM roles WHERE name = 'Admin'
       )`
    );
    await queryInterface.sequelize.query(
      `UPDATE roles
       SET description = 'Operasional lintas Brand: membuat Brand dan campaign, mengelola creative, dan melihat report',
           updated_at = CURRENT_TIMESTAMP
       WHERE name = 'Admin'`
    );
  },

  async down() {},
};
