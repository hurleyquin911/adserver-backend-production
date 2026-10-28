const { IFRAME_SANDBOX } = require('../constant/headers');
const { sizeKey } = require('./slotSize');

/**
 * Katalog macro third-party display per platform.
 * clickEnc = untuk param URL (?click=…); click = unescaped (prepend destination).
 * preferEncoded: true → pakai clickEnc di query tag (paling aman untuk script src).
 */
const MACRO_SETS = {
  dv360: {
    id: 'dv360',
    label: 'Display & Video 360 (Google)',
    group: 'Google',
    cachebuster: '${CACHEBUSTER}',
    click: '${CLICK_URL}',
    clickEnc: '${CLICK_URL_ENC}',
    clickEncEnc: '${CLICK_URL_ENC_ENC}',
    preferEncoded: true,
    notes: 'Macro resmi DV360 untuk third-party display tag.',
  },
  gam: {
    id: 'gam',
    label: 'Google Ad Manager / CM360',
    group: 'Google',
    cachebuster: '%%CACHEBUSTER%%',
    click: '%%CLICK_URL_UNESC%%',
    clickEnc: '%%CLICK_URL_ESC%%',
    clickEncEnc: '%%CLICK_URL_ESC_ESC%%',
    preferEncoded: true,
    notes: 'Standar Google Ad Manager & Campaign Manager 360.',
  },
  xandr: {
    id: 'xandr',
    label: 'Xandr / Microsoft Invest',
    group: 'Microsoft',
    cachebuster: '${CACHEBUSTER}',
    click: '${CLICK_URL}',
    clickEnc: '${CLICK_URL_ENC}',
    preferEncoded: true,
    notes: 'Sama sintaks ${…} seperti DV360; dokumentasi Xandr memakai pubclick/click.',
  },
  adobe: {
    id: 'adobe',
    label: 'Adobe Advertising Cloud',
    group: 'Adobe',
    cachebuster: '${CACHEBUSTER}',
    click: '${TM_CLICK_URL}',
    clickEnc: '${TM_CLICK_URL_URLENC}',
    preferEncoded: true,
    notes: 'Macro klik Adobe: TM_CLICK_URL / TM_CLICK_URL_URLENC.',
  },
  freewheel: {
    id: 'freewheel',
    label: 'FreeWheel Buyer Cloud',
    group: 'FreeWheel',
    cachebuster: '{{CACHEBUSTER}}',
    click: '{{CLICK_URL}}',
    clickEnc: '{{CLICK_URL_ESC}}',
    preferEncoded: true,
    notes: 'Macro {{CLICK_URL}} / {{CLICK_URL_ESC}} (Buyer Cloud).',
  },
  ttd: {
    id: 'ttd',
    label: 'The Trade Desk',
    group: 'The Trade Desk',
    cachebuster: '%%TTD_CACHEBUSTER%%',
    click: '%%TTD_CLK%%',
    clickEnc: '%%TTD_CLK_ESC%%',
    preferEncoded: true,
    notes: 'Macro TTD untuk tracking klik & cache bust.',
  },
  amazon: {
    id: 'amazon',
    label: 'Amazon DSP',
    group: 'Amazon',
    cachebuster: '%%CACHEBUSTER%%',
    click: '%%CLICK_URL_UNESC%%',
    clickEnc: '%%CLICK_URL%%',
    preferEncoded: true,
    notes: 'Amazon DSP third-party / tracking style macros.',
  },
  yahoo: {
    id: 'yahoo',
    label: 'Yahoo DSP',
    group: 'Yahoo',
    cachebuster: '%%CACHEBUSTER%%',
    click: '%%CLICK_URL_UNESC%%',
    clickEnc: '%%CLICK_URL%%',
    preferEncoded: true,
    notes: 'Yahoo DSP — pola mirip GAM/%%…%%.',
  },
  stackadapt: {
    id: 'stackadapt',
    label: 'StackAdapt',
    group: 'Lainnya',
    cachebuster: '{{CACHEBUSTER}}',
    click: '{{CLICK_URL}}',
    clickEnc: '{{CLICK_URL_ENC}}',
    preferEncoded: true,
    notes: 'StackAdapt third-party tag macros.',
  },
  mediamath: {
    id: 'mediamath',
    label: 'MediaMath',
    group: 'Lainnya',
    cachebuster: '[RANDOM_NUMBER]',
    click: '[CLICK_URL]',
    clickEnc: '[CLICK_URL_ENC]',
    preferEncoded: true,
    notes: 'Placeholder klasik MediaMath / beberapa ad server legacy.',
  },
  invibes: {
    id: 'invibes',
    label: 'Generic ${…} (SSP umum)',
    group: 'Generic',
    cachebuster: '${CACHEBUSTER}',
    click: '${CLICK_URL}',
    clickEnc: '${CLICK_URL_ENC}',
    preferEncoded: true,
    notes: 'Fallback untuk SSP/DSP yang memakai sintaks ${CACHEBUSTER} / ${CLICK_URL}.',
  },
  generic_pct: {
    id: 'generic_pct',
    label: 'Generic %%…%% (SSP umum)',
    group: 'Generic',
    cachebuster: '%%CACHEBUSTER%%',
    click: '%%CLICK_URL_UNESC%%',
    clickEnc: '%%CLICK_URL_ESC%%',
    preferEncoded: true,
    notes: 'Fallback untuk platform yang memakai sintaks Google-style %%…%%.',
  },
  generic_bracket: {
    id: 'generic_bracket',
    label: 'Generic [PLACEHOLDER]',
    group: 'Generic',
    cachebuster: '[CACHEBUSTER]',
    click: '[CLICK_URL]',
    clickEnc: '[CLICK_URL_ESC]',
    preferEncoded: true,
    notes: 'Untuk ad server yang meminta placeholder dalam kurung siku.',
  },
  generic_brace: {
    id: 'generic_brace',
    label: 'Generic {CACHEBUSTER}',
    group: 'Generic',
    cachebuster: '{CACHEBUSTER}',
    click: '{CLICK_URL}',
    clickEnc: '{CLICK_URL_ESC}',
    preferEncoded: true,
    notes: 'Varian kurung kurawal tunggal (beberapa SSP Eropa / legacy).',
  },
};

