const request = require('supertest');
const app = require('../index');
const db = require('../models');

function cookieValue(res, name) {
  const raw = res.headers['set-cookie'] || [];
  const hit = raw.find((c) => c.startsWith(`${name}=`));
  if (!hit) return null;
  return hit.split(';')[0].slice(name.length + 1);
}

describe('Refresh token rotasi & pencabutan', () => {
  test('token yang dicabut (logout) tidak bisa dipakai', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    const old = cookieValue(login, 'refresh_token');
    expect(old).toBeTruthy();

    const logout = await request(app).post('/auth/logout').set('Cookie', `refresh_token=${old}`);
    expect(logout.status).toBe(200);

    const again = await request(app).post('/auth/refresh').set('Cookie', `refresh_token=${old}`);
    expect(again.status).toBe(401);
  });

  test('rotasi: token lama tidak valid setelah refresh', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    const old = cookieValue(login, 'refresh_token');

    const rotated = await request(app).post('/auth/refresh').set('Cookie', `refresh_token=${old}`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.accessToken).toBeTruthy();
    expect(rotated.body.user.is_active === undefined || rotated.body.user).toBeTruthy();

    const reuse = await request(app).post('/auth/refresh').set('Cookie', `refresh_token=${old}`);
    expect(reuse.status).toBe(401);
  });

  test('user nonaktif ditolak saat refresh', async () => {
    const role = await db.Role.findOne({ where: { name: 'Users' } });
    const bcrypt = require('bcryptjs');
    const email = `inactive-refresh-${Date.now()}@adserver.local`;
    const user = await db.User.create({
      email,
      name: 'Inactive Refresh',
      password_hash: await bcrypt.hash('TestPass123!', 10),
      role_id: role.id,
      is_active: true,
    });
    const login = await request(app).post('/auth/login').send({ email, password: 'TestPass123!' });
    const tok = cookieValue(login, 'refresh_token');
    user.is_active = false;
    await user.save();
    const res = await request(app).post('/auth/refresh').set('Cookie', `refresh_token=${tok}`);
    expect(res.status).toBe(401);
  });
});
