function normalizeRate(value) {
  return value == null ? null : Number(value);
}

async function recordRateChange({
  creativeId,
  oldRate,
  newRate,
  changedBy,
  reason,
  transaction,
}) {
  const previous = normalizeRate(oldRate);
  const next = normalizeRate(newRate);
  if (previous === next) return null;

  const { BillingRateHistory } = require('../models');
  return BillingRateHistory.create(
    {
      creative_id: creativeId,
      old_cpm_usd: previous,
      new_cpm_usd: next,
      changed_by: changedBy,
      reason,
    },
    { transaction }
  );
}

module.exports = { normalizeRate, recordRateChange };
