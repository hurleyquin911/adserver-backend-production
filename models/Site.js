'use strict';

module.exports = (sequelize, DataTypes) => {
  const Site = sequelize.define(
    'Site',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      domain: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      allowed_domains: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
      },
    },
    {
      tableName: 'sites',
      timestamps: true,
      underscored: true,
    }
  );

  Site.associate = (models) => {
    Site.hasMany(models.Placement, { foreignKey: 'site_id', as: 'placements' });
  };

  return Site;
};
