const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../index');
const db = require('../models');

let adminToken;
let adminUserId;
let saToken;
let saUserId;

beforeAll(async () => {
  const saRole = await db.Role.findOne({ where: { name: 'Superadmin' } });
  const adminRole = await db.Role.findOne({ where: { name: 'Admin' } });
  const hash = await bcrypt.hash('TestPass123!', 10);
  const suffix = Date.now();

  const brand = await db.Advertiser.create({
    name: `Guard Brand ${suffix}`,
    status: 'active',
  });

  const admin = await db.User.create({
    email: `guard-admin-${suffix}@adserver.local`,
    name: 'Guard Admin',
    password_hash: hash,
    role_id: adminRole.id,
    advertiser_id: brand.id,
    is_active: true,
  });
  adminUserId = admin.id;
  const adminLogin = await request(app)
    .post('/auth/login')
    .send({ email: admin.email, password: 'TestPass123!' });
  adminToken = adminLogin.body.accessToken;

  const saLogin = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  saToken = saLogin.body.accessToken;
  const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${saToken}`);
  saUserId = me.body.user.id;
});

describe('Proteksi Superadmin', () => {
  test('tidak dapat menghapus diri sendiri', async () => {
    const res = await request(app)
      .delete(`/api/users/${saUserId}`)
      .set('Authorization', `Bearer ${saToken}`);
    expect(res.status).toBe(400);
  });

  test('Admin tidak melihat Superadmin di daftar users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const emails = (res.body.data || []).map((u) => u.email);
    expect(emails).not.toContain(process.env.SEED_ADMIN_EMAIL);
    expect((res.body.data || []).every((u) => u.role?.name !== 'Superadmin')).toBe(true);
  });

  test('Admin tidak melihat role Superadmin di daftar roles', async () => {
    const res = await request(app)
      .get('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const names = (res.body.data || []).map((r) => r.name);
    expect(names).not.toContain('Superadmin');
    expect(names).toEqual(expect.arrayContaining(['Admin', 'Users']));
  });

  test('Admin tidak dapat membuat user Superadmin', async () => {
    const saRole = await db.Role.findOne({ where: { name: 'Superadmin' } });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `blocked-sa-${Date.now()}@adserver.local`,
        name: 'Blocked SA',
        password: 'TestPass123!',
        role_id: Number(saRole.id),
      });
    expect(res.status).toBe(403);
  });

  test('Admin tidak dapat melihat / mengubah / menghapus akun Superadmin', async () => {
    const getRes = await request(app)
      .get(`/api/users/${saUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/users/${saUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Hacked' });
    expect(patchRes.status).toBe(404);

    const delRes = await request(app)
      .delete(`/api/users/${saUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(404);
  });

  test('tidak dapat menonaktifkan Superadmin terakhir', async () => {
    const saRole = await db.Role.findOne({ where: { name: 'Superadmin' } });
    const seed = await db.User.findOne({ where: { email: process.env.SEED_ADMIN_EMAIL } });
    const extras = await db.User.findAll({
      where: { role_id: saRole.id, is_active: true, id: { [Op.ne]: seed.id } },
    });
    const extraIds = extras.map((u) => u.id);
    if (extraIds.length) {
      await db.User.update({ is_active: false }, { where: { id: extraIds } });
    }
    try {
      const res = await request(app)
        .patch(`/api/users/${seed.id}`)
        .set('Authorization', `Bearer ${saToken}`)
        .send({ is_active: false });
      expect(res.status).toBe(400);
    } finally {
      if (extraIds.length) {
        await db.User.update({ is_active: true }, { where: { id: extraIds } });
      }
    }
  });
});
