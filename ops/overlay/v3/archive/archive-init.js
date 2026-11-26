(function () {
  'use strict';
  var host = document.getElementById('haressVideoPlayer');
  if (host && window.HaressPlayer && window.HaressVideoLive) {
    var ctl = window.HaressPlayer.createController(host, window.HaressVideoLive.urls);
    window.HaressIntegratedVideo = { open: function (v) { host.hidden = false; ctl.open(v); } };
  }
  var loaded = false;
  window.addEventListener('haress-v3:navigate', function (e) {
    if ((e.detail === 'archive' || e.detail === 'rebuttals') && !loaded && window.HaressV3Archive) { loaded = true; window.HaressV3Archive.load(); }
  });
})();
