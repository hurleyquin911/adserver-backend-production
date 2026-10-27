(function (global) {
  'use strict';

  function post(trackUrl, token, type, interactionName) {
    var payload = JSON.stringify({
      t: token,
      type: type,
      interaction_name: interactionName || null,
      device_type: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    });
    // Jangan sendBeacon: mode credentials-nya "include", gagal CORS dari iframe sandbox (origin null).
    fetch(trackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    }).catch(function () {});
  }

  function init(cfg) {
    if (!cfg || !cfg.token || !cfg.trackUrl) return;
    post(cfg.trackUrl, cfg.token, 'impression');

    var target = document.getElementById('c') || document.body;
    var visibleTimer = null;
    var viewableSent = false;

    if ('IntersectionObserver' in global) {
      var observer = new IntersectionObserver(
        function (entries) {
          var entry = entries[0];
          if (!entry) return;
          if (entry.intersectionRatio >= 0.5) {
            if (!visibleTimer && !viewableSent) {
              visibleTimer = setTimeout(function () {
                if (!viewableSent) {
                  viewableSent = true;
                  post(cfg.trackUrl, cfg.token, 'viewable_impression');
                }
              }, 1000);
            }
          } else if (visibleTimer) {
            clearTimeout(visibleTimer);
            visibleTimer = null;
          }
        },
        { threshold: [0, 0.5, 1] }
      );
      observer.observe(target);
    }

    global.addEventListener('message', function (ev) {
      var data = ev.data;
      if (!data || data.type !== 'adserver:interaction') return;
      post(cfg.trackUrl, cfg.token, 'interaction', data.name || 'interaction');
    });

    if (cfg.clickUrl) {
      global.clickTag = cfg.clickUrl;
      global.openClickTag = function () {
        global.open(cfg.clickUrl, '_blank');
      };
    } else {
      global.clickTag = '';
      global.openClickTag = function () {};
    }
  }

  global.AdServerSDK = { init: init };
})(typeof window !== 'undefined' ? window : this);
