const request = require('supertest');
const app = require('../index');
const { verifyTrackingToken } = require('../utils/tokens');
const { makeZip } = require('./helpers');
const { matchDomain } = require('../utils/publisherOrigin');
const env = require('../config/env');

let token;

async function loginAdmin() {
  const login = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  return login.body.accessToken;
}

async function setupPlacement({ allowed_domains, advertiserStatus = 'active' }) {
  const adv = await request(app)
    .post('/api/advertisers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Dom Adv ${Date.now()}`, status: advertiserStatus });

  const today = new Date();
  const camp = await request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${token}`)
    .send({
      advertiser_id: Number(adv.body.data.id),
      name: 'Dom Camp',
      start_date: today.toISOString().slice(0, 10),
      end_date: new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10),
      status: 'active',
      priority: 1,
    });
  const zipBuf = makeZip({ 'index.html': '<html><body>ad</body></html>' });
  const creative = await request(app)
    .post('/api/creatives')
    .set('Authorization', `Bearer ${token}`)
    .field('campaign_id', camp.body.data.id)
    .field('name', 'Dom Creative')
    .field('width', '300')
    .field('height', '250')
    .field('click_url', 'https://example.com/dom')
    .field('status', 'active')
    .attach('file', zipBuf, 'dom.zip');

  const site = await request(app)
    .post('/api/sites')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: `Dom Site ${Date.now()}`,
      domain: 'publisher.example',
      allowed_domains,
    });

  const placement = await request(app)
    .post('/api/placements')
    .set('Authorization', `Bearer ${token}`)
    .send({
      site_id: Number(site.body.data.id),
      name: 'Dom Placement',
      width: 300,
      height: 250,
    });

  await request(app)
    .put(`/api/placements/${placement.body.data.id}/creatives`)
    .set('Authorization', `Bearer ${token}`)
    .send({ creative_ids: [Number(creative.body.data.id)] });

  return {
    key: placement.body.data.key,
    advertiserId: adv.body.data.id,
    siteId: Number(site.body.data.id),
  };
}

beforeAll(async () => {
  token = await loginAdmin();
});


describe('Domain matching helper', () => {
  test('wildcard memakai hostname URL; apex tidak cocok', () => {
    expect(matchDomain('a.contoh.com', '*.contoh.com')).toBe(true);
    expect(matchDomain('https://a.contoh.com', '*.contoh.com')).toBe(true);
    expect(matchDomain('contoh.com', '*.contoh.com')).toBe(false);
    expect(matchDomain('evilcontoh.com', '*.contoh.com')).toBe(false);
    expect(matchDomain('contoh.com.evil.com', '*.contoh.com')).toBe(false);
    expect(matchDomain('https://contoh.com@evil.com', '*.contoh.com')).toBe(false);
    expect(matchDomain('publisher.example', 'publisher.example')).toBe(true);
    expect(matchDomain('http://127.0.0.1:5500/testingRMBPlacements.html', '127.0.0.1:5500')).toBe(
      true
    );
    expect(matchDomain('http://127.0.0.1:5500', '127.0.0.1')).toBe(true);
  });
});

describe('Pembatasan domain serving', () => {
  test('domain cocok diizinkan; token memuat siteId dan originOk', async () => {
    const { key, siteId } = await setupPlacement({ allowed_domains: ['publisher.example'] });
    const res = await request(app)
      .get(`/ad/serve?p=${key}`)
      .set('Origin', 'https://publisher.example');
    expect(res.status).toBe(200);
    const payload = verifyTrackingToken(res.body.token);
    expect(payload.siteId).toBe(siteId);
    expect(payload.originOk).toBe(true);
  });

  test('domain tidak cocok ditolak 403 pada serve, tag.js, dan frame', async () => {
    const { key } = await setupPlacement({ allowed_domains: ['publisher.example'] });
    const origin = 'https://evil.example';
    const serve = await request(app).get(`/ad/serve?p=${key}`).set('Origin', origin);
    const tag = await request(app).get(`/ad/tag.js?p=${key}`).set('Origin', origin);
    const frame = await request(app).get(`/ad/frame?p=${key}`).set('Origin', origin);
    expect(serve.status).toBe(403);
    expect(tag.status).toBe(403);
    expect(frame.status).toBe(403);
  });

  test('allowed_domains kosong diizinkan', async () => {
    const { key } = await setupPlacement({ allowed_domains: [] });
    const res = await request(app)
      .get(`/ad/serve?p=${key}`)
      .set('Origin', 'https://random.example');
    expect(res.status).toBe(200);
  });

  test('REQUIRE_ALLOWED_DOMAINS menolak list kosong', async () => {
    const { key } = await setupPlacement({ allowed_domains: [] });
    env.REQUIRE_ALLOWED_DOMAINS = true;
    try {
      const res = await request(app).get(`/ad/serve?p=${key}`);
      expect(res.status).toBe(403);
    } finally {
      env.REQUIRE_ALLOWED_DOMAINS = false;
    }
  });

  test('frame dengan token valid tidak cek ulang Origin', async () => {
    const { key } = await setupPlacement({ allowed_domains: ['publisher.example'] });
    const serve = await request(app)
      .get(`/ad/serve?p=${key}`)
      .set('Origin', 'https://publisher.example');
    const frame = await request(app)
      .get(`/ad/frame?p=${key}&sid=${serve.body.serve_id}&t=${encodeURIComponent(serve.body.token)}`)
      .set('Origin', 'https://evil.example');
    expect(frame.status).toBe(200);
    expect(frame.text).toContain(`serveId:${JSON.stringify(serve.body.serve_id)}`);
  });

  test('wildcard *.contoh.com lolos untuk subdomain', async () => {
    const { key } = await setupPlacement({ allowed_domains: ['*.contoh.com'] });
    const res = await request(app)
      .get(`/ad/serve?p=${key}`)
      .set('Origin', 'https://ads.contoh.com');
    expect(res.status).toBe(200);
  });

  test('site menerima URL Live Server 127.0.0.1:5500', async () => {
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Local Site ${Date.now()}`,
        allowed_domains: ['http://127.0.0.1:5500/testingRMBPlacements.html'],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.allowed_domains).toEqual(['127.0.0.1:5500']);

    const { key } = await setupPlacement({ allowed_domains: ['127.0.0.1:5500'] });
    const serve = await request(app)
      .get(`/ad/serve?p=${key}`)
      .set('Origin', 'http://127.0.0.1:5500');
    expect(serve.status).toBe(200);
  });

  test('site menerima URL lengkap lalu menyimpan hostname', async () => {
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Url Site ${Date.now()}`,
        domain: 'https://news.example.com/path',
        allowed_domains: ['https://publisher.example/', '*.contoh.com'],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.allowed_domains).toEqual(['publisher.example', '*.contoh.com']);
  });

  test('site menolak format domain invalid', async () => {
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Domain', allowed_domains: ['not a domain'] });
    expect(res.status).toBe(400);
  });

  test('/track preflight dari origin null lolos tanpa credentials', async () => {
    const res = await request(app)
      .options('/track')
      .set('Origin', 'null')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('/track tidak menolak Origin null', async () => {
    const { key } = await setupPlacement({ allowed_domains: ['publisher.example'] });
    const serve = await request(app)
      .get(`/ad/serve?p=${key}`)
      .set('Origin', 'https://publisher.example');
    const track = await request(app)
      .post('/track')
      .set('Origin', 'null')
      .send({ t: serve.body.token, type: 'impression' });
    expect(track.status).toBe(202);
    expect(track.body.accepted).toBe(true);
  });

  test('/ad/serve menolak campaign advertiser inactive', async () => {
    const { key, advertiserId } = await setupPlacement({
      allowed_domains: [],
      advertiserStatus: 'active',
    });
    await request(app)
      .patch(`/api/advertisers/${advertiserId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'inactive' });
    const res = await request(app).get(`/ad/serve?p=${key}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_FILL');
  });
});
