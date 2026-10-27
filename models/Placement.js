'use strict';

module.exports = (sequelize, DataTypes) => {
  const Placement = sequelize.define(
    'Placement',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      site_id: {
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
      key: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
    },
    {
      tableName: 'placements',
      timestamps: true,
      underscored: true,
    }
  );

  Placement.associate = (models) => {
    Placement.belongsTo(models.Site, { foreignKey: 'site_id', as: 'site' });
    Placement.belongsToMany(models.Creative, {
      through: models.CreativePlacement,
      foreignKey: 'placement_id',
      otherKey: 'creative_id',
      as: 'creatives',
    });
    Placement.hasMany(models.CreativePlacement, {
      foreignKey: 'placement_id',
      as: 'creativePlacements',
    });
    Placement.hasMany(models.Event, { foreignKey: 'placement_id', as: 'events' });
    Placement.hasMany(models.EventAggregate, { foreignKey: 'placement_id', as: 'eventAggregates' });
  };

  return Placement;
};
