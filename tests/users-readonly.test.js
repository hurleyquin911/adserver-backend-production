const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../index');
const db = require('../models');
const P = require('../constant/permissions');
const { USERS_ROLE_DESCRIPTION } = require('../constant/roles');
const migration = require('../migrations/20261106000001-users-view-only');
const denyUsers = require('../middleware/denyUsers');
const denyUsersWrite = require('../middleware/denyUsersWrite');
const { makeZip, cleanupCreativeDir } = require('./helpers');

const WRITE_CODES = [
  P.CAMPAIGN_WRITE,
  P.CREATIVE_UPLOAD,
  P.PLACEMENT_MANAGE,
  P.PUBLISHER_MANAGE,
  P.REPORT_AGGREGATE,
  P.USER_MANAGE,
];

function expectCalledWithForbidden(next) {
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'FORBIDDEN', status: 403 })
  );
}

async function permissionCodes(roleName) {
  const role = await db.Role.findOne({
    where: { name: roleName },
    include: [{ model: db.Permission, as: 'permissions', through: { attributes: [] } }],
  });
  if (!role) throw new Error(`Role ${roleName} tidak ditemukan`);
  return role.permissions.map((permission) => permission.code).sort();
}

async function setUsersWritePermissions(present) {
  const role = await db.Role.findOne({ where: { name: 'Users' } });
  const permissions = await db.Permission.findAll({ where: { code: WRITE_CODES } });
  for (const permission of permissions) {
    const where = { role_id: role.id, permission_id: permission.id };
    if (present) {
      await db.RolePermission.findOrCreate({ where, defaults: where });
    } else {
      await db.RolePermission.destroy({ where });
    }
  }
}

describe('Middleware role Users', () => {
  test('menolak mutasi Users, Viewer, dan Campaign Manager', () => {
    for (const name of ['Users', 'Viewer', 'Campaign Manager']) {
      const next = jest.fn();
      denyUsersWrite({ method: 'POST', user: { role: { name } } }, {}, next);
      expectCalledWithForbidden(next);

      const read = jest.fn();
      denyUsersWrite({ method: 'GET', user: { role: { name } } }, {}, read);
      expect(read).toHaveBeenCalledWith();
    }
  });

  test('Admin dan Superadmin tetap boleh menulis', () => {
    for (const name of ['Admin', 'Superadmin', 'Super Admin']) {
      const next = jest.fn();
      denyUsersWrite({ method: 'PATCH', user: { role: { name } } }, {}, next);
      expect(next).toHaveBeenCalledWith();
    }
  });

  test('Users ditolak di seluruh endpoint Advertiser, Admin tetap lewat', () => {
    const users = jest.fn();
    denyUsers({ method: 'GET', user: { role: { name: 'Users' } } }, {}, users);
    expectCalledWithForbidden(users);

    const admin = jest.fn();
    denyUsers({ method: 'GET', user: { role: { name: 'Admin' } } }, {}, admin);
    expect(admin).toHaveBeenCalledWith();
  });

  test('izin resmi Users hanya baca', () => {
    expect(P.USERS_READ_PERMISSIONS).toEqual([P.CAMPAIGN_READ, P.REPORT_READ]);
    expect(P.USERS_READ_PERMISSIONS).not.toContain(P.CREATIVE_UPLOAD);
    expect(P.USERS_READ_PERMISSIONS).not.toContain(P.CAMPAIGN_WRITE);
  });
});

