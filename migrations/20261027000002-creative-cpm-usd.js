'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('creatives', 'cpm_usd', {
      type: Sequelize.DECIMAL(10, 4),
      allowNull: true,
      defaultValue: null,
      after: 'click_url',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('creatives', 'cpm_usd');
  },
};
