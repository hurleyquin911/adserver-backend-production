const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../index');
const db = require('../models');
const eventBuffer = require('../utils/eventBuffer');
const { verifyTrackingToken, signPublisherCtx } = require('../utils/tokens');
const { normalizePublisherHost, UNKNOWN_HOST, resetPublisherCache } = require('../utils/publisherIdentity');
const { resetEligibleCache, pickUniversal } = require('../utils/universalSelect');
const { resetDeliveryCounters, incrementDelivered } = require('../utils/deliveryCounter');
const { aggregateEvents } = require('../utils/aggregateEvents');
const { makeZip } = require('./helpers');
const env = require('../config/env');
const P = require('../constant/permissions');

let adminToken;

async function loginAdmin() {
  const role = await db.Role.findOne({ where: { name: 'Admin' } });
  if (!role) throw new Error('Role Admin is required for universal-tag tests');
  const email = `universal-admin-${Date.now()}@adserver.local`;
  const password = 'TestPass123!';
  await db.User.create({
    email,
    name: 'Universal Tag Admin',
    password_hash: await bcrypt.hash(password, 10),
    role_id: role.id,
    advertiser_id: null,
    is_active: true,
  });
  const login = await request(app)
    .post('/auth/login')
    .send({ email, password });
  if (!login.body.accessToken) throw new Error('Unable to authenticate universal-tag test Admin');
  return login.body.accessToken;
}

async function setupCreative({ width = 300, height = 250, goal = null, priority = 1, status = 'active' } = {}) {
  const adv = await request(app)
    .post('/api/advertisers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Uni Adv ${Date.now()}`, status: 'active' });
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const camp = await request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      advertiser_id: Number(adv.body.data.id),
      name: `Uni Camp ${Date.now()}`,
      start_date: today,
      end_date: end,
      status,
      priority,
      impression_goal: goal,
    });
  const zipBuf = makeZip({ 'index.html': '<html><body>uni</body></html>' });
  const creative = await request(app)
    .post('/api/creatives')
    .set('Authorization', `Bearer ${adminToken}`)
    .field('campaign_id', camp.body.data.id)
    .field('name', `Uni ${width}x${height}`)
    .field('width', String(width))
    .field('height', String(height))
    .field('click_url', 'https://example.com/uni')
    .field('status', 'active')
    .attach('file', zipBuf, 'uni.zip');
  resetEligibleCache();
  return {
    advertiserId: adv.body.data.id,
    tagKey: adv.body.data.tag_key,
    campaignId: Number(camp.body.data.id),
    creativeId: Number(creative.body.data.id),
  };
}

function servePath(tagKey, size, extra = '') {
  return `/ad/serve?a=${encodeURIComponent(tagKey)}&size=${encodeURIComponent(size)}${extra}`;
}

beforeAll(async () => {
  adminToken = await loginAdmin();
});

beforeEach(() => {
  resetPublisherCache();
  resetEligibleCache();
  resetDeliveryCounters();
});

afterAll(async () => {
  await eventBuffer.flush();
});

