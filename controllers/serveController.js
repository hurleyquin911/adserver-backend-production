const { Op } = require('sequelize');
const path = require('path');
const db = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const {
  createServeId,
  signTrackingToken,
  verifyTrackingToken,
  signPublisherCtx,
  verifyPublisherCtx,
  hashIp,
} = require('../utils/tokens');
const { getStorage } = require('../utils/storage');
const { assertPublisherAllowed } = require('../utils/publisherOrigin');
const { resolvePublisher } = require('../utils/publisherIdentity');
const { parseSizeQuery, sanitizePagePath, sizeKey } = require('../utils/slotSize');
const { pickUniversal } = require('../utils/universalSelect');
const { detectDevice } = require('../utils/deviceType');
const { resolveBrandFromTagKey } = require('../utils/resolveBrandTag');
const {
  parseSz,
  cachebusterFromQuery,
  dspClickFromQuery,
  applyDspClickPrefix,
} = require('../utils/dspTag');
const eventBuffer = require('../utils/eventBuffer');
const { IFRAME_SANDBOX } = require('../constant/headers');
const env = require('../config/env');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pickCreative(candidates) {
  if (!candidates.length) return null;
  const weights = candidates.map((c) => Math.max(1, c.campaign?.priority || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function withClickTag(creativeUrl, clickUrl) {
  if (!clickUrl) return creativeUrl;
  const join = String(creativeUrl).includes('?') ? '&' : '?';
  return `${creativeUrl}${join}clickTag=${encodeURIComponent(clickUrl)}`;
}

function creativePublicUrl(creative) {
  const storage = getStorage();
  return storage.getUrl(path.posix.join(String(creative.base_path), creative.entry_file || 'index.html'));
}

function packServe({ placement, creative, serveId, token, width, height, dspClick = null }) {
  const creativeUrl = creativePublicUrl(creative);
  let clickUrl = creative.click_url
    ? `${env.PUBLIC_BASE_URL}/track/click?t=${encodeURIComponent(token)}`
    : '';
  // Rantai klik DSP → ad server → landing (standar ${CLICK_URL}+destination)
  if (clickUrl && dspClick) {
    clickUrl = applyDspClickPrefix(dspClick, clickUrl);
  }
  return {
    placement,
    creative,
    serveId,
    token,
    creativeUrl,
    clickUrl,
    trackUrl: `${env.PUBLIC_BASE_URL}/track`,
    sdkUrl: `${env.PUBLIC_BASE_URL}/sdk/adsdk.js`,
    width: width || placement?.width || creative.width,
    height: height || placement?.height || creative.height,
  };
}

async function loadPlacementSite(placementKey) {
  const placement = await db.Placement.findOne({
    where: { key: placementKey },
    include: [{ model: db.Site, as: 'site', required: true }],
  });
  if (!placement) {
    throw new AppError('NOT_FOUND', 'Placement tidak ditemukan', 404);
  }
  return placement;
}

async function resolveServe(placementKey, req) {
  const meta = await loadPlacementSite(placementKey);
  const domain = assertPublisherAllowed(req, meta.site);

  const placement = await db.Placement.findOne({
    where: { key: placementKey },
    include: [
      { model: db.Site, as: 'site', required: true },
      {
        model: db.Creative,
        as: 'creatives',
        required: true,
        where: { status: 'active' },
        include: [
          {
            model: db.Campaign,
            as: 'campaign',
            required: true,
            where: {
              status: 'active',
              start_date: { [Op.lte]: todayStr() },
              end_date: { [Op.gte]: todayStr() },
            },
            include: [
              {
                model: db.Advertiser,
                as: 'advertiser',
                required: true,
                where: { status: 'active' },
              },
            ],
          },
        ],
      },
    ],
  });

  if (!placement || !placement.creatives?.length) {
    throw new AppError('NO_FILL', 'Tidak ada creative aktif untuk placement ini', 404);
  }

  const creative = pickCreative(placement.creatives);
  const serveId = createServeId();
  const token = signTrackingToken({
    sid: serveId,
    pid: Number(placement.id),
    cid: Number(creative.id),
    campId: Number(creative.campaign_id),
    siteId: Number(placement.site_id),
    originOk: Boolean(domain.originOk),
    exp: Date.now() + 24 * 60 * 60 * 1000,
  });

  return packServe({ placement, creative, serveId, token });
}

async function loadServeFromToken(placementKey, tokenStr, payload) {
  const placement = await loadPlacementSite(placementKey);
  if (Number(placement.id) !== Number(payload.pid)) {
    throw new AppError('INVALID_TOKEN', 'Token tidak cocok dengan placement', 401);
  }
  const creative = await db.Creative.findByPk(payload.cid);
  if (!creative) {
    throw new AppError('NO_FILL', 'Tidak ada creative aktif untuk placement ini', 404);
  }
  return packServe({
    placement,
    creative,
    serveId: payload.sid,
    token: tokenStr,
  });
}

async function loadUniversalFromToken(tokenStr, payload) {
  const creative = await db.Creative.findByPk(payload.cid);
  if (!creative) {
    throw new AppError('NO_FILL', 'Creative tidak ditemukan', 404);
  }
  const [w, h] = String(payload.size || sizeKey(creative.width, creative.height)).split('x');
  return packServe({
    placement: null,
    creative,
    serveId: payload.sid,
    token: tokenStr,
    width: Number(w) || creative.width,
    height: Number(h) || creative.height,
  });
}

function renderFrame(data) {
  const w = data.width;
  const h = data.height;
  const creativeSrc = withClickTag(data.creativeUrl, data.clickUrl);
  return `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; media-src https: http:; style-src 'unsafe-inline' https: http:; script-src 'unsafe-inline' https: http: ${env.PUBLIC_BASE_URL}; connect-src ${env.PUBLIC_BASE_URL}; frame-src ${env.PUBLIC_BASE_URL}; child-src ${env.PUBLIC_BASE_URL};"/>
<style>html,body{margin:0;padding:0;overflow:hidden;width:${w}px;height:${h}px;}iframe{border:0;width:${w}px;height:${h}px;}</style>
</head><body>
<iframe id="c" sandbox="${IFRAME_SANDBOX}" src="${creativeSrc}"></iframe>
<script src="${data.sdkUrl}"></script>
<script>
window.__ADSERVER__={token:${JSON.stringify(data.token)},serveId:${JSON.stringify(data.serveId)},trackUrl:${JSON.stringify(data.trackUrl)},clickUrl:${JSON.stringify(data.clickUrl || '')},width:${w},height:${h}};
if(window.__ADSERVER__.clickUrl){window.clickTag=window.__ADSERVER__.clickUrl;}
if(window.AdServerSDK){AdServerSDK.init(window.__ADSERVER__);}
</script>
</body></html>`;
}

function recordServeEvent(req, { type, serveId, publisher, creative, size, pagePath, advertiserId }) {
  const advId =
    advertiserId != null
      ? Number(advertiserId)
      : creative?.campaign?.advertiser_id != null
        ? Number(creative.campaign.advertiser_id)
        : null;
  eventBuffer.enqueue({
    placement_id: null,
    creative_id: creative ? Number(creative.id) : null,
    campaign_id: creative ? Number(creative.campaign_id) : null,
    publisher_id: publisher ? Number(publisher.id) : null,
    advertiser_id: advId,
    serve_id: serveId,
    type,
    interaction_name: null,
    slot_size: size || null,
    page_path: pagePath || null,
    occurred_at: new Date(),
    device_type: detectDevice(req.get('user-agent')),
    ip_hash: hashIp(req.ip),
    user_agent: (req.get('user-agent') || '').slice(0, 1000),
    referrer: (req.get('referer') || '').slice(0, 1000),
    dedupe_key: `${serveId}:${type}`,
  });
}

/**
 * Mode DSP/SSP (sz wajib): document.write iframe — pola third-party klasik.
 * Tidak memakai fetch/DOM async agar lolos preview & scanner DSP.
 */
function dspTagSource({ tagKey, width, height, ord, click }) {
  const base = env.PUBLIC_BASE_URL;
  const frameQs =
    `a=${encodeURIComponent(tagKey)}` +
    `&sz=${width}x${height}` +
    `&ord=${encodeURIComponent(ord || '')}` +
    (click ? `&click=${encodeURIComponent(click)}` : '');
  return `(function(){
var src=${JSON.stringify(`${base}/ad/frame?${frameQs}`)};
var w=${Number(width)},h=${Number(height)};
var html='<iframe src="'+src+'" width="'+w+'" height="'+h+'" frameborder="0" marginwidth="0" marginheight="0" scrolling="no" style="border:0;vertical-align:bottom;width:'+w+'px;height:'+h+'px"></iframe>';
try{document.write(html);}catch(e){
  var s=document.currentScript,d=document.createElement('div');
  d.innerHTML=html;
  if(s&&s.parentNode)s.parentNode.insertBefore(d,s);
  else(document.body||document.documentElement).appendChild(d);
}
})();`;
}

function universalTagSource(tagKey) {
  const base = env.PUBLIC_BASE_URL;
  // Direct site: ukur parent. DSP sebaiknya pakai ?sz=WxH (lihat dspTagSource).
  return `(function(){
var BASE=${JSON.stringify(base)};
var A=${JSON.stringify(String(tagKey))};
var SANDBOX=${JSON.stringify(IFRAME_SANDBOX)};
var s=document.currentScript;
if(!s)return;
function parseSizes(attr){
  if(!attr)return[];
  return attr.split(',').map(function(x){return x.trim();}).filter(Boolean);
}
function readParentSize(el){
  if(!el)return[];
  var w=el.clientWidth,h=el.clientHeight;
  if(w>0&&h>0)return[Math.round(w)+'x'+Math.round(h)];
  w=el.offsetWidth;h=el.offsetHeight;
  if(w>0&&h>0)return[Math.round(w)+'x'+Math.round(h)];
  try{
    var cs=window.getComputedStyle(el);
    w=parseFloat(cs.width)||0;h=parseFloat(cs.height)||0;
    if(w>0&&h>0)return[Math.round(w)+'x'+Math.round(h)];
  }catch(e){}
  return[];
}
function detectSizes(){
  var sizes=parseSizes(s.getAttribute('data-size'));
  if(sizes.length)return sizes;
  return readParentSize(s.parentElement);
}
function serve(sizes){
  var pu=(location.pathname||'/').split('?')[0].split('#')[0];
  var slot=document.createElement('div');
  slot.setAttribute('data-adserver','1');
  if(s.parentNode){s.parentNode.insertBefore(slot,s);}else{document.body.appendChild(slot);}
  fetch(BASE+'/ad/serve?a='+encodeURIComponent(A)+'&size='+encodeURIComponent(sizes.join(','))+'&pu='+encodeURIComponent(pu),{credentials:'omit'})
  .then(function(r){
    if(r.status===204)return null;
    if(!r.ok)throw new Error('nofill');
    return r.json();
  })
  .then(function(data){
    if(!data||!data.token||!data.creative)return;
    var iframe=document.createElement('iframe');
    iframe.width=data.creative.width;iframe.height=data.creative.height;
    iframe.style.border='0';iframe.setAttribute('scrolling','no');
    iframe.setAttribute('sandbox',SANDBOX);
    iframe.setAttribute('referrerpolicy','origin');
    iframe.src=BASE+'/ad/frame?t='+encodeURIComponent(data.token);
    slot.appendChild(iframe);
  }).catch(function(){});
}
function start(){
  var sizes=detectSizes();
  if(sizes.length){serve(sizes);return;}
  requestAnimationFrame(function(){
    var retry=detectSizes();
    if(!retry.length){
      console.warn('[adserver] Untuk DSP/SSP gunakan tag berukuran tetap (?sz=300x250). Untuk situs langsung, bungkus tag dalam div berukuran.');
      return;
    }
    serve(retry);
  });
}
start();
})();`;
}

function renderUniversalBootstrap({ ctx, base, tagKey }) {
  return `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; media-src https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${base}; connect-src ${base}; frame-src ${base}; child-src ${base};"/>
<style>html,body{margin:0;padding:0;overflow:hidden;width:100%;height:100%;}iframe{border:0;}</style>
</head><body>
<script src="${base}/sdk/adsdk.js"></script>
<script>
(function(){
  var BASE=${JSON.stringify(base)};
  var A=${JSON.stringify(String(tagKey))};
  var CTX=${JSON.stringify(ctx)};
  var SANDBOX=${JSON.stringify(IFRAME_SANDBOX)};
  var w=Math.round(window.innerWidth||0);
  var h=Math.round(window.innerHeight||0);
  if(w<1||h<1)return;
  var size=w+'x'+h;
  fetch(BASE+'/ad/serve?a='+encodeURIComponent(A)+'&ctx='+encodeURIComponent(CTX)+'&size='+encodeURIComponent(size),{credentials:'omit'})
  .then(function(r){if(r.status===204)return null;if(!r.ok)throw new Error('nofill');return r.json();})
  .then(function(data){
    if(!data||!data.creative)return;
    var iframe=document.createElement('iframe');
    iframe.id='c';
    iframe.width=data.creative.width;iframe.height=data.creative.height;
    iframe.setAttribute('sandbox',SANDBOX);
    iframe.setAttribute('referrerpolicy','origin');
    var src=data.creative.url;
    if(data.clickUrl){src+=(src.indexOf('?')>=0?'&':'?')+'clickTag='+encodeURIComponent(data.clickUrl);}
    iframe.src=src;
    document.body.appendChild(iframe);
    window.__ADSERVER__={token:data.token,serveId:data.serveId,trackUrl:BASE+'/track',clickUrl:data.clickUrl||'',width:data.creative.width,height:data.creative.height};
    if(window.__ADSERVER__.clickUrl){window.clickTag=window.__ADSERVER__.clickUrl;}
    if(window.AdServerSDK){AdServerSDK.init(window.__ADSERVER__);}
  }).catch(function(){});
})();
</script>
</body></html>`;
}

/**
 * Resolve fill universal. returnMode:
 * - 'json' → HTTP JSON (API /ad/serve)
 * - 'packed' → objek packServe / null (untuk /ad/frame DSP)
 * - 'empty' → 204 sudah dikirim (hanya jika res dipakai)
 */
async function resolveUniversalFill(req, { sizeRaw, returnMode = 'json' } = {}) {
  const parsed = parseSizeQuery(sizeRaw != null ? sizeRaw : req.query.size || req.query.sz);
  if (!parsed.ok) {
    throw new AppError('VALIDATION_ERROR', parsed.error, 400);
  }

  let ctxPayload = null;
  if (req.query.ctx) {
    ctxPayload = verifyPublisherCtx(String(req.query.ctx));
    if (!ctxPayload) {
      throw new AppError('INVALID_TOKEN', 'ctx tidak valid atau kedaluwarsa', 401);
    }
  }

  const rawTag =
    req.query.a ||
    (ctxPayload && ctxPayload.tagKey) ||
    null;
  const brand = await resolveBrandFromTagKey(rawTag);
  if (brand.error) {
    throw new AppError('VALIDATION_ERROR', brand.error, 400);
  }
  const advertiser = brand.advertiser;
  const advertiserId = Number(advertiser.id);
  const dspClick = dspClickFromQuery(req.query);

  const ident = await resolvePublisher(req, { ctxPayload, advertiserId });
  const pagePath = sanitizePagePath(req.query.pu);
  const primarySlot = parsed.sizes[0].key;

  if (ident.rejected) {
    if (ident.reason === 'pending' && ident.publisher) {
      recordServeEvent(req, {
        type: 'request',
        serveId: createServeId(),
        publisher: ident.publisher,
        creative: null,
        size: primarySlot,
        pagePath,
        advertiserId,
      });
    }
    return { empty: true, packed: null };
  }

  const creative = await pickUniversal({ sizes: parsed.sizes, advertiserId });
  const serveId = createServeId();

  if (!creative) {
    recordServeEvent(req, {
      type: 'request',
      serveId,
      publisher: ident.publisher,
      creative: null,
      size: primarySlot,
      pagePath,
      advertiserId,
    });
    recordServeEvent(req, {
      type: 'no_fill',
      serveId,
      publisher: ident.publisher,
      creative: null,
      size: primarySlot,
      pagePath,
      advertiserId,
    });
    return { empty: true, packed: null };
  }

  const chosenSize = sizeKey(creative.width, creative.height);
  recordServeEvent(req, {
    type: 'request',
    serveId,
    publisher: ident.publisher,
    creative,
    size: chosenSize,
    pagePath,
    advertiserId,
  });
  const token = signTrackingToken({
    sid: serveId,
    cid: Number(creative.id),
    campId: Number(creative.campaign_id),
    pubId: Number(ident.publisher.id),
    advId: advertiserId,
    size: chosenSize,
    host: ident.host,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  });

  const packed = packServe({
    placement: null,
    creative,
    serveId,
    token,
    width: creative.width,
    height: creative.height,
    dspClick,
  });

  return { empty: false, packed, creative };
}

async function resolveUniversalServe(req, res) {
  // Alias sz → size (DSP)
  if (!req.query.size && req.query.sz) {
    req.query.size = req.query.sz;
  }
  const result = await resolveUniversalFill(req);
  if (result.empty) {
    return res.status(204).end();
  }
  const { packed, creative } = result;
  return res.json({
    serveId: packed.serveId,
    token: packed.token,
    clickUrl: packed.clickUrl || '',
    creative: {
      url: packed.creativeUrl,
      width: creative.width,
      height: creative.height,
    },
  });
}

const serve = asyncHandler(async (req, res) => {
  const p = req.query.p;
  if (p) {
    const data = await resolveServe(String(p), req);
    res.json({
      serve_id: data.serveId,
      token: data.token,
      width: data.placement.width,
      height: data.placement.height,
      creative_url: data.creativeUrl,
      click_url: data.clickUrl || null,
      track_url: data.trackUrl,
      sdk_url: data.sdkUrl,
      creative_id: String(data.creative.id),
      campaign_id: String(data.creative.campaign_id),
      placement_id: String(data.placement.id),
    });
    return;
  }
  await resolveUniversalServe(req, res);
});

const tagJs = asyncHandler(async (req, res) => {
  const p = req.query.p;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  if (p) {
    const placement = await loadPlacementSite(String(p));
    assertPublisherAllowed(req, placement.site);
    const base = env.PUBLIC_BASE_URL;
    const js = `(function(){
var p=${JSON.stringify(String(p))};
var s=document.currentScript;
var d=document.createElement('div');
d.setAttribute('data-adserver-placement',p);
if(s&&s.parentNode){s.parentNode.insertBefore(d,s);}else{document.body.appendChild(d);}
fetch(${JSON.stringify(base)}+'/ad/serve?p='+encodeURIComponent(p),{credentials:'omit'})
.then(function(r){if(!r.ok)throw new Error('nofill');return r.json();})
.then(function(data){
  var iframe=document.createElement('iframe');
  iframe.width=data.width;iframe.height=data.height;
  iframe.style.border='0';iframe.setAttribute('scrolling','no');
  iframe.setAttribute('sandbox',${JSON.stringify(IFRAME_SANDBOX)});
  iframe.setAttribute('referrerpolicy','origin');
  iframe.src=${JSON.stringify(base)}+'/ad/frame?p='+encodeURIComponent(p)+'&sid='+encodeURIComponent(data.serve_id)+'&t='+encodeURIComponent(data.token);
  d.appendChild(iframe);
}).catch(function(){});
})();`;
    res.setHeader('Cache-Control', 'no-store');
    res.send(js);
    return;
  }

  const brand = await resolveBrandFromTagKey(req.query.a);
  if (brand.error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).send(
      `console.error(${JSON.stringify(`[adserver] ${brand.error}`)});`
    );
    return;
  }

  // Mode DSP: sz tetap + document.write iframe (standar third-party)
  const dspSize = parseSz(req.query.sz || req.query.size);
  if (dspSize) {
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      dspTagSource({
        tagKey: brand.advertiser.tag_key,
        width: dspSize.width,
        height: dspSize.height,
        ord: cachebusterFromQuery(req.query),
        click: dspClickFromQuery(req.query),
      })
    );
    return;
  }

  const maxAge = Number(env.TAG_JS_CACHE_SECONDS) || 0;
  res.setHeader('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store');
  res.send(universalTagSource(brand.advertiser.tag_key));
});

const frame = asyncHandler(async (req, res) => {
  const p = req.query.p;
  const tokenStr = req.query.t ? String(req.query.t) : '';
  const payload = tokenStr ? verifyTrackingToken(tokenStr) : null;

  if (p) {
    const data =
      payload && payload.sid
        ? await loadServeFromToken(String(p), tokenStr, payload)
        : await resolveServe(String(p), req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(renderFrame(data));
    return;
  }

  if (payload && payload.sid && payload.cid && !payload.k) {
    const data = await loadUniversalFromToken(tokenStr, payload);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(renderFrame(data));
    return;
  }

  const brand = await resolveBrandFromTagKey(req.query.a);
  if (brand.error) {
    throw new AppError('VALIDATION_ERROR', brand.error, 400);
  }

  // DSP iframe: resolve fill sekali di server (tanpa fetch kedua dari browser)
  const dspSize = parseSz(req.query.sz || req.query.size);
  if (dspSize) {
    const result = await resolveUniversalFill(req, {
      sizeRaw: dspSize.key,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (result.empty || !result.packed) {
      res.status(204).end();
      return;
    }
    res.send(renderFrame(result.packed));
    return;
  }

  const advertiserId = Number(brand.advertiser.id);
  const ident = await resolvePublisher(req, { advertiserId });
  if (ident.rejected) {
    res.status(204).end();
    return;
  }
  const ctx = signPublisherCtx({
    pubId: ident.publisher.id,
    host: ident.host,
    advId: advertiserId,
    tagKey: brand.advertiser.tag_key,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.send(
    renderUniversalBootstrap({
      ctx,
      base: env.PUBLIC_BASE_URL,
      tagKey: brand.advertiser.tag_key,
    })
  );
});

module.exports = { serve, tagJs, frame, resolveServe, IFRAME_SANDBOX };
