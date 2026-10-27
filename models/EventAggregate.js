'use strict';

module.exports = (sequelize, DataTypes) => {
  const EventAggregate = sequelize.define(
    'EventAggregate',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      bucket_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Hour bucket start',
      },
      campaign_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      creative_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      placement_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      publisher_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      device_type: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: '',
      },
      slot_size: {
        type: DataTypes.STRING(12),
        allowNull: false,
        defaultValue: '',
      },
      interaction_name: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: '',
      },
      type: {
        type: DataTypes.ENUM(
          'impression',
          'viewable_impression',
          'click',
          'interaction',
          'request',
          'no_fill',
          'interaction_unique'
        ),
        allowNull: false,
      },
      count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'event_aggregates',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: [
            'bucket_at',
            'campaign_id',
            'creative_id',
            'publisher_id',
            'device_type',
            'slot_size',
            'type',
            'interaction_name',
          ],
          name: 'event_aggregates_v2_unique',
        },
      ],
    }
  );

  EventAggregate.associate = (models) => {
    EventAggregate.belongsTo(models.Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
    EventAggregate.belongsTo(models.Creative, { foreignKey: 'creative_id', as: 'creative' });
    EventAggregate.belongsTo(models.Placement, { foreignKey: 'placement_id', as: 'placement' });
    EventAggregate.belongsTo(models.Publisher, { foreignKey: 'publisher_id', as: 'publisher' });
  };

  return EventAggregate;
};