describe('Publisher identity', () => {
  test('www. dinormalisasi; loopback tetap host:port', () => {
    expect(normalizePublisherHost('www.News.Example.com:443')).toBe('news.example.com');
    expect(normalizePublisherHost('127.0.0.1:5500')).toBe('127.0.0.1:5500');
    expect(normalizePublisherHost('localhost:3000')).toBe('localhost:3000');
  });

  test('Origin mendaftarkan publisher otomatis per brand', async () => {
    const setup = await setupCreative();
    const host = `auto-${Date.now()}.example`;
    const res = await request(app)
      .get(servePath(setup.tagKey, '300x250', '&pu=/home'))
      .set('Origin', `https://${host}`);
    expect(res.status).toBe(200);
    const pub = await db.Publisher.findOne({ where: { host } });
    expect(pub).toBeTruthy();
    const link = await db.AdvertiserPublisher.findOne({
      where: { advertiser_id: setup.advertiserId, publisher_id: pub.id },
    });
    expect(link).toBeTruthy();
    expect(link.status).toBe(env.PUBLISHER_DEFAULT_STATUS);
  });

  test('www.example.com dan example.com menjadi satu host', async () => {
    const setup = await setupCreative();
    const base = `norm-${Date.now()}.example`;
    await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://www.${base}`);
    await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://${base}`);
    const pubs = await db.Publisher.findAll({ where: { host: base } });
    expect(pubs).toHaveLength(1);
  });

  test('Origin null memakai host tidak diketahui jika ALLOW_UNKNOWN_PUBLISHER', async () => {
    const setup = await setupCreative();
    const prev = env.ALLOW_UNKNOWN_PUBLISHER;
    env.ALLOW_UNKNOWN_PUBLISHER = true;
    const res = await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', 'null');
    env.ALLOW_UNKNOWN_PUBLISHER = prev;
    expect([200, 204]).toContain(res.status);
    const pub = await db.Publisher.findOne({ where: { host: UNKNOWN_HOST } });
    expect(pub).toBeTruthy();
  });

  test('unknown ditolak jika ALLOW_UNKNOWN_PUBLISHER=false', async () => {
    const setup = await setupCreative();
    const prev = env.ALLOW_UNKNOWN_PUBLISHER;
    env.ALLOW_UNKNOWN_PUBLISHER = false;
    const res = await request(app).get(servePath(setup.tagKey, '300x250'));
    env.ALLOW_UNKNOWN_PUBLISHER = prev;
    expect(res.status).toBe(204);
  });

  test('serve tanpa tag brand -> 400', async () => {
    const res = await request(app)
      .get('/ad/serve?size=300x250')
      .set('Origin', 'https://notag.example');
    expect(res.status).toBe(400);
  });

  test('blocked per brand menghasilkan 204 tanpa event', async () => {
    const setup = await setupCreative();
    await eventBuffer.flush();
    const host = `block-${Date.now()}.example`;
    const pub = await db.Publisher.create({
      host,
      status: 'active',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    });
    await db.AdvertiserPublisher.create({
      advertiser_id: setup.advertiserId,
      publisher_id: pub.id,
      status: 'blocked',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    });
    const res = await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://${host}`);
    expect(res.status).toBe(204);
    await eventBuffer.flush();
    expect(
      await db.Event.count({
        where: { publisher_id: pub.id, advertiser_id: setup.advertiserId },
      })
    ).toBe(0);
  });

  test('pending per brand: 204 tanpa fill, tapi request ukuran tercatat', async () => {
    const setup = await setupCreative();
    await eventBuffer.flush();
    const pendingHost = `pend-${Date.now()}.example`;
    const pending = await db.Publisher.create({
      host: pendingHost,
      status: 'active',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    });
    await db.AdvertiserPublisher.create({
      advertiser_id: setup.advertiserId,
      publisher_id: pending.id,
      status: 'pending',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    });
    const res = await request(app)
      .get(servePath(setup.tagKey, '300x250', '&pu=/home'))
      .set('Origin', `https://${pendingHost}`);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    await eventBuffer.flush();
    const events = await db.Event.findAll({
      where: { publisher_id: pending.id, advertiser_id: setup.advertiserId },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.type === 'request')).toBe(true);
    expect(events.some((e) => e.slot_size === '300x250')).toBe(true);
    expect(events.every((e) => e.creative_id == null)).toBe(true);
  });

  test('setelah disetujui per brand, pending bisa menerima creative', async () => {
    const setup = await setupCreative();
    const host = `approve-${Date.now()}.example`;
    const pub = await db.Publisher.create({
      host,
      status: 'active',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    });
    const link = await db.AdvertiserPublisher.create({
      advertiser_id: setup.advertiserId,
      publisher_id: pub.id,
      status: 'pending',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    });
    const denied = await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://${host}`);
    expect(denied.status).toBe(204);

    await link.update({ status: 'active' });
    resetPublisherCache();
    const ok = await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://${host}`);
    expect(ok.status).toBe(200);
    expect(ok.body.creative).toBeTruthy();
  });

  test('host aktif di brand A tidak otomatis aktif di brand B', async () => {
    const a = await setupCreative();
    const b = await setupCreative();
    const host = `iso-${Date.now()}.example`;
    const okA = await request(app)
      .get(servePath(a.tagKey, '300x250'))
      .set('Origin', `https://${host}`);
    expect(okA.status).toBe(200);

    await db.AdvertiserPublisher.update(
      { status: 'pending' },
      { where: { advertiser_id: b.advertiserId } }
    );
    // Pastikan link B pending (mungkin baru dibuat di atas belum ada)
    const pub = await db.Publisher.findOne({ where: { host } });
    const [linkB] = await db.AdvertiserPublisher.findOrCreate({
      where: { advertiser_id: b.advertiserId, publisher_id: pub.id },
      defaults: {
        advertiser_id: b.advertiserId,
        publisher_id: pub.id,
        status: 'pending',
        first_seen_at: new Date(),
        last_seen_at: new Date(),
      },
    });
    if (linkB.status !== 'pending') await linkB.update({ status: 'pending' });

    const deniedB = await request(app)
      .get(servePath(b.tagKey, '300x250'))
      .set('Origin', `https://${host}`);
    expect(deniedB.status).toBe(204);
  });
});

