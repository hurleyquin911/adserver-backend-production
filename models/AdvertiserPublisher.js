'use strict';

module.exports = (sequelize, DataTypes) => {
  const AdvertiserPublisher = sequelize.define(
    'AdvertiserPublisher',
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
      publisher_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('active', 'pending', 'blocked'),
        allowNull: false,
        defaultValue: 'pending',
      },
      first_seen_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      last_seen_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'advertiser_publishers',
      timestamps: true,
      underscored: true,
    }
  );

  AdvertiserPublisher.associate = (models) => {
    AdvertiserPublisher.belongsTo(models.Advertiser, {
      foreignKey: 'advertiser_id',
      as: 'advertiser',
    });
    AdvertiserPublisher.belongsTo(models.Publisher, {
      foreignKey: 'publisher_id',
      as: 'publisher',
    });
  };

  return AdvertiserPublisher;
};
