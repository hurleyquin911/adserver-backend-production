'use strict';

module.exports = (sequelize, DataTypes) => {
  const BillingRateHistory = sequelize.define(
    'BillingRateHistory',
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
      old_cpm_usd: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
      },
      new_cpm_usd: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
      },
      changed_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
    },
    {
      tableName: 'billing_rate_history',
      timestamps: true,
      updatedAt: false,
      underscored: true,
    }
  );

  BillingRateHistory.associate = (models) => {
    BillingRateHistory.belongsTo(models.Creative, { foreignKey: 'creative_id', as: 'creative' });
    BillingRateHistory.belongsTo(models.User, { foreignKey: 'changed_by', as: 'changedBy' });
  };

  return BillingRateHistory;
};