describe('Ukuran & no-fill', () => {
  test('ukuran persis cocok; 728x90 tidak mengambil 300x250', async () => {
    const setup = await setupCreative({ width: 300, height: 250 });
    const miss = await request(app)
      .get(servePath(setup.tagKey, '728x90'))
      .set('Origin', `https://size-${Date.now()}.example`);
    expect(miss.status).toBe(204);
    const hit = await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://sizehit-${Date.now()}.example`);
    expect(hit.status).toBe(200);
    expect(hit.body.creative.width).toBe(300);
    expect(hit.body.creative.height).toBe(250);
  });

  test('beberapa ukuran: memakai yang ada', async () => {
    const setup = await setupCreative({ width: 300, height: 600 });
    const res = await request(app)
      .get(servePath(setup.tagKey, '728x90,300x600'))
      .set('Origin', `https://multi-${Date.now()}.example`);
    expect(res.status).toBe(200);
    expect(res.body.creative.height).toBe(600);
  });

  test('format size tidak valid -> 400', async () => {
    const setup = await setupCreative();
    const res = await request(app)
      .get(servePath(setup.tagKey, 'abc'))
      .set('Origin', 'https://bad.example');
    expect(res.status).toBe(400);
    const tooMany = await request(app).get(
      servePath(setup.tagKey, '1x1,2x2,3x3,4x4,5x5,6x6')
    );
    expect(tooMany.status).toBe(400);
  });

  test('no fill tercatat sebagai request + no_fill', async () => {
    const setup = await setupCreative();
    const stamp = Date.now();
    const res = await request(app)
      .get(servePath(setup.tagKey, '120x60', '&pu=/nofill'))
      .set('Origin', `https://nf-${stamp}.example`);
    expect(res.status).toBe(204);
    await eventBuffer.flush();
    const rows = await db.Event.findAll({
      where: { slot_size: '120x60', advertiser_id: setup.advertiserId },
      order: [['id', 'DESC']],
      limit: 4,
    });
    const types = rows.map((r) => r.type);
    expect(types).toContain('request');
    expect(types).toContain('no_fill');
    const nf = rows.find((r) => r.type === 'no_fill');
    expect(nf.campaign_id).toBeNull();
    expect(nf.creative_id).toBeNull();
  });

  test('hanya creative brand pemilik tag yang dilayani', async () => {
    const a = await setupCreative({ width: 300, height: 250 });
    const b = await setupCreative({ width: 300, height: 250 });
    const res = await request(app)
      .get(servePath(a.tagKey, '300x250'))
      .set('Origin', `https://scope-${Date.now()}.example`);
    expect(res.status).toBe(200);
    const payload = verifyTrackingToken(res.body.token);
    expect(Number(payload.campId)).toBe(a.campaignId);
    expect(Number(payload.advId)).toBe(Number(a.advertiserId));
    expect(Number(payload.campId)).not.toBe(b.campaignId);
  });
});

describe('Pemilihan goal', () => {
  test('campaign yang goal tercapai dikecualikan', async () => {
    const setup = await setupCreative({ goal: 1, priority: 5 });
    incrementDelivered(setup.campaignId, 1);
    const picked = await pickUniversal({
      sizes: [{ key: '300x250', width: 300, height: 250 }],
      advertiserId: setup.advertiserId,
      rng: () => 0,
    });
    expect(picked).toBeNull();
    const res = await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://goal-${Date.now()}.example`);
    expect(res.status).toBe(204);
  });
});

