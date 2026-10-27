const { aggregationWindowStart, aggregateEvents } = require('../utils/aggregateEvents');
const { mysqlOffset } = require('../utils/reportTz');
const db = require('../models');
const { createPlacementKey } = require('../utils/tokens');

describe('Agregasi window floor', () => {
  test('aggregationWindowStart di-floor ke awal jam UTC', () => {
    const now = new Date('2026-10-14T14:37:22.500Z');
    const start = aggregationWindowStart(48, now);
    expect(start.toISOString()).toBe('2026-10-12T14:00:00.000Z');
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
    expect(start.getUTCMilliseconds()).toBe(0);
  });

  test('REPORT_TZ Asia/Jakarta memakai offset +07:00', () => {
    expect(mysqlOffset('Asia/Jakarta')).toBe('+07:00');
  });

  test('agregasi menyertakan event di awal jam tertua (bukan count parsial)', async () => {
    const now = new Date();
    now.setUTCMinutes(37, 0, 0);
    now.setUTCMilliseconds(0);
    const windowStart = aggregationWindowStart(48, now);
    const unfloored = new Date(now.getTime() - 48 * 3600000);
    const early = new Date(windowStart.getTime() + 10 * 60 * 1000);
    const late = new Date(unfloored.getTime() + 10 * 60 * 1000);
    expect(early.getTime()).toBeLessThan(unfloored.getTime());

    const adv = await db.Advertiser.create({
      name: `Agg Adv ${Date.now()}`,
      status: 'active',
    });
    const camp = await db.Campaign.create({
      advertiser_id: adv.id,
      name: 'Agg Camp',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      status: 'active',
      priority: 1,
    });
    const creative = await db.Creative.create({
      campaign_id: camp.id,
      name: 'Agg Creative',
      width: 300,
      height: 250,
      storage_driver: 'local',
      base_path: 'agg-test',
      entry_file: 'index.html',
      click_url: 'https://example.com',
      status: 'active',
      file_size: 1,
    });
    const site = await db.Site.create({ name: 'Agg Site', domain: 'agg.example' });
    const placement = await db.Placement.create({
      site_id: site.id,
      name: 'Agg Placement',
      width: 300,
      height: 250,
      key: createPlacementKey(),
    });

    const stamp = Date.now();
    await db.Event.bulkCreate([
      {
        placement_id: placement.id,
        creative_id: creative.id,
        campaign_id: camp.id,
        serve_id: `agg-early-${stamp}`,
        type: 'impression',
        occurred_at: early,
        dedupe_key: `agg-early-${stamp}:impression`,
      },
      {
        placement_id: placement.id,
        creative_id: creative.id,
        campaign_id: camp.id,
        serve_id: `agg-late-${stamp}`,
        type: 'impression',
        occurred_at: late,
        dedupe_key: `agg-late-${stamp}:impression`,
      },
    ]);

    const evCount = await db.Event.count({ where: { campaign_id: camp.id } });
    expect(evCount).toBe(2);

    await aggregateEvents({ sinceHours: 48, now });

    const bucket = await db.EventAggregate.findOne({
      where: {
        campaign_id: camp.id,
        creative_id: creative.id,
        placement_id: placement.id,
        type: 'impression',
      },
    });
    expect(bucket).toBeTruthy();
    expect(Number(bucket.count)).toBe(2);
  });
});
