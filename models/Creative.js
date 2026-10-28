'use strict';

module.exports = (sequelize, DataTypes) => {
  const Creative = sequelize.define(
    'Creative',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      campaign_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      width: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      height: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      storage_driver: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      base_path: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      entry_file: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: 'index.html',
      },
      click_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      cpm_usd: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        defaultValue: null,
      },
      status: {
        type: DataTypes.ENUM('draft', 'active', 'paused'),
        allowNull: false,
        defaultValue: 'draft',
      },
      file_size: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
    },
    {
      tableName: 'creatives',
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [{ fields: ['width', 'height', 'status'], name: 'creatives_width_height_status_idx' }],
    }
  );

  Creative.associate = (models) => {
    Creative.belongsTo(models.Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
    Creative.belongsToMany(models.Placement, {
      through: models.CreativePlacement,
      foreignKey: 'creative_id',
      otherKey: 'placement_id',
      as: 'placements',
    });
    Creative.hasMany(models.CreativePlacement, {
      foreignKey: 'creative_id',
      as: 'creativePlacements',
    });
    Creative.hasMany(models.Event, { foreignKey: 'creative_id', as: 'events' });
    Creative.hasMany(models.EventAggregate, { foreignKey: 'creative_id', as: 'eventAggregates' });
    Creative.hasMany(models.BillingRateHistory, { foreignKey: 'creative_id', as: 'billingRateHistory' });
  };

  return Creative;
};
