const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../index');
const db = require('../models');
const P = require('../constant/permissions');

describe('Report scope & aggregate permission', () => {
  test('filter campaign_id advertiser lain menghasilkan 404, bukan data bocor', async () => {
    const own = await db.Advertiser.create({ name: `Rep Own ${Date.now()}`, status: 'active' });
    const other = await db.Advertiser.create({ name: `Rep Other ${Date.now()}`, status: 'active' });
    const today = new Date().toISOString().slice(0, 10);
    const otherCamp = await db.Campaign.create({
      advertiser_id: other.id,
      name: 'Other Camp',
      start_date: today,
      end_date: today,
      status: 'active',
      priority: 1,
    });
    const adminRole = await db.Role.findOne({ where: { name: 'Admin' } });
    const email = `rep-scope-${Date.now()}@adserver.local`;
    await db.User.create({
      email,
      name: 'Rep Scoped',
      password_hash: await bcrypt.hash('TestPass123!', 10),
      role_id: adminRole.id,
      advertiser_id: own.id,
      is_active: true,
    });
    const login = await request(app).post('/auth/login').send({ email, password: 'TestPass123!' });
    const token = login.body.accessToken;

    const res = await request(app)
      .get(`/api/reports/summary?from=${today}&to=${today}&campaign_id=${otherCamp.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.data).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(String(other.id));
  });

  test('POST aggregate butuh report:aggregate', async () => {
    const viewerRole = await db.Role.findOne({ where: { name: 'Users' } });
    const brand = await db.Advertiser.create({ name: `Rep Users Brand ${Date.now()}`, status: 'active' });
    const email = `rep-agg-${Date.now()}@adserver.local`;
    await db.User.create({
      email,
      name: 'Rep Users',
      password_hash: await bcrypt.hash('TestPass123!', 10),
      role_id: viewerRole.id,
      advertiser_id: brand.id,
      is_active: true,
    });
    const login = await request(app).post('/auth/login').send({ email, password: 'TestPass123!' });
    const res = await request(app)
      .post('/api/reports/aggregate')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  test('Superadmin boleh aggregate', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    expect(login.body.user.permissions).toContain(P.REPORT_AGGREGATE);
    const res = await request(app)
      .post('/api/reports/aggregate')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
  });
});