describe('Tag.js per brand & token', () => {
  test('creative-specific tag keeps the selected creative through serving', async () => {
    const setup = await setupCreative();
    const zipBuf = makeZip({ 'index.html': '<html><body>second</body></html>' });
    const second = await request(app)
      .post('/api/creatives')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('campaign_id', String(setup.campaignId))
      .field('name', 'Second eligible creative')
      .field('width', '300')
      .field('height', '250')
      .field('click_url', 'https://example.com/second')
      .field('status', 'active')
      .attach('file', zipBuf, 'second.zip');
    expect(second.status).toBe(201);
    const secondCreativeId = Number(second.body.data.id);
    expect(secondCreativeId).not.toBe(setup.creativeId);
    resetEligibleCache();

    const tag = await request(app)
      .get(`/api/tag?creative_id=${setup.creativeId}&macros=dv360`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tag.status).toBe(200);
    expect(tag.body.data.creative.id).toBe(String(setup.creativeId));
    expect(tag.body.data.sizes[0].script).toContain(`&cid=${setup.creativeId}`);
    expect(tag.body.data.sizes[0].iframe).toContain(`&cid=${setup.creativeId}`);

    const served = await request(app)
      .get(servePath(setup.tagKey, '300x250', `&cid=${setup.creativeId}`))
      .set('Origin', `https://creative-specific-${Date.now()}.example`);
    expect(served.status).toBe(200);
    const payload = verifyTrackingToken(served.body.token);
    expect(Number(payload.cid)).toBe(setup.creativeId);
    expect(Number(payload.cid)).not.toBe(secondCreativeId);
  });

  test('GET /ad/tag.js tanpa a -> 400', async () => {
    const res = await request(app).get('/ad/tag.js');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Tag brand|console\.error/);
  });

  test('GET /ad/tag.js?a= menanam key brand di serve URL', async () => {
    const setup = await setupCreative();
    const res = await request(app).get(`/ad/tag.js?a=${setup.tagKey}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('readParentSize');
    expect(res.text).toContain(setup.tagKey);
    expect(res.text).toContain('/ad/serve?a=');
    expect(res.text).not.toContain('?p=');
  });

  test('token membawa pubId, size, dan advId', async () => {
    const setup = await setupCreative();
    const res = await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://tok-${Date.now()}.example`);
    expect(res.status).toBe(200);
    const payload = verifyTrackingToken(res.body.token);
    expect(payload.pubId).toBeTruthy();
    expect(payload.size).toBe('300x250');
    expect(payload.sid).toBe(res.body.serveId);
    expect(payload.cid).toBeTruthy();
    expect(payload.campId).toBeTruthy();
    expect(Number(payload.advId)).toBe(Number(setup.advertiserId));
  });
});

describe('ctx frame', () => {
  test('ctx valid dipakai; kedaluwarsa dan dirusak ditolak', async () => {
    const setup = await setupCreative();
    const host = `ctx-${Date.now()}.example`;
    await request(app)
      .get(servePath(setup.tagKey, '300x250'))
      .set('Origin', `https://${host}`);
    const pub = await db.Publisher.findOne({ where: { host } });
    const ctx = signPublisherCtx({
      pubId: pub.id,
      host,
      advId: setup.advertiserId,
      tagKey: setup.tagKey,
    });
    const ok = await request(app).get(
      `/ad/serve?a=${setup.tagKey}&ctx=${encodeURIComponent(ctx)}&size=300x250`
    );
    expect(ok.status).toBe(200);

    const expired = require('../utils/tokens').signTrackingToken({
      k: 'ctx',
      pubId: Number(pub.id),
      host,
      tagKey: setup.tagKey,
      exp: Date.now() - 1000,
    });
    const expRes = await request(app).get(
      `/ad/serve?a=${setup.tagKey}&ctx=${encodeURIComponent(expired)}&size=300x250`
    );
    expect(expRes.status).toBe(401);

    const bad = ctx.slice(0, -2) + 'xx';
    const badRes = await request(app).get(
      `/ad/serve?a=${setup.tagKey}&ctx=${encodeURIComponent(bad)}&size=300x250`
    );
    expect(badRes.status).toBe(401);
  });
});

