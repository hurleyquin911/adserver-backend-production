const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../index');
const db = require('../models');
const eventBuffer = require('../utils/eventBuffer');
const { assertSafeEntryName } = require('../utils/zipCreative');
const { CREATIVE_CSP, IFRAME_SANDBOX } = require('../constant/headers');
const { makeZip } = require('./helpers');

let token;
let placementKey;
let creativeId;

beforeAll(async () => {
  const leftoverEvil = path.join(__dirname, '..', 'public', 'creatives', '2');
  fs.rmSync(leftoverEvil, { recursive: true, force: true });

  const login = await request(app)
    .post('/auth/login')
    .send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  token = login.body.accessToken;

  const adv = await request(app)
    .post('/api/advertisers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Serve Adv', status: 'active' });

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const camp = await request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${token}`)
    .send({
      advertiser_id: Number(adv.body.data.id),
      name: 'Serve Camp',
      start_date: start,
      end_date: end,
      status: 'active',
      priority: 5,
    });

  const zipBuf = makeZip({
    'index.html': '<html><body><a href="#" onclick="window.open(clickTag)">Go</a></body></html>',
    'style.css': 'body{margin:0}',
  });

  const creative = await request(app)
    .post('/api/creatives')
    .set('Authorization', `Bearer ${token}`)
    .field('campaign_id', camp.body.data.id)
    .field('name', 'Banner 300x250')
    .field('width', '300')
    .field('height', '250')
    .field('click_url', 'https://example.com/landing')
    .field('status', 'active')
    .attach('file', zipBuf, 'creative.zip');

  expect(creative.status).toBe(201);
  creativeId = creative.body.data.id;

  const site = await request(app)
    .post('/api/sites')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'News Site', domain: 'news.example' });

  const placement = await request(app)
    .post('/api/placements')
    .set('Authorization', `Bearer ${token}`)
    .send({
      site_id: Number(site.body.data.id),
      name: 'Homepage 300x250',
      width: 300,
      height: 250,
    });

  placementKey = placement.body.data.key;

  await request(app)
    .put(`/api/placements/${placement.body.data.id}/creatives`)
    .set('Authorization', `Bearer ${token}`)
    .send({ creative_ids: [Number(creativeId)] });
});

afterAll(async () => {
  await eventBuffer.flush();
  // Jangan hapus folder file jika baris DB tetap ada - preview studio akan 404.
});

describe('Upload validation', () => {
  test('tolak path traversal pada nama entry', () => {
    expect(() => assertSafeEntryName('../evil.js')).toThrow();
    expect(() => assertSafeEntryName('assets/../../evil.js')).toThrow();
    expect(() => assertSafeEntryName('/abs/path.js')).toThrow();
    expect(assertSafeEntryName('assets/main.js')).toBe('assets/main.js');
  });

  test('tolak tanpa index.html', async () => {
    const zipBuf = makeZip({ 'style.css': 'body{}' });
    const camp = await db.Campaign.findOne({ order: [['id', 'DESC']] });
    const res = await request(app)
      .post('/api/creatives')
      .set('Authorization', `Bearer ${token}`)
      .field('campaign_id', String(camp.id))
      .field('name', 'NoIndex')
      .field('width', '300')
      .field('height', '250')
      .field('click_url', 'https://example.com')
      .attach('file', zipBuf, 'noindex.zip');
    expect(res.status).toBe(400);
  });
});

describe('Creative same-origin headers', () => {
  test('semua /creatives/* membawa CSP sandbox + nosniff (tanpa frame-ancestors)', async () => {
    expect(CREATIVE_CSP).toContain('allow-scripts');
    expect(CREATIVE_CSP).toContain('allow-popups');
    expect(CREATIVE_CSP).toContain('allow-popups-to-escape-sandbox');
    expect(CREATIVE_CSP).not.toContain('allow-same-origin');
    expect(CREATIVE_CSP).not.toContain('allow-top-navigation');
    // Parent /ad/frame ber-origin opaque; frame-ancestors * akan memblokir embed
    expect(CREATIVE_CSP).not.toContain('frame-ancestors');

    const html = await request(app).get(`/creatives/${creativeId}/index.html`);
    expect(html.status).toBe(200);
    expect(html.headers['content-security-policy']).toBe(CREATIVE_CSP);
    expect(html.headers['x-content-type-options']).toBe('nosniff');

    const css = await request(app).get(`/creatives/${creativeId}/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers['content-security-policy']).toBe(CREATIVE_CSP);
    expect(css.headers['x-content-type-options']).toBe('nosniff');
  });

  test('preview file hilang mengembalikan HTML ramah, bukan JSON API', async () => {
    const res = await request(app).get('/creatives/999999/index.html');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toMatch(/tidak ada di storage/i);
    expect(res.text).not.toMatch(/NOT_FOUND/);
  });

  test('tag.js dan /ad/frame memakai atribut sandbox yang sama', async () => {
    const tag = await request(app).get(`/ad/tag.js?p=${placementKey}`);
    expect(tag.status).toBe(200);
    expect(tag.text).toContain(IFRAME_SANDBOX);
    expect(tag.text).toContain("referrerpolicy");
    expect(tag.text).toContain('origin');

    const serve = await request(app).get(`/ad/serve?p=${placementKey}`);
    const frame = await request(app).get(
      `/ad/frame?p=${placementKey}&sid=${serve.body.serve_id}&t=${encodeURIComponent(serve.body.token)}`
    );
    expect(frame.status).toBe(200);
    expect(frame.text).toContain(`sandbox="${IFRAME_SANDBOX}"`);
    expect(frame.text).toContain(`serveId:${JSON.stringify(serve.body.serve_id)}`);
    expect(frame.text).toContain(serve.body.token);
  });
});

