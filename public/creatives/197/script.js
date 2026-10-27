/* Gudang Murah - Rich Media Banner 320x50 (flash sale)
 *
 * Integrasi dengan ad server:
 *  - clickTag  : dibaca dari query string (?clickTag=...) atau window.clickTag.
 *  - interaksi : postMessage({ type: 'adserver:interaction', name: '...' }) ke halaman induk.
 *
 * Nama interaksi: ingatkan_aktif, ingatkan_batal (tombol lonceng).
 * Hitung mundur menuju pukul 23:59:59 waktu perangkat pengguna.
 */
(function () {
  'use strict';

  var hh = document.getElementById('hh');
  var mm = document.getElementById('mm');
  var ss = document.getElementById('ss');
  var note = document.getElementById('note');
  var bell = document.getElementById('bell');
  var cta = document.getElementById('cta');

  var DEFAULT_NOTE = 'diskon sampai 70%';
  var ACTIVE_NOTE = 'oke, kami ingatkan!';
  var MAX_BELL_EVENTS = 6;

  var bellEvents = 0;
  var noteTimer = null;

  function getClickTag() {
    var url = '';
    try {
      var params = new URLSearchParams(window.location.search);
      var keys = ['clickTag', 'clicktag', 'clickTAG', 'click_tag'];
      for (var i = 0; i < keys.length && !url; i++) url = params.get(keys[i]) || '';
    } catch (e) { /* abaikan */ }
    if (!url) url = window.clickTag || window.clickTAG || '';
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function track(name) {
    try {
      window.parent.postMessage({ type: 'adserver:interaction', name: name }, '*');
    } catch (e) { /* abaikan */ }
  }

  function two(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var now = new Date();
    var end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    var left = Math.max(0, Math.floor((end - now) / 1000));
    hh.textContent = two(Math.floor(left / 3600));
    mm.textContent = two(Math.floor((left % 3600) / 60));
    ss.textContent = two(left % 60);
  }

  bell.addEventListener('click', function () {
    var on = bell.getAttribute('aria-pressed') !== 'true';
    bell.setAttribute('aria-pressed', on ? 'true' : 'false');
    bell.setAttribute('aria-label', on ? 'Batalkan pengingat' : 'Ingatkan saya');

    if (noteTimer) clearTimeout(noteTimer);
    if (on) {
      note.textContent = ACTIVE_NOTE;
      noteTimer = setTimeout(function () { note.textContent = DEFAULT_NOTE; }, 2500);
    } else {
      note.textContent = DEFAULT_NOTE;
    }

    if (bellEvents < MAX_BELL_EVENTS) {
      bellEvents++;
      track(on ? 'ingatkan_aktif' : 'ingatkan_batal');
    }
  });

  cta.addEventListener('click', function () {
    var url = getClickTag();
    if (!url) {
      if (window.console && console.info) {
        console.info('[RMB] clickTag tidak ditemukan. Untuk uji mandiri buka index.html?clickTag=https://example.com');
      }
      return;
    }
    window.open(url, '_blank', 'noopener');
  });

  tick();
  setInterval(tick, 1000);
})();
