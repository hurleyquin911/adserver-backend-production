'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeIndex('events', 'events_serve_id_type_unique');

    await queryInterface.addColumn('events', 'dedupe_key', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE events
      SET dedupe_key = CONCAT(serve_id, ':', type)
      WHERE type IN ('impression', 'viewable_impression', 'click')
    `);

    await queryInterface.addIndex('events', ['dedupe_key'], {
      unique: true,
      name: 'events_dedupe_key_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('events', 'events_dedupe_key_unique');
    await queryInterface.removeColumn('events', 'dedupe_key');
    await queryInterface.addIndex('events', ['serve_id', 'type'], {
      unique: true,
      name: 'events_serve_id_type_unique',
    });
  },
};