describe('Serving & tracking', () => {
  test('serve mengembalikan token', async () => {
    const res = await request(app).get(`/ad/serve?p=${placementKey}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.creative_url).toContain('/creatives/');
  });

  test('token invalid ditolak', async () => {
    const res = await request(app)
      .post('/track')
      .send({ t: 'invalid.token', type: 'impression' });
    expect(res.status).toBe(401);
  });

  test('impression valid dan dedupe lewat unique dedupe_key', async () => {
    const serve = await request(app).get(`/ad/serve?p=${placementKey}`);
    const t = serve.body.token;
    const a = await request(app).post('/track').send({ t, type: 'impression' });
    const b = await request(app).post('/track').send({ t, type: 'impression' });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    await eventBuffer.flush();
    const rows = await db.Event.findAll({
      where: { serve_id: serve.body.serve_id, type: 'impression' },
    });
    expect(rows).toHaveLength(1);
  });

  test('viewable_impression dan click ganda tidak tersimpan; dua interaction tersimpan', async () => {
    const serve = await request(app).get(`/ad/serve?p=${placementKey}`);
    const t = serve.body.token;
    const serveId = serve.body.serve_id;

    await request(app).post('/track').send({ t, type: 'viewable_impression' });
    await request(app).post('/track').send({ t, type: 'viewable_impression' });
    await request(app).post('/track').send({ t, type: 'click' });
    await request(app).post('/track').send({ t, type: 'click' });
    const i1 = await request(app)
      .post('/track')
      .send({ t, type: 'interaction', interaction_name: 'expand' });
    const i2 = await request(app)
      .post('/track')
      .send({ t, type: 'interaction', interaction_name: 'hover' });
    expect(i1.body.accepted).toBe(true);
    expect(i2.body.accepted).toBe(true);

    await eventBuffer.flush();
    const rows = await db.Event.findAll({ where: { serve_id: serveId } });
    const types = rows.map((r) => r.type);
    expect(types.filter((x) => x === 'viewable_impression')).toHaveLength(1);
    expect(types.filter((x) => x === 'click')).toHaveLength(1);
    expect(types.filter((x) => x === 'interaction')).toHaveLength(2);
  });

  test('click redirect ke click_url DB', async () => {
    const serve = await request(app).get(`/ad/serve?p=${placementKey}`);
    const res = await request(app).get(`/track/click?t=${encodeURIComponent(serve.body.token)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/landing');
  });

  test('click_url javascript ditolak; tanpa click_url tidak redirect', async () => {
    const camp = await db.Campaign.findOne({ order: [['id', 'DESC']] });
    const zipBuf = makeZip({ 'index.html': '<html><body>x</body></html>' });
    const bad = await request(app)
      .post('/api/creatives')
      .set('Authorization', `Bearer ${token}`)
      .field('campaign_id', String(camp.id))
      .field('name', 'Js Click')
      .field('width', '300')
      .field('height', '250')
      .field('click_url', 'javascript:alert(1)')
      .attach('file', zipBuf, 'js.zip');
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post('/api/creatives')
      .set('Authorization', `Bearer ${token}`)
      .field('campaign_id', String(camp.id))
      .field('name', 'No Click')
      .field('width', '300')
      .field('height', '250')
      .field('click_url', '')
      .field('status', 'active')
      .attach('file', zipBuf, 'noclick.zip');
    expect(ok.status).toBe(201);
    expect(ok.body.data.click_url).toBeFalsy();
  });
});
