/* eslint-disable no-console */
/**
 * Smoke test alur tag universal:
 *   node scripts/smoke-test.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const AdmZip = require('adm-zip');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const BASE = process.env.PUBLIC_BASE_URL || 'http://localhost:5003';

function request(method, urlPath, { headers = {}, body = null, form = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
      });
    });
    req.on('error', reject);

    if (form) {
      req.write(form);
    } else if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function multipart(fields, fileField, fileName, fileBuf) {
  const boundary = '----SmokeBoundary' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
    );
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`
  );
  const head = Buffer.from(parts.join(''), 'utf8');
  const mid = fileBuf;
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([head, mid, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function main() {
  console.log('Smoke test (tag universal) against', BASE);

  const login = await request('POST', '/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: {
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    },
  });
  if (login.status !== 200) throw new Error('login failed: ' + login.text);
  const token = login.json.accessToken;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  console.log('✓ login');

  const adv = await request('POST', '/api/advertisers', {
    headers: auth,
    body: { name: 'Smoke Advertiser ' + Date.now(), status: 'active' },
  });
  if (adv.status !== 201) throw new Error('advertiser failed');
  console.log('✓ advertiser');

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const camp = await request('POST', '/api/campaigns', {
    headers: auth,
    body: {
      advertiser_id: Number(adv.json.data.id),
      name: 'Smoke Campaign',
      start_date: start,
      end_date: end,
      status: 'active',
      priority: 3,
      impression_goal: 3,
    },
  });
  if (camp.status !== 201) throw new Error('campaign failed: ' + camp.text);
  const campaignId = camp.json.data.id;
  console.log('✓ campaign goal=3');

  const zip = new AdmZip();
  zip.addFile(
    'index.html',
    Buffer.from('<html><body style="background:#0af;color:#fff">Smoke</body></html>')
  );
  const zipBuf = zip.toBuffer();
  const form = multipart(
    {
      campaign_id: campaignId,
      name: 'Smoke Creative',
      width: '320',
      height: '100',
      click_url: 'https://example.com/smoke',
      status: 'active',
    },
    'file',
    'smoke.zip',
    zipBuf
  );
  const creative = await request('POST', '/api/creatives', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': form.contentType },
    form: form.body,
  });
  if (creative.status !== 201) throw new Error('creative failed: ' + creative.text);
  console.log('✓ creative upload');

  const originA = 'https://smoke-a-' + Date.now() + '.example';
  const originB = 'https://smoke-b-' + Date.now() + '.example';

  async function serveAndTrack(origin) {
    const serve = await request('GET', '/ad/serve?size=320x100&pu=/smoke', {
      headers: { Origin: origin },
    });
    if (serve.status !== 200) throw new Error('serve failed: ' + serve.status + ' ' + serve.text);
    const t = serve.json.token;
    await request('POST', '/track', {
      headers: { 'Content-Type': 'application/json' },
      body: { t, type: 'impression' },
    });
    await request('POST', '/track', {
      headers: { 'Content-Type': 'application/json' },
      body: { t, type: 'viewable_impression' },
    });
    await request('POST', '/track', {
      headers: { 'Content-Type': 'application/json' },
      body: { t, type: 'interaction', interaction_name: 'expand' },
    });
    await request('GET', '/track/click?t=' + encodeURIComponent(t));
    return serve;
  }

  await serveAndTrack(originA);
  console.log('✓ serve+track origin A');
  await serveAndTrack(originB);
  console.log('✓ serve+track origin B');
  await serveAndTrack(originA);
  console.log('✓ serve+track origin A (3/3 goal)');

  await new Promise((r) => setTimeout(r, 4000));
  const agg = await request('POST', '/api/reports/aggregate', { headers: auth, body: {} });
  if (agg.status !== 200) throw new Error('aggregate failed: ' + agg.text);

  const report = await request('GET', `/api/reports/campaigns/${campaignId}/summary?from=${start}&to=${end}`, {
    headers: auth,
  });
  if (report.status !== 200) throw new Error('report failed: ' + report.text);
  console.log('✓ report campaign', report.json.data.metrics);

  const bd = await request(
    'GET',
    `/api/reports/campaigns/${campaignId}/breakdown?from=${start}&to=${end}&by=publisher`,
    { headers: auth }
  );
  if (bd.status !== 200) throw new Error('breakdown failed');
  const pubs = (bd.json.data || []).filter((p) => p.key && p.key !== '0');
  if (pubs.length < 2) {
    throw new Error('expected two publishers, got ' + JSON.stringify(bd.json.data));
  }
  console.log('✓ two publishers in report');

  const afterGoal = await request('GET', '/ad/serve?size=320x100', {
    headers: { Origin: originA },
  });
  if (afterGoal.status !== 204) {
    throw new Error('expected 204 after goal, got ' + afterGoal.status + ' ' + afterGoal.text);
  }
  console.log('✓ serve 204 after goal');
  console.log('SMOKE OK');
}

main().catch((err) => {
  console.error('SMOKE FAILED', err);
  process.exit(1);
});
