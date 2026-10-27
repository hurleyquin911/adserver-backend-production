/* Neodeeps - Rich Media Banner 970x250
 *
 * Klik:
 *  - Tombol "Jelajahi di neodeeps.com" dan semua kartu membuka satu URL.
 *  - Saat ditayangkan lewat ad server, URL berasal dari clickTag (query string
 *    ?clickTag=... atau window.clickTag) sehingga klik tercatat, lalu server
 *    mengalihkan ke click_url campaign (isi dengan https://neodeeps.com).
 *  - Jika clickTag tidak ada (dibuka mandiri / pratinjau), langsung membuka
 *    DEFAULT_URL di bawah.
 *
 * Interaksi (postMessage ke halaman induk): minat_teknologi, minat_desain,
 *   minat_musik, minat_olahraga, minat_kuliner (maksimal 8 per tampilan).
 */
(function () {
  'use strict';

  var DEFAULT_URL = 'https://neodeeps.com';
  var MAX_EVENTS = 8;

  var KEYS = ['teknologi', 'desain', 'musik', 'olahraga', 'kuliner'];

  /* Contoh acara untuk ilustrasi. d = berapa hari dari hari ini. */
  var DATA = {
    teknologi: [
      { t: 'Meetup Frontend Jakarta', p: 'Jakarta Selatan', d: 5 },
      { t: 'Belajar AI untuk Pemula', p: 'Online', d: 9 },
      { t: 'Hackathon Kampus', p: 'Bandung', d: 14 }
    ],
    desain: [
      { t: 'Workshop Branding UMKM', p: 'Yogyakarta', d: 4 },
      { t: 'Pameran Poster Kota', p: 'Jakarta Pusat', d: 8 },
      { t: 'Figma Santai Malam', p: 'Online', d: 12 }
    ],
    musik: [
      { t: 'Open Mic Akustik', p: 'Bandung', d: 3 },
      { t: 'Jam Session Jazz', p: 'Jakarta Selatan', d: 7 },
      { t: 'Konser Komunitas Indie', p: 'Surabaya', d: 15 }
    ],
    olahraga: [
      { t: 'Lari Pagi Bareng', p: 'Jakarta Pusat', d: 2 },
      { t: 'Futsal Antar Komunitas', p: 'Depok', d: 6 },
      { t: 'Gowes Akhir Pekan', p: 'Bogor', d: 10 }
    ],
    kuliner: [
      { t: 'Festival Jajanan Pasar', p: 'Jakarta Barat', d: 6 },
      { t: 'Kelas Masak Nusantara', p: 'Yogyakarta', d: 11 },
      { t: 'Bazar Kopi Lokal', p: 'Malang', d: 13 }
    ]
  };

  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var cardsEl = document.getElementById('cards');
  var cta = document.getElementById('cta');

  var current = '';
  var sent = 0;
  var autoTimer = null;

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
    if (sent >= MAX_EVENTS) return;
    sent++;
    try {
      window.parent.postMessage({ type: 'adserver:interaction', name: name }, '*');
    } catch (e) { /* abaikan */ }
  }

  function openSite() {
    window.open(getClickTag() || DEFAULT_URL, '_blank', 'noopener');
  }

  function dateParts(offset) {
    var dt = new Date();
    dt.setDate(dt.getDate() + offset);
    var month = '';
    try {
      month = dt.toLocaleDateString('id-ID', { month: 'short' });
    } catch (e) {
      month = String(dt.getMonth() + 1);
    }
    return { day: dt.getDate(), month: month };
  }

  function render(minat) {
    cardsEl.textContent = '';
    DATA[minat].forEach(function (ev, i) {
      var parts = dateParts(ev.d);

      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.style.setProperty('--i', i);

      var date = document.createElement('div');
      date.className = 'date';
      var day = document.createElement('b');
      day.textContent = parts.day;
      var month = document.createElement('span');
      month.textContent = parts.month;
      date.appendChild(day);
      date.appendChild(month);

      var info = document.createElement('div');
      var title = document.createElement('h3');
      title.textContent = ev.t;
      var place = document.createElement('p');
      place.textContent = ev.p;
      info.appendChild(title);
      info.appendChild(place);

      card.appendChild(date);
      card.appendChild(info);
      cardsEl.appendChild(card);
    });
  }

  function select(minat, fromUser) {
    if (minat === current || !DATA[minat]) return;
    current = minat;

    chips.forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.getAttribute('data-minat') === minat ? 'true' : 'false');
    });
    render(minat);

    if (fromUser) track('minat_' + minat);
  }

  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function startAuto() {
    if (reduceMotion) return;
    autoTimer = setInterval(function () {
      var next = (KEYS.indexOf(current) + 1) % KEYS.length;
      select(KEYS[next], false);
    }, 3500);
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      stopAuto();
      select(chip.getAttribute('data-minat'), true);
    });
  });

  cardsEl.addEventListener('click', function (ev) {
    if (ev.target.closest('.card')) openSite();
  });

  cta.addEventListener('click', openSite);

  document.getElementById('banner').addEventListener('pointerdown', stopAuto);

  select('teknologi', false);
  startAuto();
})();
