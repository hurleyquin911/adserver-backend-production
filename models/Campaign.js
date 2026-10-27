'use strict';

module.exports = (sequelize, DataTypes) => {
  const Campaign = sequelize.define(
    'Campaign',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      advertiser_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('draft', 'active', 'paused', 'ended'),
        allowNull: false,
        defaultValue: 'draft',
      },
      priority: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      impression_goal: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'campaigns',
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );

  Campaign.associate = (models) => {
    Campaign.belongsTo(models.Advertiser, { foreignKey: 'advertiser_id', as: 'advertiser' });
    Campaign.hasMany(models.Creative, { foreignKey: 'campaign_id', as: 'creatives' });
    Campaign.hasMany(models.Event, { foreignKey: 'campaign_id', as: 'events' });
    Campaign.hasMany(models.EventAggregate, { foreignKey: 'campaign_id', as: 'eventAggregates' });
  };

  return Campaign;
};
