'use strict';

module.exports = (sequelize, DataTypes) => {
  const Publisher = sequelize.define(
    'Publisher',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      host: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
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
      tableName: 'publishers',
      timestamps: true,
      underscored: true,
    }
  );

  Publisher.associate = (models) => {
    Publisher.hasMany(models.Event, { foreignKey: 'publisher_id', as: 'events' });
    Publisher.hasMany(models.AdvertiserPublisher, {
      foreignKey: 'publisher_id',
      as: 'advertiserLinks',
    });
    Publisher.belongsToMany(models.Advertiser, {
      through: models.AdvertiserPublisher,
      foreignKey: 'publisher_id',
      otherKey: 'advertiser_id',
      as: 'advertisers',
    });
  };

  return Publisher;
};
