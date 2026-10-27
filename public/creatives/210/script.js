/* SMA Cendekia Nusa - Rich Media Banner 728x90 (sekolah)
 *
 * Integrasi dengan ad server:
 *  - clickTag  : dibaca dari query string (?clickTag=...) atau window.clickTag.
 *  - interaksi : postMessage({ type: 'adserver:interaction', name: '...' }) ke halaman induk.
 *
 * Nama interaksi: kuis_benar, kuis_salah, kuis_ulang (gabungan maksimal 8 per tampilan).
 */
(function () {
  'use strict';

  var MAX_EVENTS = 8;

  var banner = document.getElementById('banner');
  var quiz = document.getElementById('quiz');
  var questionEl = document.getElementById('question');
  var answersEl = document.getElementById('answers');
  var feedback = document.getElementById('feedback');
  var cta = document.getElementById('cta');
  var again = document.getElementById('again');

  var DEFAULT_FEEDBACK = 'Jawab benar, dapat potongan biaya pendaftaran.';

  var correct = 0;
  var solved = false;
  var sent = 0;

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

  function rnd(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function setFeedback(text, kind) {
    feedback.textContent = text;
    feedback.className = 'feedback' + (kind ? ' ' + kind : '');
  }

  function newQuestion() {
    var a = rnd(6, 9);
    var b = rnd(6, 9);
    correct = a * b;
    solved = false;

    var options = [correct, correct + a, correct - b];
    for (var i = options.length - 1; i > 0; i--) {
      var j = rnd(0, i);
      var tmp = options[i];
      options[i] = options[j];
      options[j] = tmp;
    }

    questionEl.textContent = a + ' × ' + b + ' = ?';
    answersEl.textContent = '';
    options.forEach(function (value) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ans';
      btn.textContent = String(value);
      btn.setAttribute('data-value', String(value));
      btn.setAttribute('aria-label', 'Jawaban ' + value);
      answersEl.appendChild(btn);
    });

    banner.classList.remove('is-won');
    cta.textContent = 'Daftar sekarang';
    again.hidden = true;
    setFeedback(DEFAULT_FEEDBACK, '');
  }

  answersEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.ans');
    if (!btn || solved || btn.disabled) return;

    var value = parseInt(btn.getAttribute('data-value'), 10);

    if (value === correct) {
      solved = true;
      btn.classList.add('is-right');
      Array.prototype.forEach.call(answersEl.children, function (b) { b.disabled = true; });
      banner.classList.add('is-won');
      cta.textContent = 'Klaim potongan';
      again.hidden = false;
      setFeedback('Benar! Kamu dapat potongan biaya pendaftaran.', 'ok');
      track('kuis_benar');
    } else {
      btn.classList.add('is-wrong');
      btn.disabled = true;
      setFeedback('Belum tepat, coba lagi.', 'no');
      quiz.classList.remove('shake');
      void quiz.offsetWidth;
      quiz.classList.add('shake');
      track('kuis_salah');
    }
  });

  again.addEventListener('click', function () {
    newQuestion();
    track('kuis_ulang');
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

  newQuestion();
})();
