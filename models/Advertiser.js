'use strict';

const { generateTagKey } = require('../utils/tagKey');

module.exports = (sequelize, DataTypes) => {
  const Advertiser = sequelize.define(
    'Advertiser',
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
      website_url: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      },
      tag_key: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
    },
    {
      tableName: 'advertisers',
      timestamps: true,
      underscored: true,
      hooks: {
        beforeValidate(instance) {
          if (!instance.tag_key) {
            instance.tag_key = generateTagKey();
          }
        },
      },
    }
  );

  Advertiser.associate = (models) => {
    Advertiser.hasMany(models.User, { foreignKey: 'advertiser_id', as: 'users' });
    Advertiser.hasMany(models.Campaign, { foreignKey: 'advertiser_id', as: 'campaigns' });
    Advertiser.hasMany(models.AdvertiserPublisher, {
      foreignKey: 'advertiser_id',
      as: 'publisherLinks',
    });
    Advertiser.belongsToMany(models.Publisher, {
      through: models.AdvertiserPublisher,
      foreignKey: 'advertiser_id',
      otherKey: 'publisher_id',
      as: 'publishers',
    });
  };

  return Advertiser;
};
