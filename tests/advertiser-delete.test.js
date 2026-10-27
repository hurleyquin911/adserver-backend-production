const request = require('supertest');
const app = require('../index');
const db = require('../models');
const { makeZip, cleanupCreativeDir } = require('./helpers');

let token;
let advertiserId;
let campaignId;
let creativeId;
let eventId;

beforeAll(async () => {
  const login = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  token = login.body.accessToken;

  const adv = await request(app)
    .post('/api/advertisers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Delete Adv ${Date.now()}`, status: 'active' });
  expect(adv.status).toBe(201);
  advertiserId = adv.body.data.id;

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const camp = await request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${token}`)
    .send({
      advertiser_id: Number(advertiserId),
      name: 'Delete Camp',
      start_date: start,
      end_date: end,
      status: 'active',
    });
  expect(camp.status).toBe(201);
  campaignId = camp.body.data.id;

  const zipBuf = makeZip({ 'index.html': '<html><body>del</body></html>' });
  const creative = await request(app)
    .post('/api/creatives')
    .set('Authorization', `Bearer ${token}`)
    .field('campaign_id', String(campaignId))
    .field('name', 'Delete Creative')
    .field('width', '300')
    .field('height', '250')
    .field('status', 'active')
    .attach('file', zipBuf, 'del.zip');
  expect(creative.status).toBe(201);
  creativeId = creative.body.data.id;

  const event = await db.Event.create({
    campaign_id: Number(campaignId),
    creative_id: Number(creativeId),
    serve_id: `del-adv-${Date.now()}`,
    type: 'impression',
    occurred_at: new Date(),
  });
  eventId = event.id;
});

afterAll(() => {
  cleanupCreativeDir(creativeId);
});

describe('Hapus advertiser', () => {
  test('list dan detail menyertakan campaign_count', async () => {
    const list = await request(app)
      .get('/api/advertisers')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const row = list.body.data.find((item) => item.id === String(advertiserId));
    expect(row).toBeTruthy();
    expect(row.campaign_count).toBeGreaterThanOrEqual(1);

    const one = await request(app)
      .get(`/api/advertisers/${advertiserId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(one.status).toBe(200);
    expect(one.body.data.campaign_count).toBeGreaterThanOrEqual(1);
  });

  test('user scoped tidak boleh menghapus advertiser', async () => {
    const scopedAdv = await db.Advertiser.create({
      name: `Scoped Del ${Date.now()}`,
      status: 'active',
    });
    const adminRole = await db.Role.findOne({ where: { name: 'Admin' } });
    const bcrypt = require('bcryptjs');
    const email = `scoped-del-${Date.now()}@adserver.local`;
    await db.User.create({
      email,
      name: 'Scoped Del',
      password_hash: await bcrypt.hash('TestPass123!', 10),
      role_id: adminRole.id,
      advertiser_id: scopedAdv.id,
      is_active: true,
    });
    const login = await request(app)
      .post('/auth/login')
      .send({ email, password: 'TestPass123!' });
    const res = await request(app)
      .delete(`/api/advertisers/${scopedAdv.id}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('hapus advertiser yang punya campaign+creative berhasil', async () => {
    const res = await request(app)
      .delete(`/api/advertisers/${advertiserId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const goneAdv = await request(app)
      .get(`/api/advertisers/${advertiserId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(goneAdv.status).toBe(404);

    const goneCamp = await request(app)
      .get(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(goneCamp.status).toBe(404);

    const goneCreative = await request(app)
      .get(`/api/creatives/${creativeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(goneCreative.status).toBe(404);

    const leftover = await db.Event.findByPk(eventId);
    expect(leftover).not.toBeNull();
    expect(leftover.campaign_id).toBeNull();
    expect(leftover.creative_id).toBeNull();
  });

  test('hapus advertiser tanpa campaign berhasil', async () => {
    const adv = await request(app)
      .post('/api/advertisers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Empty Del ${Date.now()}`, status: 'active' });
    const res = await request(app)
      .delete(`/api/advertisers/${adv.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
