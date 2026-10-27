/* eslint-disable no-console */
/**
 * Bangun ulang seluruh event_aggregates dari events (dimensi v2).
 *   node scripts/rebuild-aggregates.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const db = require('../models');
const { rebuildAllAggregates } = require('../utils/aggregateEvents');

async function main() {
  const result = await rebuildAllAggregates();
  console.log('rebuild-aggregates', result);
  await db.sequelize.close();
}

main().catch(async (err) => {
  console.error('rebuild-aggregates FAILED', err);
  try {
    await db.sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
