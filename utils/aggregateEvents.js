const { QueryTypes } = require('sequelize');
const db = require('../models');

/**
 * Awal jendela agregasi di-floor ke awal jam agar bucket tertua
 * tidak tertimpa COUNT parsial (event sebelum menit berjalan).
 */
function aggregationWindowStart(sinceHours, now = new Date()) {
  const start = new Date(now.getTime() - Number(sinceHours) * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCMilliseconds(0);
  return start;
}

function toSqlUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function insertTypeCounts(sequelize, windowStartSql) {
  await sequelize.query(
    `
    INSERT INTO event_aggregates
      (bucket_at, campaign_id, creative_id, publisher_id, device_type, slot_size,
       type, interaction_name, placement_id, count, created_at, updated_at)
    SELECT
      DATE_FORMAT(occurred_at, '%Y-%m-%d %H:00:00') AS bucket_at,
      COALESCE(campaign_id, 0) AS campaign_id,
      COALESCE(creative_id, 0) AS creative_id,
      COALESCE(publisher_id, 0) AS publisher_id,
      COALESCE(device_type, '') AS device_type,
      COALESCE(slot_size, '') AS slot_size,
      type,
      COALESCE(IF(type = 'interaction', LEFT(COALESCE(interaction_name, ''), 64), ''), '') AS interaction_name,
      MAX(COALESCE(placement_id, 0)) AS placement_id,
      COUNT(*) AS count,
      NOW(),
      NOW()
    FROM events
    WHERE occurred_at >= :windowStart
    GROUP BY
      DATE_FORMAT(occurred_at, '%Y-%m-%d %H:00:00'),
      COALESCE(campaign_id, 0),
      COALESCE(creative_id, 0),
      COALESCE(publisher_id, 0),
      COALESCE(device_type, ''),
      COALESCE(slot_size, ''),
      type,
      COALESCE(IF(type = 'interaction', LEFT(COALESCE(interaction_name, ''), 64), ''), '')
    ON DUPLICATE KEY UPDATE
      count = VALUES(count),
      placement_id = VALUES(placement_id),
      updated_at = NOW()
    `,
    {
      replacements: { windowStart: windowStartSql },
      type: QueryTypes.INSERT,
    }
  );
}

async function insertInteractionUnique(sequelize, windowStartSql) {
  await sequelize.query(
    `
    INSERT INTO event_aggregates
      (bucket_at, campaign_id, creative_id, publisher_id, device_type, slot_size,
       type, interaction_name, placement_id, count, created_at, updated_at)
    SELECT
      DATE_FORMAT(occurred_at, '%Y-%m-%d %H:00:00') AS bucket_at,
      COALESCE(campaign_id, 0) AS campaign_id,
      COALESCE(creative_id, 0) AS creative_id,
      COALESCE(publisher_id, 0) AS publisher_id,
      COALESCE(device_type, '') AS device_type,
      COALESCE(slot_size, '') AS slot_size,
      'interaction_unique' AS type,
      '' AS interaction_name,
      MAX(COALESCE(placement_id, 0)) AS placement_id,
      COUNT(DISTINCT serve_id) AS count,
      NOW(),
      NOW()
    FROM events
    WHERE occurred_at >= :windowStart AND type = 'interaction'
    GROUP BY
      DATE_FORMAT(occurred_at, '%Y-%m-%d %H:00:00'),
      COALESCE(campaign_id, 0),
      COALESCE(creative_id, 0),
      COALESCE(publisher_id, 0),
      COALESCE(device_type, ''),
      COALESCE(slot_size, '')
    ON DUPLICATE KEY UPDATE
      count = VALUES(count),
      placement_id = VALUES(placement_id),
      updated_at = NOW()
    `,
    {
      replacements: { windowStart: windowStartSql },
      type: QueryTypes.INSERT,
    }
  );
}

async function aggregateEvents({ sinceHours = 48, now } = {}) {
  const sequelize = db.sequelize;
  const windowStart = aggregationWindowStart(sinceHours, now || new Date());
  const windowStartSql = toSqlUtc(windowStart);
  await insertTypeCounts(sequelize, windowStartSql);
  await insertInteractionUnique(sequelize, windowStartSql);
  return { ok: true };
}

async function rebuildAllAggregates() {
  const sequelize = db.sequelize;
  await sequelize.query('DELETE FROM event_aggregates');
  const [rows] = await sequelize.query(`SELECT MIN(occurred_at) AS min_at FROM events`);
  const minAt = rows[0] && rows[0].min_at;
  if (!minAt) return { ok: true, rebuilt: 0 };
  const sinceHours = Math.max(
    1,
    Math.ceil((Date.now() - new Date(minAt).getTime()) / 3600000) + 1
  );
  await aggregateEvents({ sinceHours, now: new Date() });
  const count = await db.EventAggregate.count();
  return { ok: true, rebuilt: count };
}

module.exports = { aggregateEvents, aggregationWindowStart, rebuildAllAggregates };
