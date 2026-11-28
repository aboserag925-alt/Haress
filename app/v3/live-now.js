(function () {
  'use strict';
  var CHANNEL = 'https://www.youtube.com/@Khaled_Najm';
  var TIKTOK = ''; // optional: set the sheikh's TikTok live link here when known
  var box = document.getElementById('liveNow');
  var body = document.getElementById('liveNowBody');
  if (!box || !body) return;
  var current = '';
  function link(href, text) {
    var a = document.createElement('a');
    a.className = 'outline-action';
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = text;
    return a;
  }
  function render(state, id) {
    var key = state + ':' + (id || '');
    if (key === current) return;
    current = key;
    body.textContent = '';
    if (state === 'live' && /^[A-Za-z0-9_-]{11}$/.test(id || '')) {
      var badge = document.createElement('span');
      badge.className = 'live-badge'; badge.textContent = 'مباشر';
      var stage = document.createElement('button');
      stage.type = 'button'; stage.className = 'live-stage';
      stage.setAttribute('aria-label', 'شاهد البث الآن');
      var img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault_live.jpg';
      img.onerror = function () { img.onerror = null; img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; };
      var play = document.createElement('span');
      play.className = 'live-play'; play.setAttribute('aria-hidden', 'true');
      stage.appendChild(img); stage.appendChild(play);
      function start() {
        var f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&autoplay=1';
        f.title = 'البث المباشر للدكتور خالد الحارس';
        f.allow = 'autoplay; accelerometer; encrypted-media; picture-in-picture; fullscreen';
        f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin';
        stage.replaceWith(f);
        watch.hidden = true;
      }
      stage.addEventListener('click', start);
      var watch = document.createElement('button');
      watch.type = 'button'; watch.className = 'gold-action live-watch'; watch.textContent = 'شاهد البث الآن';
      watch.addEventListener('click', start);
      body.appendChild(badge); body.appendChild(stage); body.appendChild(watch);
      body.appendChild(link('https://www.youtube.com/watch?v=' + id, 'افتح على يوتيوب'));
      box.hidden = false;
      return;
    }
    var q = document.createElement('p');
    q.className = 'status'; q.setAttribute('role', 'status');
    q.textContent = state === 'offline' ? 'لا يوجد بث مباشر على يوتيوب الآن.' : 'تعذر التأكد من حالة البث الآن.';
    body.appendChild(q);
    if (TIKTOK) body.appendChild(link(TIKTOK, 'بث مباشر الآن على تيك توك'));
    body.appendChild(link(CHANNEL, 'قناة الدكتور خالد على يوتيوب'));
    // Show the card only when it has a live link-out; otherwise stay hidden when simply offline.
    box.hidden = !(TIKTOK || state === 'unknown') && state === 'offline';
  }
  function poll() {
    fetch('/api/live-status', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { state: 'unknown' }; })
      .then(function (d) { render(d.state, d.videoId); })
      .catch(function () { render('unknown'); });
  }
  poll();
  setInterval(function () { if (!document.hidden) poll(); }, 60000);
})();
