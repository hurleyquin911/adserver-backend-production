'use strict';

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

    const eventTypeEnum = Sequelize.ENUM(
      'impression',
      'viewable_impression',
      'click',
      'interaction'
    );

    await queryInterface.createTable('roles', {
      id: idPk,
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      ...timestamps,
    });

    await queryInterface.createTable('permissions', {
      id: idPk,
      code: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
    });

    await queryInterface.createTable('role_permissions', {
      id: idPk,
      role_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      permission_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'permissions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    });

    await queryInterface.addIndex('role_permissions', ['role_id', 'permission_id'], {
      unique: true,
      name: 'role_permissions_role_id_permission_id_unique',
    });

    await queryInterface.createTable('advertisers', {
      id: idPk,
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      },
      ...timestamps,
    });

    await queryInterface.createTable('users', {
      id: idPk,
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      role_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      advertiser_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'advertisers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      ...timestamps,
    });

    await queryInterface.createTable('campaigns', {
      id: idPk,
      advertiser_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'advertisers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('draft', 'active', 'paused', 'ended'),
        allowNull: false,
        defaultValue: 'draft',
      },
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      impression_goal: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      ...timestamps,
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.createTable('creatives', {
      id: idPk,
      campaign_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'campaigns', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      width: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      height: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      storage_driver: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      base_path: {
        type: Sequelize.STRING(512),
        allowNull: false,
      },
      entry_file: {
        type: Sequelize.STRING(255),
        allowNull: false,
        defaultValue: 'index.html',
      },
      click_url: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('draft', 'active', 'paused'),
        allowNull: false,
        defaultValue: 'draft',
      },
      file_size: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      ...timestamps,
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.createTable('sites', {
      id: idPk,
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      domain: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      ...timestamps,
    });

    await queryInterface.createTable('placements', {
      id: idPk,
      site_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'sites', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      width: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      height: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      ...timestamps,
    });

    await queryInterface.createTable('creative_placements', {
      id: idPk,
      creative_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'creatives', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      placement_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'placements', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    });

    await queryInterface.addIndex('creative_placements', ['creative_id', 'placement_id'], {
      unique: true,
      name: 'creative_placements_creative_id_placement_id_unique',
    });

    await queryInterface.createTable('events', {
      id: idPk,
      placement_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'placements', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      creative_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'creatives', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      campaign_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'campaigns', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      serve_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      type: eventTypeEnum,
      interaction_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      device_type: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      ip_hash: {
        type: Sequelize.STRING(128),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      referrer: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      ...timestamps,
    });

    await queryInterface.addIndex('events', ['serve_id', 'type'], {
      unique: true,
      name: 'events_serve_id_type_unique',
    });
    await queryInterface.addIndex('events', ['occurred_at'], {
      name: 'events_occurred_at_idx',
    });
    await queryInterface.addIndex('events', ['campaign_id'], {
      name: 'events_campaign_id_idx',
    });
    await queryInterface.addIndex('events', ['creative_id'], {
      name: 'events_creative_id_idx',
    });
    await queryInterface.addIndex('events', ['placement_id'], {
      name: 'events_placement_id_idx',
    });
    await queryInterface.addIndex('events', ['type'], {
      name: 'events_type_idx',
    });

    await queryInterface.createTable('event_aggregates', {
      id: idPk,
      bucket_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      campaign_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'campaigns', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      creative_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'creatives', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      placement_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'placements', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: eventTypeEnum,
      count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      ...timestamps,
    });

    await queryInterface.addIndex(
      'event_aggregates',
      ['bucket_at', 'campaign_id', 'creative_id', 'placement_id', 'type'],
      {
        unique: true,
        name: 'event_aggregates_bucket_dims_type_unique',
      }
    );

    await queryInterface.createTable('audit_logs', {
      id: idPk,
      user_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      action: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      entity_type: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      entity_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },
      meta: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      ...timestamps,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('event_aggregates');
    await queryInterface.dropTable('events');
    await queryInterface.dropTable('creative_placements');
    await queryInterface.dropTable('placements');
    await queryInterface.dropTable('sites');
    await queryInterface.dropTable('creatives');
    await queryInterface.dropTable('campaigns');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('advertisers');
    await queryInterface.dropTable('role_permissions');
    await queryInterface.dropTable('permissions');
    await queryInterface.dropTable('roles');
  },
};
