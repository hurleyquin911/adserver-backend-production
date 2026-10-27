/**
 * Flag sandbox bersama untuk iframe publisher, iframe creative, preview, dan CSP /creatives/*.
 * Tanpa allow-same-origin (origin buram) dan tanpa allow-top-navigation.
 * allow-popups + allow-popups-to-escape-sandbox: window.open(clickTag) dan <a target="_blank">.
 */
const IFRAME_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

/**
 * CSP pada aset /creatives/*: sandbox membatasi JS creative di origin buram.
 * Jangan set frame-ancestors di sini - parent-nya iframe /ad/frame yang juga
 * tanpa allow-same-origin (origin opaque/`null`), dan `frame-ancestors *`
 * tidak mencocokkan opaque origin → Chrome memblokir embed.
 */
const CREATIVE_CSP = `sandbox ${IFRAME_SANDBOX}`;

/** Siapa boleh menanam /ad/* (tag/frame). `*` saja ditolak Chrome untuk skema http: di beberapa kasus. */
const EMBED_CSP = 'frame-ancestors * http: https:';

module.exports = { IFRAME_SANDBOX, CREATIVE_CSP, EMBED_CSP };
