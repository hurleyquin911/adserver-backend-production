const request = require('supertest');
const app = require('../index');
const db = require('../models');

let token;
const suffix = Date.now();

beforeAll(async () => {
  const login = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  token = login.body.accessToken;
});

describe('CRUD publisher', () => {
  let id;

  test('POST membuat publisher', async () => {
    const res = await request(app)
      .post('/api/publishers')
      .set('Authorization', `Bearer ${token}`)
      .send({ host: `Edit.Pub-${suffix}.Example`, status: 'pending' });
    expect(res.status).toBe(201);
    expect(res.body.data.host).toBe(`edit.pub-${suffix}.example`);
    expect(res.body.data.status).toBe('pending');
    id = res.body.data.id;
  });

  test('PATCH mengubah host dan status', async () => {
    const res = await request(app)
      .patch(`/api/publishers/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ host: `edited-pub-${suffix}.example`, status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.data.host).toBe(`edited-pub-${suffix}.example`);
    expect(res.body.data.status).toBe('active');
  });

  test('PATCH status saja tetap didukung', async () => {
    const res = await request(app)
      .patch(`/api/publishers/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'blocked' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('blocked');
  });

  test('host duplikat → 409', async () => {
    const res = await request(app)
      .post('/api/publishers')
      .set('Authorization', `Bearer ${token}`)
      .send({ host: `edited-pub-${suffix}.example`, status: 'active' });
    expect(res.status).toBe(409);
  });

  test('host tidak valid → 400', async () => {
    const res = await request(app)
      .post('/api/publishers')
      .set('Authorization', `Bearer ${token}`)
      .send({ host: '   ', status: 'active' });
    expect(res.status).toBe(400);
  });

  test('DELETE menghapus publisher', async () => {
    const res = await request(app)
      .delete(`/api/publishers/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const gone = await db.Publisher.findByPk(id);
    expect(gone).toBeNull();
    id = null;
  });

  test('DELETE id tidak ada → 404', async () => {
    const res = await request(app)
      .delete('/api/publishers/999999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  afterAll(async () => {
    if (id) await db.Publisher.destroy({ where: { id } });
  });
});
