'use strict';

module.exports = (sequelize, DataTypes) => {
  const Event = sequelize.define(
    'Event',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      placement_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      creative_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      campaign_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      publisher_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      advertiser_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      serve_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM(
          'impression',
          'viewable_impression',
          'click',
          'interaction',
          'request',
          'no_fill'
        ),
        allowNull: false,
      },
      interaction_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      slot_size: {
        type: DataTypes.STRING(12),
        allowNull: true,
      },
      page_path: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      device_type: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      ip_hash: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      referrer: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      dedupe_key: {
        type: DataTypes.STRING(128),
        allowNull: true,
        unique: true,
      },
    },
    {
      tableName: 'events',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['campaign_id', 'type', 'occurred_at'], name: 'events_campaign_type_occurred_idx' },
        { fields: ['publisher_id', 'occurred_at'], name: 'events_publisher_occurred_idx' },
      ],
    }
  );

  Event.associate = (models) => {
    Event.belongsTo(models.Placement, { foreignKey: 'placement_id', as: 'placement' });
    Event.belongsTo(models.Creative, { foreignKey: 'creative_id', as: 'creative' });
    Event.belongsTo(models.Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
    Event.belongsTo(models.Publisher, { foreignKey: 'publisher_id', as: 'publisher' });
    Event.belongsTo(models.Advertiser, { foreignKey: 'advertiser_id', as: 'advertiser' });
  };

  return Event;
};
