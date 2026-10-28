'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('billing_rate_history', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      creative_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'creatives', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      old_cpm_usd: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      new_cpm_usd: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      changed_by: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reason: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('billing_rate_history', ['creative_id', 'created_at'], {
      name: 'billing_rate_history_creative_created_idx',
    });

    await queryInterface.sequelize.query(
      `INSERT INTO billing_rate_history
        (creative_id, old_cpm_usd, new_cpm_usd, changed_by, reason, created_at)
       SELECT id, NULL, cpm_usd, NULL,
         'Existing rate recorded during billing history setup; previous changes are unavailable.',
         COALESCE(updated_at, CURRENT_TIMESTAMP)
       FROM creatives
       WHERE cpm_usd IS NOT NULL`
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('billing_rate_history');
  },
};