describe('Users view-only', () => {
  const password = 'TestPass123!';
  let usersEmail;
  let usersToken;
  let adminToken;
  let saToken;
  let advertiserId;
  let campaignId;
  let creativeId;
  let usersRoleId;

  beforeAll(async () => {
    const suffix = Date.now();
    const brand = await db.Advertiser.create({
      name: `Readonly Brand ${suffix}`,
      status: 'active',
    });
    advertiserId = brand.id;

    const usersRole = await db.Role.findOne({ where: { name: 'Users' } });
    const adminRole = await db.Role.findOne({ where: { name: 'Admin' } });
    usersRoleId = usersRole.id;
    const hash = await bcrypt.hash(password, 10);
    usersEmail = `readonly-users-${suffix}@adserver.local`;
    const adminEmail = `readonly-admin-${suffix}@adserver.local`;

    await db.User.create({
      email: usersEmail,
      name: 'Readonly Users',
      password_hash: hash,
      role_id: usersRole.id,
      advertiser_id: brand.id,
      is_active: true,
    });
    await db.User.create({
      email: adminEmail,
      name: 'Readonly Admin',
      password_hash: hash,
      role_id: adminRole.id,
      advertiser_id: null,
      is_active: true,
    });

    const adminLogin = await request(app)
      .post('/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const saLogin = await request(app)
      .post('/auth/login')
      .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    saToken = saLogin.body.accessToken;

    const today = new Date().toISOString().slice(0, 10);
    const campaign = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        advertiser_id: Number(advertiserId),
        name: 'Readonly Campaign',
        start_date: today,
        end_date: today,
        status: 'draft',
      });
    expect(campaign.status).toBe(201);
    campaignId = campaign.body.data.id;

    const creative = await request(app)
      .post('/api/creatives')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('campaign_id', String(campaignId))
      .field('name', 'Readonly Creative')
      .field('width', '300')
      .field('height', '250')
      .field('click_url', 'https://example.com/readonly')
      .field('status', 'active')
      .attach('file', makeZip({ 'index.html': '<html><body>ok</body></html>' }), 'readonly.zip');
    expect(creative.status).toBe(201);
    creativeId = creative.body.data.id;
  });

  afterAll(async () => {
    await setUsersWritePermissions(false);
    cleanupCreativeDir(creativeId);
  });

  test('migrasi mencabut izin tulis Users dan tidak mengubah Admin atau Superadmin', async () => {
    const adminBefore = await permissionCodes('Admin');
    const superBefore = await permissionCodes('Superadmin');
    await setUsersWritePermissions(true);
    const queryInterface = db.sequelize.getQueryInterface();
    await migration.up(queryInterface);
    await migration.up(queryInterface);

    expect(await permissionCodes('Users')).toEqual([...P.USERS_READ_PERMISSIONS].sort());
    expect(await permissionCodes('Admin')).toEqual(adminBefore);
    expect(await permissionCodes('Superadmin')).toEqual(superBefore);

    const role = await db.Role.findByPk(usersRoleId);
    expect(role.description).toBe(USERS_ROLE_DESCRIPTION);
  });

  describe('sisa permission tulis tidak bisa dipakai', () => {
    beforeAll(async () => {
      await setUsersWritePermissions(true);
      const login = await request(app).post('/auth/login').send({ email: usersEmail, password });
      expect(login.status).toBe(200);
      usersToken = login.body.accessToken;
      expect(login.body.user.permissions).toEqual(
        expect.arrayContaining([...P.USERS_READ_PERMISSIONS, ...WRITE_CODES])
      );
    });

    async function expectForbidden(method, url, body) {
      let req = request(app)[method](url).set('Authorization', `Bearer ${usersToken}`);
      if (body !== undefined) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }

    test('Users tidak dapat membuat, mengubah, atau menghapus campaign dan creative', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await expectForbidden('post', '/api/campaigns', {
        advertiser_id: Number(advertiserId),
        name: 'Users Write',
        start_date: today,
        end_date: today,
        status: 'draft',
      });
      await expectForbidden('patch', `/api/campaigns/${campaignId}`, { name: 'Diubah Users' });
      await expectForbidden('delete', `/api/campaigns/${campaignId}`);

      const upload = await request(app)
        .post('/api/creatives')
        .set('Authorization', `Bearer ${usersToken}`)
        .field('campaign_id', String(campaignId))
        .field('name', 'Users Creative')
        .field('width', '300')
        .field('height', '250')
        .attach('file', makeZip({ 'index.html': '<html><body>no</body></html>' }), 'no.zip');
      expect(upload.status).toBe(403);
      expect(upload.body.error.code).toBe('FORBIDDEN');
      await expectForbidden('patch', `/api/creatives/${creativeId}`, { name: 'Diubah Users' });
      await expectForbidden('delete', `/api/creatives/${creativeId}`);
    });

    test('Users tidak dapat mengubah data lain', async () => {
      await expectForbidden('post', '/api/sites', { name: 'Users Site', domain: 'users.example' });
      await expectForbidden('post', '/api/placements', {
        site_id: 1,
        name: 'Users Placement',
        width: 300,
        height: 250,
      });
      await expectForbidden('put', '/api/placements/1/creatives', { creative_ids: [Number(creativeId)] });
      await expectForbidden('post', '/api/publishers', { host: 'users.example' });
      await expectForbidden('post', '/api/reports/aggregate');
      await expectForbidden('patch', `/api/billing/pricing/${creativeId}`, {
        cpm_usd: 1.5,
        reason: 'Tidak boleh',
      });
      await expectForbidden('post', '/api/users', {
        email: `blocked-${Date.now()}@adserver.local`,
        name: 'Blocked',
        password: 'TestPass123!',
        role_id: Number(usersRoleId),
      });
      await expectForbidden('patch', `/api/roles/${usersRoleId}`, { description: 'Diubah Users' });
    });

    test('Users tidak dapat mengakses Advertiser, termasuk Brand sendiri', async () => {
      await expectForbidden('get', '/api/advertisers');
      await expectForbidden('get', `/api/advertisers/${advertiserId}`);
      await expectForbidden('post', '/api/advertisers', { name: 'Users Brand', status: 'active' });
      await expectForbidden('patch', `/api/advertisers/${advertiserId}`, { name: 'Diubah Users' });
      await expectForbidden('delete', `/api/advertisers/${advertiserId}`);
    });

    test('Users tetap dapat membaca campaign, creative, report, dan billing', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const campaigns = await request(app)
        .get('/api/campaigns')
        .set('Authorization', `Bearer ${usersToken}`);
      expect(campaigns.status).toBe(200);
      expect(campaigns.body.data.map((row) => row.id)).toContain(String(campaignId));

      const oneCampaign = await request(app)
        .get(`/api/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${usersToken}`);
      expect(oneCampaign.status).toBe(200);

      const creatives = await request(app)
        .get('/api/creatives')
        .set('Authorization', `Bearer ${usersToken}`);
      expect(creatives.status).toBe(200);
      expect(creatives.body.data.map((row) => row.id)).toContain(String(creativeId));

      const oneCreative = await request(app)
        .get(`/api/creatives/${creativeId}`)
        .set('Authorization', `Bearer ${usersToken}`);
      expect(oneCreative.status).toBe(200);

      const summary = await request(app)
        .get(`/api/reports/summary?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${usersToken}`);
      expect(summary.status).toBe(200);

      const billing = await request(app)
        .get(`/api/billing?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${usersToken}`);
      expect(billing.status).toBe(200);

      const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${usersToken}`);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(usersEmail);
    });

    test('Users tetap dapat mengubah profil dan password sendiri', async () => {
      const profile = await request(app)
        .patch('/auth/me')
        .set('Authorization', `Bearer ${usersToken}`)
        .send({
          name: 'Readonly Users Baru',
          email: usersEmail,
          phone: '081234567890',
        });
      expect(profile.status).toBe(200);
      expect(profile.body.user.name).toBe('Readonly Users Baru');
      expect(profile.body.user.phone).toBe('081234567890');

      const nextPassword = 'TestPass456!';
      const changed = await request(app)
        .post('/auth/password')
        .set('Authorization', `Bearer ${usersToken}`)
        .send({ current_password: password, new_password: nextPassword });
      expect(changed.status).toBe(200);

      const oldLogin = await request(app)
        .post('/auth/login')
        .send({ email: usersEmail, password });
      expect(oldLogin.status).toBe(401);

      const newLogin = await request(app)
        .post('/auth/login')
        .send({ email: usersEmail, password: nextPassword });
      expect(newLogin.status).toBe(200);
      usersToken = newLogin.body.accessToken;
    });

    test('Admin dan Superadmin tetap dapat menulis dan mengelola', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const created = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          advertiser_id: Number(advertiserId),
          name: 'Admin Masih Bisa',
          start_date: today,
          end_date: today,
          status: 'draft',
        });
      expect(created.status).toBe(201);

      const brands = await request(app)
        .get('/api/advertisers')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(brands.status).toBe(200);

      const creative = await request(app)
        .patch(`/api/creatives/${creativeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Admin Creative' });
      expect(creative.status).toBe(200);

      const users = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${saToken}`);
      expect(users.status).toBe(200);

      const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${saToken}`);
      expect(me.status).toBe(200);
      expect(me.body.user.permissions).toEqual(
        expect.arrayContaining([
          P.USER_MANAGE,
          P.CAMPAIGN_WRITE,
          P.CREATIVE_UPLOAD,
          P.PLACEMENT_MANAGE,
          P.REPORT_READ,
        ])
      );
    });
  });
});