const MACRO_ORDER = [
  'dv360',
  'gam',
  'xandr',
  'adobe',
  'ttd',
  'amazon',
  'yahoo',
  'freewheel',
  'stackadapt',
  'mediamath',
  'invibes',
  'generic_pct',
  'generic_bracket',
  'generic_brace',
];

function listMacroSets() {
  return MACRO_ORDER.map((id) => MACRO_SETS[id]).filter(Boolean);
}

function getMacroSet(id) {
  const key = String(id || 'dv360').toLowerCase();
  return MACRO_SETS[key] || MACRO_SETS.dv360;
}

function parseSz(raw) {
  const m = String(raw || '')
    .trim()
    .toLowerCase()
    .match(/^(\d{1,4})x(\d{1,4})$/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return null;
  return { width, height, key: sizeKey(width, height) };
}

/** Ambil cachebuster dari query DSP (ord / cb / cachebuster). */
function cachebusterFromQuery(query) {
  const raw = query.ord ?? query.cb ?? query.cachebuster ?? query.cacheBuster ?? query.random;
  if (raw == null || raw === '') return String(Date.now());
  return String(raw).slice(0, 128);
}

const UNEXPANDED_MACRO =
  /\$\{[A-Z0-9_]+\}|%%[A-Z0-9_]+%%|\{\{[A-Z0-9_]+\}\}|\{[A-Z0-9_]+\}|\[[A-Z0-9_]+\]/i;

/**
 * Click tracker dari DSP. Express sudah sekali-decode query.
 * Nilai kosong / macro mentah yang belum di-expand → diabaikan.
 */
function dspClickFromQuery(query) {
  const raw =
    query.click ??
    query.clickurl ??
    query.click_url ??
    query.pubclick ??
    query.nurl ??
    query.redirect;
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (UNEXPANDED_MACRO.test(s)) return null;
  if (s.length > 4000) s = s.slice(0, 4000);
  return s;
}

/**
 * Rantai klik standar industri: DSP_CLICK + thirdPartyClickUrl
 */
function applyDspClickPrefix(dspClick, destination) {
  if (!dspClick || !destination) return destination || '';
  return String(dspClick) + String(destination);
}

function pickClickMacro(macros, useEncodedClick) {
  if (useEncodedClick) {
    return macros.clickEnc || macros.click;
  }
  return macros.click || macros.clickEnc;
}

function buildDspScriptSrc(base, { tagKey, width, height, macros, creativeId, useEncodedClick }) {
  const sz = sizeKey(width, height);
  const encoded =
    useEncodedClick != null ? useEncodedClick : macros.preferEncoded !== false;
  const clickMacro = pickClickMacro(macros, encoded);
  return (
    `${base}/ad/tag.js?a=${encodeURIComponent(tagKey)}` +
    `&sz=${sz}` +
    (creativeId != null ? `&cid=${encodeURIComponent(creativeId)}` : '') +
    `&ord=${macros.cachebuster}` +
    `&click=${clickMacro}`
  );
}

function buildDspFrameSrc(base, { tagKey, width, height, macros, creativeId, useEncodedClick }) {
  const sz = sizeKey(width, height);
  const encoded =
    useEncodedClick != null ? useEncodedClick : macros.preferEncoded !== false;
  const clickMacro = pickClickMacro(macros, encoded);
  return (
    `${base}/ad/frame?a=${encodeURIComponent(tagKey)}` +
    `&sz=${sz}` +
    (creativeId != null ? `&cid=${encodeURIComponent(creativeId)}` : '') +
    `&ord=${macros.cachebuster}` +
    `&click=${clickMacro}`
  );
}

function buildDspSnippets(base, tagKey, width, height, macroSet = MACRO_SETS.dv360, creativeId = null) {
  const set = typeof macroSet === 'string' ? getMacroSet(macroSet) : macroSet;
  const sz = sizeKey(width, height);
  const scriptSrc = buildDspScriptSrc(base, {
    tagKey,
    width,
    height,
    macros: set,
    creativeId,
  });
  const frameSrc = buildDspFrameSrc(base, {
    tagKey,
    width,
    height,
    macros: set,
    creativeId,
  });

  const script = `<script type="text/javascript" src="${scriptSrc}"></script>`;

  const iframe =
    `<iframe src="${frameSrc}" width="${width}" height="${height}" ` +
    `frameborder="0" marginwidth="0" marginheight="0" scrolling="no" ` +
    `style="border:0;vertical-align:bottom;width:${width}px;height:${height}px" ` +
    `sandbox="${IFRAME_SANDBOX}" referrerpolicy="origin"></iframe>`;

  const html =
    `<div id="ad-${sz}" style="width:${width}px;height:${height}px;overflow:hidden;margin:0;padding:0">\n` +
    `  ${script}\n` +
    `</div>`;

  return {
    size: sz,
    width,
    height,
    macro_set: set.id,
    script,
    iframe,
    html,
    script_src: scriptSrc,
    frame_src: frameSrc,
  };
}

function serializeMacroSet(m) {
  return {
    id: m.id,
    label: m.label,
    group: m.group || 'Lainnya',
    cachebuster: m.cachebuster,
    click: m.click,
    click_enc: m.clickEnc,
    click_enc_enc: m.clickEncEnc || null,
    prefer_encoded: m.preferEncoded !== false,
    notes: m.notes || null,
  };
}

module.exports = {
  MACRO_SETS,
  MACRO_ORDER,
  listMacroSets,
  getMacroSet,
  serializeMacroSet,
  parseSz,
  cachebusterFromQuery,
  dspClickFromQuery,
  applyDspClickPrefix,
  buildDspSnippets,
  buildDspScriptSrc,
  buildDspFrameSrc,
};
