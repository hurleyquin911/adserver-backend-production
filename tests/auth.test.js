const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../index');
const db = require('../models');
const P = require('../constant/permissions');

let viewerToken;
let adminToken;
let scopedToken;
let advertiserId;

beforeAll(async () => {
  const advertiser = await db.Advertiser.create({ name: 'Auth Test Adv', status: 'active' });
  advertiserId = advertiser.id;

  const viewerRole = await db.Role.findOne({ where: { name: 'Users' } });
  const adminRole = await db.Role.findOne({ where: { name: 'Admin' } });

  const hash = await bcrypt.hash('TestPass123!', 10);
  const suffix = Date.now();
  const viewerEmail = `viewer-test-${suffix}@adserver.local`;
  const scopedEmail = `scoped-test-${suffix}@adserver.local`;

  await db.User.create({
    email: viewerEmail,
    name: 'Users Test',
    password_hash: hash,
    role_id: viewerRole.id,
    advertiser_id: advertiserId,
    is_active: true,
  });
  await db.User.create({
    email: scopedEmail,
    name: 'Scoped Test',
    password_hash: hash,
    role_id: adminRole.id,
    advertiser_id: advertiserId,
    is_active: true,
  });

  const adminLogin = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  adminToken = adminLogin.body.accessToken;

  const viewerLogin = await request(app)
    .post('/auth/login')
    .send({ email: viewerEmail, password: 'TestPass123!' });
  viewerToken = viewerLogin.body.accessToken;

  const scopedLogin = await request(app)
    .post('/auth/login')
    .send({ email: scopedEmail, password: 'TestPass123!' });
  scopedToken = scopedLogin.body.accessToken;
});

describe('Auth & RBAC', () => {
  test('login sukses', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.permissions).toContain(P.USER_MANAGE);
  });

  test('login gagal', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('tanpa token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('tanpa permission', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('dengan permission', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('scope advertiser', async () => {
    const other = await db.Advertiser.create({ name: 'Other Adv', status: 'active' });
    const res = await request(app)
      .get('/api/advertisers')
      .set('Authorization', `Bearer ${scopedToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a.id);
    expect(ids).toContain(String(advertiserId));
    expect(ids).not.toContain(String(other.id));
  });
});
