'use strict';

const crypto = require('crypto');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('advertisers', 'tag_key', {
      type: Sequelize.STRING(32),
      allowNull: true,
      after: 'status',
    });

    const [advertisers] = await queryInterface.sequelize.query(
      'SELECT id FROM advertisers WHERE tag_key IS NULL'
    );
    for (const row of advertisers) {
      const tagKey = crypto.randomBytes(12).toString('hex');
      await queryInterface.sequelize.query(
        'UPDATE advertisers SET tag_key = :tagKey WHERE id = :id',
        { replacements: { tagKey, id: row.id } }
      );
    }

    await queryInterface.changeColumn('advertisers', 'tag_key', {
      type: Sequelize.STRING(32),
      allowNull: false,
    });
    await queryInterface.addIndex('advertisers', ['tag_key'], {
      unique: true,
      name: 'advertisers_tag_key_uq',
    });

    await queryInterface.addColumn('events', 'advertiser_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      after: 'publisher_id',
      references: { model: 'advertisers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('events', ['advertiser_id', 'occurred_at'], {
      name: 'events_advertiser_occurred_idx',
    });

    await queryInterface.createTable('advertiser_publishers', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      advertiser_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'advertisers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      publisher_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'publishers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('active', 'pending', 'blocked'),
        allowNull: false,
        defaultValue: 'pending',
      },
      first_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
    await queryInterface.addIndex('advertiser_publishers', ['advertiser_id', 'publisher_id'], {
      unique: true,
      name: 'advertiser_publishers_adv_pub_uq',
    });
    await queryInterface.addIndex('advertiser_publishers', ['advertiser_id', 'status'], {
      name: 'advertiser_publishers_adv_status_idx',
    });

    // Backfill dari event yang sudah punya campaign → advertiser
    await queryInterface.sequelize.query(`
      INSERT INTO advertiser_publishers
        (advertiser_id, publisher_id, status, first_seen_at, last_seen_at, created_at, updated_at)
      SELECT
        c.advertiser_id,
        e.publisher_id,
        COALESCE(p.status, 'pending'),
        MIN(e.occurred_at),
        MAX(e.occurred_at),
        NOW(),
        NOW()
      FROM events e
      INNER JOIN campaigns c ON c.id = e.campaign_id
      INNER JOIN publishers p ON p.id = e.publisher_id
      WHERE e.publisher_id IS NOT NULL
        AND c.advertiser_id IS NOT NULL
      GROUP BY c.advertiser_id, e.publisher_id, p.status
      ON DUPLICATE KEY UPDATE
        last_seen_at = GREATEST(advertiser_publishers.last_seen_at, VALUES(last_seen_at)),
        first_seen_at = LEAST(advertiser_publishers.first_seen_at, VALUES(first_seen_at))
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('advertiser_publishers');
    await queryInterface.removeIndex('events', 'events_advertiser_occurred_idx').catch(() => {});
    await queryInterface.removeColumn('events', 'advertiser_id');
    await queryInterface.removeIndex('advertisers', 'advertisers_tag_key_uq').catch(() => {});
    await queryInterface.removeColumn('advertisers', 'tag_key');
  },
};
