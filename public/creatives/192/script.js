/* Pasar Kilat - Rich Media Banner 300x250 (kartu gosok)
 *
 * Integrasi dengan ad server:
 *  - clickTag  : dibaca dari query string (?clickTag=...) atau window.clickTag.
 *                Tombol CTA membuka URL ini di tab baru.
 *  - interaksi : dikirim ke halaman induk (SDK) lewat
 *                postMessage({ type: 'adserver:interaction', name: '...' }).
 *
 * Nama interaksi: scratch_start, scratch_reveal, reveal_tap, replay.
 */
(function () {
  'use strict';

  var card = document.getElementById('card');
  var canvas = document.getElementById('foil');
  var ctx = canvas.getContext('2d');
  var burst = document.getElementById('burst');
  var replayBtn = document.getElementById('replay');
  var revealBtn = document.getElementById('revealBtn');
  var cta = document.getElementById('cta');

  var W = 268;               // ukuran kartu (px CSS)
  var H = 100;
  var BRUSH = 15;            // jari-jari kuas gosok
  var THRESHOLD = 0.5;       // bagian yang harus terbuka agar otomatis terbuka penuh
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var drawing = false;
  var last = null;
  var started = false;
  var revealed = false;
  var lastCheck = 0;

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);

  /* ---------- clickTag ---------- */
  function getClickTag() {
    var url = '';
    try {
      var params = new URLSearchParams(window.location.search);
      var keys = ['clickTag', 'clicktag', 'clickTAG', 'click_tag'];
      for (var i = 0; i < keys.length && !url; i++) {
        url = params.get(keys[i]) || '';
      }
    } catch (e) { /* abaikan */ }
    if (!url) url = window.clickTag || window.clickTAG || '';
    return /^https?:\/\//i.test(url) ? url : '';
  }

  /* ---------- Kirim interaksi ke SDK ad server ---------- */
  function track(name) {
    try {
      window.parent.postMessage({ type: 'adserver:interaction', name: name }, '*');
    } catch (e) { /* abaikan */ }
  }

  /* ---------- Lapisan foil ---------- */
  function paintFoil() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#d8d0ea');
    g.addColorStop(0.3, '#ffffff');
    g.addColorStop(0.55, '#b7a8d8');
    g.addColorStop(0.8, '#f0ebfa');
    g.addColorStop(1, '#a89ac8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(67, 23, 122, .10)';
    ctx.lineWidth = 1;
    for (var x = -H; x < W; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(43, 22, 80, .8)';
    ctx.font = '900 21px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Gosok di sini', W / 2, H / 2 - 6);
    ctx.fillStyle = 'rgba(43, 22, 80, .6)';
    ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
    ctx.fillText('geser jari atau kursor', W / 2, H / 2 + 16);
  }

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height)
    };
  }

  function scratch(a, b) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = BRUSH * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, BRUSH, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Hitung bagian foil yang sudah terbuka (pengambilan sampel per grid) */
  function coverage() {
    var data;
    try {
      data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (e) {
      return 0;
    }
    var step = Math.max(2, Math.round(6 * dpr));
    var total = 0;
    var cleared = 0;
    for (var y = 0; y < canvas.height; y += step) {
      for (var x = 0; x < canvas.width; x += step) {
        total++;
        if (data[(y * canvas.width + x) * 4 + 3] < 128) cleared++;
      }
    }
    return total ? cleared / total : 0;
  }

  function check(force) {
    var now = Date.now();
    if (!force && now - lastCheck < 120) return;
    lastCheck = now;
    if (coverage() >= THRESHOLD) reveal(false);
  }

  /* ---------- Buka voucher ---------- */
  function confetti() {
    var colors = ['#d8f25a', '#ff3d8b', '#ffffff'];
    burst.textContent = '';
    for (var i = 0; i < 18; i++) {
      var p = document.createElement('i');
      var angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
      var dist = 50 + Math.random() * 60;
      p.style.setProperty('--x', Math.round(Math.cos(angle) * dist) + 'px');
      p.style.setProperty('--y', Math.round(Math.sin(angle) * dist * 0.8) + 'px');
      p.style.setProperty('--r', Math.round(Math.random() * 540 - 270) + 'deg');
      p.style.setProperty('--c', colors[i % colors.length]);
      burst.appendChild(p);
    }
    setTimeout(function () { burst.textContent = ''; }, 1100);
  }

  function reveal(viaButton) {
    if (revealed) return;
    revealed = true;
    drawing = false;

    card.classList.remove('hint');
    card.classList.add('is-revealed');
    cta.textContent = 'Klaim voucher';
    revealBtn.hidden = true;
    replayBtn.hidden = false;

    if (!reduceMotion) confetti();
    track(viaButton ? 'reveal_tap' : 'scratch_reveal');
  }

  function reset() {
    revealed = false;
    started = false;
    drawing = false;
    last = null;

    paintFoil();
    card.classList.remove('is-revealed');
    card.classList.add('hint');
    cta.textContent = 'Belanja sekarang';
    revealBtn.hidden = false;
    replayBtn.hidden = true;
    burst.textContent = '';
  }

  /* ---------- Gosok (mouse, sentuh, pena) ---------- */
  canvas.addEventListener('pointerdown', function (e) {
    if (revealed) return;
    drawing = true;
    last = pos(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }

    if (!started) {
      started = true;
      card.classList.remove('hint');
      track('scratch_start');
    }
    scratch(last, last);
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!drawing || revealed) return;
    var p = pos(e);
    scratch(last, p);
    last = p;
    check(false);
  });

  function stopDrawing() {
    if (!drawing) return;
    drawing = false;
    if (!revealed) check(true);
  }
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);

  /* ---------- Tombol ---------- */
  revealBtn.addEventListener('click', function () { reveal(true); });

  replayBtn.addEventListener('click', function () {
    reset();
    track('replay');
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

  paintFoil();
})();
