const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../index');
const db = require('../models');
const { makeZip } = require('./helpers');

let adminToken;
let scopedToken;
let ownAdvertiserId;
let otherAdvertiserId;
let otherCampaignId;
let otherCreativeId;
let placementId;

beforeAll(async () => {
  const own = await db.Advertiser.create({ name: 'Scope Own Adv', status: 'active' });
  const other = await db.Advertiser.create({ name: 'Scope Other Adv', status: 'active' });
  ownAdvertiserId = own.id;
  otherAdvertiserId = other.id;

  const usersRole = await db.Role.findOne({ where: { name: 'Users' } });
  const hash = await bcrypt.hash('TestPass123!', 10);
  const email = `scope-write-${Date.now()}@adserver.local`;
  await db.User.create({
    email,
    name: 'Scoped Writer',
    password_hash: hash,
    role_id: usersRole.id,
    advertiser_id: ownAdvertiserId,
    is_active: true,
  });

  const adminLogin = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  adminToken = adminLogin.body.accessToken;

  const scopedLogin = await request(app)
    .post('/auth/login')
    .send({ email, password: 'TestPass123!' });
  scopedToken = scopedLogin.body.accessToken;

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const otherCamp = await request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      advertiser_id: Number(otherAdvertiserId),
      name: 'Other Camp',
      start_date: start,
      end_date: end,
      status: 'active',
    });
  otherCampaignId = otherCamp.body.data.id;

  const zipBuf = makeZip({ 'index.html': '<html><body>x</body></html>' });
  const otherCreative = await request(app)
    .post('/api/creatives')
    .set('Authorization', `Bearer ${adminToken}`)
    .field('campaign_id', String(otherCampaignId))
    .field('name', 'Other Creative')
    .field('width', '300')
    .field('height', '250')
    .field('click_url', 'https://example.com/other')
    .field('status', 'active')
    .attach('file', zipBuf, 'other.zip');
  otherCreativeId = otherCreative.body.data.id;

  const site = await request(app)
    .post('/api/sites')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Scope Site', domain: 'scope.example' });
  const placement = await request(app)
    .post('/api/placements')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      site_id: Number(site.body.data.id),
      name: 'Scope Placement',
      width: 300,
      height: 250,
    });
  placementId = placement.body.data.id;
});


describe('Scope tulis advertiser', () => {
  test('user ber-advertiser_id tidak bisa membuat campaign milik advertiser lain', async () => {
    const today = new Date();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({
        advertiser_id: Number(otherAdvertiserId),
        name: 'Hijack Camp',
        start_date: today.toISOString().slice(0, 10),
        end_date: today.toISOString().slice(0, 10),
        status: 'draft',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('POST /api/creatives menolak campaign_id advertiser lain', async () => {
    const zipBuf = makeZip({ 'index.html': '<html><body>nope</body></html>' });
    const res = await request(app)
      .post('/api/creatives')
      .set('Authorization', `Bearer ${scopedToken}`)
      .field('campaign_id', String(otherCampaignId))
      .field('name', 'Hijack Creative')
      .field('width', '300')
      .field('height', '250')
      .field('click_url', 'https://example.com/hijack')
      .attach('file', zipBuf, 'hijack.zip');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('user scoped tidak bisa patch advertiser lain', async () => {
    const res = await request(app)
      .patch(`/api/advertisers/${otherAdvertiserId}`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  test('assign creative advertiser lain ditolak', async () => {
    const res = await request(app)
      .put(`/api/placements/${placementId}/creatives`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ creative_ids: [Number(otherCreativeId)] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('user scoped boleh menulis campaign miliknya', async () => {
    const today = new Date();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({
        advertiser_id: Number(ownAdvertiserId),
        name: 'Own Write Camp',
        start_date: today.toISOString().slice(0, 10),
        end_date: today.toISOString().slice(0, 10),
        status: 'draft',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.advertiser_id).toBe(String(ownAdvertiserId));
  });
});
