const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../index');
const db = require('../models');
const { makeZip } = require('./helpers');

let adminToken;
let crossBrandAdminToken;
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
  const adminRole = await db.Role.findOne({ where: { name: 'Admin' } });
  const hash = await bcrypt.hash('TestPass123!', 10);
  const email = `scope-write-${Date.now()}@adserver.local`;
  const adminEmail = `scope-admin-${Date.now()}@adserver.local`;
  await db.User.create({
    email: adminEmail,
    name: 'Cross Brand Admin',
    password_hash: hash,
    role_id: adminRole.id,
    advertiser_id: ownAdvertiserId,
    is_active: true,
  });
  await db.User.create({
    email,
    name: 'Scoped Writer',
    password_hash: hash,
    role_id: usersRole.id,
    advertiser_id: ownAdvertiserId,
    is_active: true,
  });

  const crossBrandAdminLogin = await request(app)
    .post('/auth/login')
    .send({ email: adminEmail, password: 'TestPass123!' });
  crossBrandAdminToken = crossBrandAdminLogin.body.accessToken;
  adminToken = crossBrandAdminToken;

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
  test('Admin dapat melihat Brand lintas akun dan membuat Brand', async () => {
    const list = await request(app)
      .get('/api/advertisers')
      .set('Authorization', `Bearer ${crossBrandAdminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((brand) => String(brand.id))).toEqual(
      expect.arrayContaining([String(ownAdvertiserId), String(otherAdvertiserId)])
    );

    const created = await request(app)
      .post('/api/advertisers')
      .set('Authorization', `Bearer ${crossBrandAdminToken}`)
      .send({ name: 'Admin Created Brand', status: 'active' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Admin Created Brand');

    const edit = await request(app)
      .patch(`/api/advertisers/${otherAdvertiserId}`)
      .set('Authorization', `Bearer ${crossBrandAdminToken}`)
      .send({ name: 'Admin Cannot Edit Brand' });
    expect(edit.status).toBe(403);
  });

  test('Admin dapat membuat campaign di Brand lain', async () => {
    const today = new Date();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${crossBrandAdminToken}`)
      .send({
        advertiser_id: Number(otherAdvertiserId),
        name: 'Cross Brand Admin Campaign',
        start_date: today.toISOString().slice(0, 10),
        end_date: today.toISOString().slice(0, 10),
        status: 'draft',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.advertiser_id).toBe(String(otherAdvertiserId));
  });

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

  test('user scoped tanpa permission campaign:write tidak dapat membuat campaign', async () => {
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
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('user hanya melihat Brand akunnya sendiri', async () => {
    const res = await request(app)
      .get('/api/advertisers')
      .set('Authorization', `Bearer ${scopedToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((brand) => String(brand.id));
    expect(ids).toContain(String(ownAdvertiserId));
    expect(ids).not.toContain(String(otherAdvertiserId));
  });
});
