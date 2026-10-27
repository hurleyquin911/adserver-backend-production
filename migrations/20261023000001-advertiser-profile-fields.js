'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('advertisers', 'website_url', {
      type: Sequelize.STRING(512),
      allowNull: true,
      after: 'name',
    });
    await queryInterface.addColumn('advertisers', 'notes', {
      type: Sequelize.TEXT,
      allowNull: true,
      after: 'website_url',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('advertisers', 'notes');
    await queryInterface.removeColumn('advertisers', 'website_url');
  },
};
