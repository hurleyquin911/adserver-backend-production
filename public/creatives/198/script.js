/* Pesiar - Rich Media Banner 300x600 (kuis liburan)
 *
 * Integrasi dengan ad server:
 *  - clickTag  : dibaca dari query string (?clickTag=...) atau window.clickTag.
 *  - interaksi : postMessage({ type: 'adserver:interaction', name: '...' }) ke halaman induk.
 *
 * Nama interaksi: kuis_suasana_pantai | kuis_suasana_gunung | kuis_suasana_kota,
 *                 kuis_durasi_3 | kuis_durasi_5 | kuis_durasi_7,
 *                 kuis_selesai, kuis_ulang.
 */
(function () {
  'use strict';

  var HASIL = {
    pantai: { tujuan: 'Labuan Bajo',      teks: 'Snorkeling, pulau-pulau kecil, dan senja di dermaga.' },
    gunung: { tujuan: 'Bromo dan Malang',  teks: 'Matahari terbit di atas lautan pasir dan udara yang sejuk.' },
    kota:   { tujuan: 'Yogyakarta',        teks: 'Candi, kuliner malam, dan pasar yang ramai sampai larut.' }
  };
  var DURASI = { 3: '3 hari 2 malam', 5: '5 hari 4 malam', 7: '7 hari 6 malam' };

  var steps = [
    document.getElementById('step1'),
    document.getElementById('step2'),
    document.getElementById('step3')
  ];
  var dots = Array.prototype.slice.call(document.querySelectorAll('#dots li'));
  var titleEl = document.getElementById('title');
  var subEl = document.getElementById('sub');
  var artEl = document.getElementById('art');
  var recTitle = document.getElementById('recTitle');
  var recDur = document.getElementById('recDur');
  var recText = document.getElementById('recText');
  var cta = document.getElementById('cta');

  var suasana = '';
  var current = 0;

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

  function go(index) {
    current = index;
    steps.forEach(function (el, i) {
      el.classList.toggle('is-active', i === index);
    });
    dots.forEach(function (d, i) {
      d.classList.toggle('on', i === index);
    });

    if (index === 2) {
      titleEl.textContent = 'Cocok untukmu!';
      subEl.textContent = 'Berdasarkan pilihanmu tadi.';
    } else {
      titleEl.textContent = 'Liburan tipe apa kamu?';
      subEl.textContent = 'Jawab dua pertanyaan, kami carikan tujuannya.';
    }

    var first = steps[index].querySelector('button');
    if (first) {
      try { first.focus({ preventScroll: true }); } catch (e) { /* abaikan */ }
    }
  }

  document.getElementById('banner').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;

    var s = btn.getAttribute('data-suasana');
    var h = btn.getAttribute('data-hari');

    if (s && HASIL[s]) {
      suasana = s;
      track('kuis_suasana_' + s);
      go(1);
    } else if (h && DURASI[h]) {
      var hasil = HASIL[suasana] || HASIL.pantai;
      artEl.className = 'art art-' + (suasana || 'pantai');
      recTitle.textContent = hasil.tujuan;
      recDur.textContent = DURASI[h];
      recText.textContent = hasil.teks;
      track('kuis_durasi_' + h);
      track('kuis_selesai');
      go(2);
    } else if (btn.id === 'again') {
      suasana = '';
      track('kuis_ulang');
      go(0);
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
})();
