const request = require('supertest');
const app = require('../index');
const db = require('../models');

let token;
let publisherId;
let campaignId;

beforeAll(async () => {
  const login = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  token = login.body.accessToken;

  const pub = await db.Publisher.create({
    host: `detail-pub-${Date.now()}.example`,
    status: 'active',
    first_seen_at: new Date(),
    last_seen_at: new Date(),
  });
  publisherId = pub.id;

  const adv = await db.Advertiser.create({
    name: `Pub Detail Adv ${Date.now()}`,
    status: 'active',
  });
  const today = new Date().toISOString().slice(0, 10);
  const camp = await db.Campaign.create({
    advertiser_id: adv.id,
    name: 'Pub Detail Camp',
    start_date: today,
    end_date: today,
    status: 'active',
    priority: 1,
  });
  campaignId = camp.id;

  const creative = await db.Creative.create({
    campaign_id: camp.id,
    name: 'Pub Detail Creative',
    width: 300,
    height: 250,
    storage_driver: 'local',
    base_path: `creatives/${Date.now()}`,
    entry_file: 'index.html',
    status: 'active',
  });

  const bucket = new Date();
  bucket.setMinutes(0, 0, 0);
  await db.EventAggregate.bulkCreate([
    {
      bucket_at: bucket,
      campaign_id: camp.id,
      creative_id: creative.id,
      placement_id: 0,
      publisher_id: publisherId,
      device_type: '',
      slot_size: '300x250',
      type: 'impression',
      interaction_name: '',
      count: 12,
    },
    {
      bucket_at: bucket,
      campaign_id: camp.id,
      creative_id: creative.id,
      placement_id: 0,
      publisher_id: publisherId,
      device_type: '',
      slot_size: '300x250',
      type: 'click',
      interaction_name: '',
      count: 3,
    },
    {
      bucket_at: bucket,
      campaign_id: camp.id,
      creative_id: creative.id,
      placement_id: 0,
      publisher_id: publisherId,
      device_type: '',
      slot_size: '300x250',
      type: 'request',
      interaction_name: '',
      count: 15,
    },
  ]);
});

describe('Detail report publisher', () => {
  test('menyertakan metrics, campaign, creative, size, dan daily', async () => {
    const res = await request(app)
      .get(`/api/reports/publishers/${publisherId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.publisher.id).toBe(String(publisherId));
    expect(res.body.data.metrics.impression).toBeGreaterThanOrEqual(12);
    expect(res.body.data.metrics.click).toBeGreaterThanOrEqual(3);
    const camp = res.body.data.campaigns.find((c) => c.campaign_id === String(campaignId));
    expect(camp).toBeTruthy();
    expect(camp.metrics.impression).toBeGreaterThanOrEqual(12);
    expect(camp.advertiser).toBeTruthy();
    expect(res.body.data.creatives.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.sizes.some((s) => s.size === '300x250')).toBe(true);
    expect(Array.isArray(res.body.data.devices)).toBe(true);
    expect(res.body.data.publisher.first_seen_at).toBeTruthy();
    expect(res.body.data.publisher.created_at).toBeTruthy();
    expect(Array.isArray(res.body.data.daily)).toBe(true);
  });

  test('publisher tidak ada → 404', async () => {
    const res = await request(app)
      .get('/api/reports/publishers/99999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
