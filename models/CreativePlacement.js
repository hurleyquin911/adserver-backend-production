'use strict';

module.exports = (sequelize, DataTypes) => {
  const CreativePlacement = sequelize.define(
    'CreativePlacement',
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      creative_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      placement_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
    },
    {
      tableName: 'creative_placements',
      timestamps: false,
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['creative_id', 'placement_id'],
          name: 'creative_placements_creative_id_placement_id_unique',
        },
      ],
    }
  );

  CreativePlacement.associate = (models) => {
    CreativePlacement.belongsTo(models.Creative, { foreignKey: 'creative_id', as: 'creative' });
    CreativePlacement.belongsTo(models.Placement, { foreignKey: 'placement_id', as: 'placement' });
  };

  return CreativePlacement;
};
