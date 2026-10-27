'use strict';

/**
 * Skema tag universal (non-destruktif).
 * Sites/Placements/creative_placements tidak dihapus.
 * campaign_id/creative_id di events jadi nullable; di aggregates memakai 0 = "tidak ada".
 */

async function dropForeignKeysOnColumns(queryInterface, table, columns) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT DISTINCT CONSTRAINT_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME IN (:columns)
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { replacements: { table, columns } }
  );
  for (const row of rows) {
    await queryInterface.removeConstraint(table, row.CONSTRAINT_NAME);
  }
}

async function indexExists(queryInterface, table, name) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME = :name
     LIMIT 1`,
    { replacements: { table, name } }
  );
  return rows.length > 0;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const idPk = {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.BIGINT.UNSIGNED,
    };
    const timestamps = {
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    };

    await queryInterface.createTable('publishers', {
      id: idPk,
      host: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      status: {
        type: Sequelize.ENUM('active', 'pending', 'blocked'),
        allowNull: false,
        defaultValue: 'active',
      },
      first_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      ...timestamps,
    });

    await queryInterface.addColumn('events', 'publisher_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: 'publishers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('events', 'slot_size', {
      type: Sequelize.STRING(12),
      allowNull: true,
    });
    await queryInterface.addColumn('events', 'page_path', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await dropForeignKeysOnColumns(queryInterface, 'events', [
      'campaign_id',
      'creative_id',
      'placement_id',
    ]);

    await queryInterface.changeColumn('events', 'campaign_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
    });
    await queryInterface.changeColumn('events', 'creative_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
    });
    await queryInterface.changeColumn('events', 'placement_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
    });

    await queryInterface.addConstraint('events', {
      fields: ['campaign_id'],
      type: 'foreign key',
      name: 'events_campaign_id_fk',
      references: { table: 'campaigns', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addConstraint('events', {
      fields: ['creative_id'],
      type: 'foreign key',
      name: 'events_creative_id_fk',
      references: { table: 'creatives', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addConstraint('events', {
      fields: ['placement_id'],
      type: 'foreign key',
      name: 'events_placement_id_fk',
      references: { table: 'placements', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE events MODIFY COLUMN \`type\` ENUM(
        'impression','viewable_impression','click','interaction','request','no_fill'
      ) NOT NULL`
    );

    if (!(await indexExists(queryInterface, 'events', 'events_campaign_type_occurred_idx'))) {
      await queryInterface.addIndex('events', ['campaign_id', 'type', 'occurred_at'], {
        name: 'events_campaign_type_occurred_idx',
      });
    }
    if (!(await indexExists(queryInterface, 'events', 'events_publisher_occurred_idx'))) {
      await queryInterface.addIndex('events', ['publisher_id', 'occurred_at'], {
        name: 'events_publisher_occurred_idx',
      });
    }

    await queryInterface.addColumn('event_aggregates', 'publisher_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('event_aggregates', 'device_type', {
      type: Sequelize.STRING(64),
      allowNull: false,
      defaultValue: '',
    });
    await queryInterface.addColumn('event_aggregates', 'slot_size', {
      type: Sequelize.STRING(12),
      allowNull: false,
      defaultValue: '',
    });
    await queryInterface.addColumn('event_aggregates', 'interaction_name', {
      type: Sequelize.STRING(64),
      allowNull: false,
      defaultValue: '',
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE event_aggregates MODIFY COLUMN \`type\` ENUM(
        'impression','viewable_impression','click','interaction','request','no_fill','interaction_unique'
      ) NOT NULL`
    );

    if (await indexExists(queryInterface, 'event_aggregates', 'event_aggregates_bucket_dims_type_unique')) {
      await queryInterface.removeIndex('event_aggregates', 'event_aggregates_bucket_dims_type_unique');
    }

    await dropForeignKeysOnColumns(queryInterface, 'event_aggregates', [
      'campaign_id',
      'creative_id',
      'placement_id',
    ]);

    await queryInterface.changeColumn('event_aggregates', 'campaign_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.changeColumn('event_aggregates', 'creative_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.changeColumn('event_aggregates', 'placement_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addIndex(
      'event_aggregates',
      [
        'bucket_at',
        'campaign_id',
        'creative_id',
        'publisher_id',
        'device_type',
        'slot_size',
        'type',
        'interaction_name',
      ],
      {
        unique: true,
        name: 'event_aggregates_v2_unique',
      }
    );

    if (!(await indexExists(queryInterface, 'creatives', 'creatives_width_height_status_idx'))) {
      await queryInterface.addIndex('creatives', ['width', 'height', 'status'], {
        name: 'creatives_width_height_status_idx',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    if (await indexExists(queryInterface, 'creatives', 'creatives_width_height_status_idx')) {
      await queryInterface.removeIndex('creatives', 'creatives_width_height_status_idx');
    }
    if (await indexExists(queryInterface, 'event_aggregates', 'event_aggregates_v2_unique')) {
      await queryInterface.removeIndex('event_aggregates', 'event_aggregates_v2_unique');
    }

    await queryInterface.removeColumn('event_aggregates', 'publisher_id');
    await queryInterface.removeColumn('event_aggregates', 'device_type');
    await queryInterface.removeColumn('event_aggregates', 'slot_size');
    await queryInterface.removeColumn('event_aggregates', 'interaction_name');

    await queryInterface.sequelize.query(
      `ALTER TABLE event_aggregates MODIFY COLUMN \`type\` ENUM(
        'impression','viewable_impression','click','interaction'
      ) NOT NULL`
    );

    await queryInterface.addIndex(
      'event_aggregates',
      ['bucket_at', 'campaign_id', 'creative_id', 'placement_id', 'type'],
      { unique: true, name: 'event_aggregates_bucket_dims_type_unique' }
    );

    if (await indexExists(queryInterface, 'events', 'events_campaign_type_occurred_idx')) {
      await queryInterface.removeIndex('events', 'events_campaign_type_occurred_idx');
    }
    if (await indexExists(queryInterface, 'events', 'events_publisher_occurred_idx')) {
      await queryInterface.removeIndex('events', 'events_publisher_occurred_idx');
    }

    await queryInterface.removeColumn('events', 'publisher_id');
    await queryInterface.removeColumn('events', 'slot_size');
    await queryInterface.removeColumn('events', 'page_path');
    await queryInterface.sequelize.query(
      `ALTER TABLE events MODIFY COLUMN \`type\` ENUM(
        'impression','viewable_impression','click','interaction'
      ) NOT NULL`
    );

    await queryInterface.dropTable('publishers');
  },
};