describe('Agregasi v2 & report', () => {
  test('agregasi dimensi baru + interaction_unique', async () => {
    const setup = await setupCreative({ width: 320, height: 50 });
    const host = `agg-${Date.now()}.example`;
    const serve = await request(app)
      .get(servePath(setup.tagKey, '320x50'))
      .set('Origin', `https://${host}`);
    expect(serve.status).toBe(200);
    const payload = verifyTrackingToken(serve.body.token);
    expect(Number(payload.campId)).toBe(setup.campaignId);
    const t = serve.body.token;
    await request(app).post('/track').send({ t, type: 'impression' });
    await request(app).post('/track').send({ t, type: 'viewable_impression' });
    await request(app).post('/track').send({ t, type: 'interaction', interaction_name: 'expand' });
    await request(app).post('/track').send({ t, type: 'interaction', interaction_name: 'hover' });
    await request(app).post('/track').send({ t, type: 'click' });
    await eventBuffer.flush();
    await aggregateEvents({ sinceHours: 48 });

    const uniq = await db.EventAggregate.findOne({
      where: { campaign_id: setup.campaignId, type: 'interaction_unique' },
    });
    expect(uniq).toBeTruthy();
    expect(Number(uniq.count)).toBe(1);

    const from = new Date().toISOString().slice(0, 10);
    const report = await request(app)
      .get(`/api/reports/campaigns/${setup.campaignId}/summary?from=${from}&to=${from}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(report.status).toBe(200);
    const m = report.body.data.metrics;
    expect(m.impression).toBeGreaterThanOrEqual(1);
    expect(m.click).toBeGreaterThanOrEqual(1);
    expect(m.viewable_impression).toBeGreaterThanOrEqual(1);
    expect(m.ctr).toBeGreaterThan(0);
    expect(m.viewability_rate).toBeGreaterThan(0);
  });

  test('user ber-advertiser_id hanya campaign sendiri; 403 publisher/no-fill', async () => {
    const own = await db.Advertiser.create({ name: `Uni Own ${Date.now()}`, status: 'active' });
    const usersRole = await db.Role.findOne({ where: { name: 'Users' } });
    const email = `uni-scope-${Date.now()}@adserver.local`;
    await db.User.create({
      email,
      name: 'Uni Scoped',
      password_hash: await bcrypt.hash('TestPass123!', 10),
      role_id: usersRole.id,
      advertiser_id: own.id,
      is_active: true,
    });
    const login = await request(app).post('/auth/login').send({ email, password: 'TestPass123!' });
    const token = login.body.accessToken;
    const list = await request(app)
      .get('/api/reports/campaigns')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    for (const row of list.body.data) {
      expect(row.advertiser.id).toBe(String(own.id));
    }
    const pub = await request(app)
      .get('/api/reports/publishers')
      .set('Authorization', `Bearer ${token}`);
    expect(pub.status).toBe(403);
    const nf = await request(app)
      .get('/api/reports/no-fill')
      .set('Authorization', `Bearer ${token}`);
    expect(nf.status).toBe(403);
    expect(login.body.user.permissions).toContain(P.PUBLISHER_MANAGE);
  });
});

describe('UTM click', () => {
  test('click universal menambahkan utm_* tanpa menimpa yang sudah ada', async () => {
    const setup = await setupCreative({ width: 336, height: 280 });
    const host = `utm-${Date.now()}.example`;
    const serve = await request(app)
      .get(servePath(setup.tagKey, '336x280'))
      .set('Origin', `https://${host}`);
    expect(serve.status).toBe(200);
    const res = await request(app).get(`/track/click?t=${encodeURIComponent(serve.body.token)}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.searchParams.get('utm_source')).toBe(host);
    expect(loc.searchParams.get('utm_medium')).toBe('display');
    expect(loc.searchParams.get('utm_campaign')).toBeTruthy();
    expect(loc.searchParams.get('utm_content')).toBeTruthy();
  });
});
