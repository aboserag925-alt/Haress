(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var apiBase = String(window.AHL_API_BASE_URL || '').replace(/\/+$/, '');
  var api = function (path) { return apiBase + path; };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  var state = { location: null, prayerTimes: null, compass: null, period: 'morning',
    media: [], mediaCategory: 'all', libraryPromise: null, archivePromise: null, prayerAudioLoaded: false, turnstileId: null, turnstilePromise: null,
    installPrompt: null, account: null, syncTimer: null, nextPrayer: null,
    nextPrayerName: '', radioTimer: null, radioMuted: false };

  function status(id, message, error) {
    var el = $(id); if (!el) return;
    el.textContent = message; el.classList.toggle('error', !!error);
  }
  function safeStorage() {
    try { return window.localStorage; }
    catch (e) { return null; }
  }
  function readStore(key) {
    var storage = safeStorage();
    if (!storage) return null;
    try { return storage.getItem(key); }
    catch (e) { return null; }
  }
  function store(key, value) {
    var storage = safeStorage();
    if (!storage) return false;
    try { storage.setItem(key, value); return true; }
    catch (e) { status('locationStatus', 'تعذر حفظ الإعدادات على هذا الجهاز.', true); return false; }
  }
  function cairoClock() {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo',
      weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
    }).formatToParts(new Date());
    var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
    return { day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),
      seconds: (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second) };
  }

  /* Schedule: V3 owns its semantic timeline and never creates legacy card/tab/button markup. */
  var schedule = [
    ['السبت','شرح صحيح الإمام مسلم','شرح علم مصطلح الحديث'],
    ['الأحد','مناهج البيان في أصول التفسير وقواعد فهم القرآن','قواعد عقائد أهل السنة والجماعة'],
    ['الإثنين','شرح صحيح الإمام مسلم','شرح علم مصطلح الحديث'],
    ['الثلاثاء','شرح العقيدة الواسطية','أصول الفقه'],
    ['الأربعاء','شرح صحيح الإمام مسلم','شرح علم مصطلح الحديث'],
    ['الخميس','عظماء الإسلام','منوعات ومقتطفات وحوارات']
  ];
  var days = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  function renderSchedule() {
    var host = $('sched'); if (!host) return;
    host.replaceChildren();
    var today = days[cairoClock().day];
    schedule.forEach(function (row) {
      var section = document.createElement('article');
      section.className = 'v3-timeline-entry' + (row[0] === today ? ' is-today' : '');
      var heading = document.createElement('h3'); heading.textContent = row[0] + (row[0] === today ? ' · اليوم' : '');
      var slots = document.createElement('div'); slots.className = 'v3-timeline-slots';
      [[ '٧:٠٠ مساءً', row[1] ], [ '١٠:٠٠ مساءً', row[2] ]].forEach(function (slot) {
        var line = document.createElement('p');
        var time = document.createElement('time'); time.textContent = slot[0];
        var title = document.createElement('span'); title.textContent = slot[1];
        line.append(time, title); slots.appendChild(line);
      });
      section.append(heading, slots); host.appendChild(section);
    });
    var friday = document.createElement('p'); friday.className = 'v3-friday-note';
    friday.textContent = 'الجمعة · لا دروس'; host.appendChild(friday);
  }
  async function loadLectures() {
    var initialHost = $('managedLectures');
    if (initialHost) { initialHost.replaceChildren(); var loading = document.createElement('p'); loading.className = 'status'; loading.textContent = 'جارٍ تحميل المحاضرات…'; initialHost.appendChild(loading); initialHost.hidden = !!($('sched') && $('sched').hidden); }
    try {
      var publishableKey = window.AHL_SUPABASE_CONFIG && window.AHL_SUPABASE_CONFIG.anonKey;
      var response = await fetch(api('/api/lectures'), { headers: publishableKey ? { apikey: publishableKey } : {} });
      if (!response.ok) throw new Error('lecture');
      var result = await response.json();
      var host = $('managedLectures'); if (!host) return;
      host.replaceChildren();
      if (!Array.isArray(result.items) || !result.items.length) {
        var empty = document.createElement('p'); empty.className = 'status'; empty.textContent = 'لا توجد محاضرات منشورة حاليًا.';
        host.appendChild(empty); host.hidden = !!($('sched') && $('sched').hidden); return;
      }
      var cutoff = Date.now() - 6 * 3600 * 1000;
      var upcoming = result.items.filter(function (item) {
        return item.recording_url || !item.starts_at || new Date(item.starts_at).getTime() >= cutoff;
      });
      if (!upcoming.length) {
        var empty = document.createElement('p'); empty.className = 'status'; empty.textContent = 'لا توجد محاضرات قادمة أو تسجيلات منشورة.';
        host.appendChild(empty); host.hidden = !!($('sched') && $('sched').hidden); return;
      }
      upcoming.forEach(function (item) {
        var article = document.createElement('article'); article.className = 'v3-managed-entry';
        var title = document.createElement('h3'); title.textContent = item.title || 'محاضرة';
        var meta = document.createElement('p');
        meta.textContent = (item.starts_at ? new Date(item.starts_at).toLocaleString('ar-EG') : 'موعد يحدد لاحقًا') + ' · ' + (item.category || 'محاضرة');
        article.append(title, meta);
        if (item.description) { var desc = document.createElement('p'); desc.textContent = item.description; article.appendChild(desc); }
        [['stream_url','مشاهدة البث'],['recording_url','مشاهدة التسجيل']].forEach(function (pair) {
          if (!item[pair[0]]) return;
          var link = document.createElement('a'); link.href = item[pair[0]]; link.target = '_blank';
          link.rel = 'noopener noreferrer'; link.textContent = pair[1]; article.appendChild(link);
        });
        host.appendChild(article);
      });
      var schedHost = $('sched');
      host.hidden = !!(schedHost && schedHost.hidden);
    } catch (e) {
      var host = $('managedLectures');
      if (host) { host.replaceChildren(); var error = document.createElement('p'); error.className = 'status error'; error.textContent = 'تعذر تحميل المحاضرات الآن. الجدول الأساسي ما زال متاحًا.'; host.appendChild(error); host.hidden = !!($('sched') && $('sched').hidden); }
    }
  }
  function updateScheduleClock() {
    var now = cairoClock(), slots = [19 * 3600, 22 * 3600], lessonDays = ['السبت','الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس'];
    for (var offset = 0; offset < 8; offset++) {
      var day = (now.day + offset) % 7; if (day === 5) continue;
      for (var i = 0; i < slots.length; i++) {
        var delta = offset * 86400 + slots[i] - now.seconds;
        if (delta <= 0) continue;
        var row = schedule[lessonDays.indexOf(days[day])];
        if ($('nx')) $('nx').textContent = days[day] + ' · ' + (i ? '١٠:٠٠' : '٧:٠٠') + ' مساءً: ' + row[i + 1];
        if ($('nextLessonTitle')) $('nextLessonTitle').textContent = row[i + 1];
        if ($('cd')) $('cd').textContent = [Math.floor(delta / 3600), Math.floor(delta % 3600 / 60), delta % 60]
          .map(function (n) { return String(n).padStart(2, '0'); }).join(':');
        return;
      }
    }
  }

  function loadPrayerAudio() {
    var audio = $('adhanAudio');
    if (!audio || state.prayerAudioLoaded) return;
    var source = readStore('ahl-athar-adhan-url');
    if (source) { audio.src = source; audio.hidden = false; audio.load(); state.prayerAudioLoaded = true; }
  }
  function activateMediaSources() {
    var host = $('mediaItems'); if (!host) return;
    host.querySelectorAll('audio[data-src],video[data-src]').forEach(function (player) {
      if (!player.src) { player.src = player.getAttribute('data-src'); player.removeAttribute('data-src'); player.load(); }
    });
  }
  function loadArchiveAssets() {
    if (state.archivePromise) return state.archivePromise;
    state.archivePromise = (async function () {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/v3/archive/archive.css?v=20261128';
      await new Promise(function (resolve) { css.onload = resolve; css.onerror = resolve; document.head.appendChild(css); });
      var files = ['/v3/archive/youtube.js?v=20261128','/v3/archive/source-links.js?v=20261128',
        '/v3/archive/video-live/model.js?v=20261128','/v3/archive/video-live/player.js?v=20261128',
        '/v3/archive/v3-archive.js?v=20261128','/v3/archive/archive-init.js?v=20261128'];
      for (var i = 0; i < files.length; i++) {
        await new Promise(function (resolve, reject) {
          var script = document.createElement('script'); script.src = files[i]; script.async = false;
          script.onload = resolve; script.onerror = function () { reject(new Error('archive asset failed')); };
          document.head.appendChild(script);
        });
      }
      if (window.HaressV3Archive) window.HaressV3Archive.load();
    })().catch(function () {
      status('archiveStatus','تعذر تحميل ملفات الأرشيف. حاول فتح القسم مرة أخرى.',true);
      state.archivePromise = null;
    });
    return state.archivePromise;
  }
  function navigate(id) {
    var ids = ['sched','prayers','qibla','adhkar','media','archive','q','about','account'];
    if (ids.indexOf(id) < 0) return;
    ids.forEach(function (key) { var el = $(key); if (el) el.hidden = key !== id; });
    var scheduleView = id === 'sched';
    document.querySelectorAll('.side-nav .nav-item[data-v3-target]').forEach(function (button) {
      var active = button.getAttribute('data-v3-target') === id;
      button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
    });
    var heading = document.querySelector('.section-heading'), next = document.querySelector('.next');
    var managed = $('managedLectures');
    if (managed) managed.hidden = !scheduleView || !managed.childElementCount;
    if (heading) heading.hidden = !scheduleView;
    if (next) next.hidden = !scheduleView;
    var target = $(id);
    if (target) {
      target.setAttribute('tabindex','-1');
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    }
    if (id === 'media') loadLibrary().then(activateMediaSources);
    if (id === 'prayers') loadPrayerAudio();
    if (id === 'archive') loadArchiveAssets();
    if (id === 'adhkar') renderAdhkar();
    if (id === 'qibla') updateQibla();
  }
  window.addEventListener('haress-v3:navigate', function (event) { navigate(event.detail); });

  /* Quran radio */
  function initRadio() {
    var button = $('quranRadioButton'), panel = $('quranRadioPanel'), audio = $('quranRadioAudio');
    var station = $('quranRadioStation'), open = $('quranRadioOpen'), mute = $('quranRadioMute');
    if (!button || !panel || !audio || !station) return;
    var cairoStream = 'https://stream.radiojar.com/8s5u5tpdtwzuv';
    function stop() { clearTimeout(state.radioTimer); audio.pause(); audio.removeAttribute('src'); audio.load(); }
    function sync() {
      button.setAttribute('aria-expanded', String(!panel.hidden));
      mute.textContent = audio.muted ? 'إلغاء الكتم' : 'كتم الإذاعة';
      mute.setAttribute('aria-pressed', String(audio.muted));
    }
    function playCairo() {
      stop(); audio.src = cairoStream; audio.volume = 0.06;
      open.href = 'https://misrquran.gov.eg/'; open.textContent = 'الموقع الرسمي لإذاعة القاهرة';
      if (audio.muted) { status('quranRadioStatus','الإذاعة مكتومة. ألغِ الكتم ثم اضغط تشغيل.'); return; }
      var attempt = audio.play();
      if (attempt && attempt.then) attempt.then(function () {
        status('quranRadioStatus','إذاعة القرآن الكريم — القاهرة تعمل بصوت منخفض.');
        state.radioTimer = setTimeout(function () { if (!audio.paused && !audio.muted) audio.volume = 0.16; }, 5000);
      }).catch(function () { status('quranRadioStatus','قد يمنع المتصفح التشغيل التلقائي. اضغط تشغيل من المشغل.'); });
    }
    button.addEventListener('click', function () {
      panel.hidden = !panel.hidden; sync();
      if (!panel.hidden && station.value === 'cairo' && audio.paused) playCairo();
    });
    station.addEventListener('change', function () {
      if (station.value === 'saudi') {
        stop(); open.href = 'https://radioplus.sba.sa/ar/live/4'; open.textContent = 'فتح البث الرسمي السعودي';
        status('quranRadioStatus','البث السعودي الرسمي متاح عبر مشغل الهيئة. افتح الرابط الرسمي.');
      } else playCairo();
    });
    mute.addEventListener('click', function () {
      audio.muted = !audio.muted; sync();
      if (!audio.muted && station.value === 'cairo' && audio.paused) playCairo();
      if (audio.muted) clearTimeout(state.radioTimer);
    });
    audio.addEventListener('error', function () { status('quranRadioStatus','تعذر تحميل بث القاهرة حاليًا. يمكنك فتح الموقع الرسمي.'); });
    sync();
  }

  /* Prayer calculations and Qibla use the existing pinned Adhan browser bundle. */
  var prayerNames = { fajr:'الفجر', sunrise:'الشروق', dhuhr:'الظهر', asr:'العصر', maghrib:'المغرب', isha:'العشاء' };
  var prayerKeys = Object.keys(prayerNames), salatKeys = ['fajr','dhuhr','asr','maghrib','isha'];
  function loadLocation() {
    try {
      var savedLat = readStore('ahl-athar-latitude'), savedLon = readStore('ahl-athar-longitude');
      var lat = Number(savedLat), lon = Number(savedLon);
      if (savedLat !== null && savedLon !== null &&
          Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180) return { latitude:lat, longitude:lon };
    } catch (e) {}
    return null;
  }
  function methodName() {
    var saved = $('calcMethod').value;
    if (saved !== 'auto') return saved;
    if (tz === 'Africa/Cairo') return 'egypt';
    if (/^Asia\/(Riyadh|Makkah|Kuwait|Qatar|Bahrain)$/.test(tz)) return 'umm';
    return 'mwl';
  }
  function prayerParams() {
    var a = window.adhan, methods = { egypt:a.CalculationMethod.Egyptian, umm:a.CalculationMethod.UmmAlQura, mwl:a.CalculationMethod.MuslimWorldLeague };
    var params = (methods[methodName()] || methods.mwl)();
    params.madhab = $('asrMadhab').value === 'hanafi' ? a.Madhab.Hanafi : a.Madhab.Shafi;
    return params;
  }
  function updateLocationStatus(message) {
    status('locationStatus', state.location ? (message || 'الموقع محفوظ محليًا') + ' · ' +
      state.location.latitude.toFixed(4) + ', ' + state.location.longitude.toFixed(4) :
      'لم يُحدَّد الموقع بعد. احفظ موقعًا يدويًا أو اسمح بتحديده تلقائيًا.');
  }
  function computePrayerTimes(date) {
    return new window.adhan.PrayerTimes(new window.adhan.Coordinates(state.location.latitude, state.location.longitude), date, prayerParams());
  }
  function formatPrayerTime(date) {
    return new Intl.DateTimeFormat('ar-EG',{hour:'numeric',minute:'2-digit',timeZone:tz}).format(date);
  }
  function updatePrayerTimes() {
    if ($('timezoneLabel')) $('timezoneLabel').textContent = tz;
    if (!state.location || !window.adhan) { status('prayerDate','حدد موقعك لحساب المواقيت.'); return; }
    try {
      var now = new Date(), times = computePrayerTimes(now);
      $('prayerDate').textContent = new Intl.DateTimeFormat('ar-EG',{dateStyle:'full',timeZone:tz}).format(now) + ' · ' + tz;
      prayerKeys.forEach(function (key) {
        var time = times.timeForPrayer(window.adhan.Prayer[key.charAt(0).toUpperCase()+key.slice(1)]);
        var output = $('time-'+key);
        if (output) output.textContent = time ? formatPrayerTime(time) : 'غير متاح';
        var cell = $('prayer-'+key); if (cell) cell.classList.remove('next-prayer');
      });
      state.nextPrayer = null;
      salatKeys.some(function (key) {
        var candidate = times.timeForPrayer(window.adhan.Prayer[key.charAt(0).toUpperCase()+key.slice(1)]);
        if (candidate && candidate > now) { state.nextPrayer = candidate; state.nextPrayerName = prayerNames[key]; $('prayer-'+key).classList.add('next-prayer'); return true; }
        return false;
      });
      if (!state.nextPrayer) { var tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate()+1); state.nextPrayer = computePrayerTimes(tomorrow).fajr; state.nextPrayerName = 'الفجر'; }
      updatePrayerCountdown();
    } catch (e) { status('locationStatus','تعذر حساب المواقيت. تحقق من الإحداثيات وطريقة الحساب.',true); }
  }
  function updatePrayerCountdown() {
    if (!state.nextPrayer) return;
    var remaining = Math.max(0,Math.floor((state.nextPrayer-Date.now())/60000));
    status('nextPrayerLabel','الصلاة التالية: '+state.nextPrayerName+' بعد '+Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0'));
    $('nextPrayerLabel').hidden = false;
  }
  function saveLocation() {
    var lat = Number($('latitude').value), lon = Number($('longitude').value);
    if (!Number.isFinite(lat) || Math.abs(lat)>90 || !Number.isFinite(lon) || Math.abs(lon)>180) {
      status('locationStatus','أدخل خط عرض بين -90 و90 وخط طول بين -180 و180.',true); return;
    }
    if (!store('ahl-athar-latitude',String(lat)) || !store('ahl-athar-longitude',String(lon))) return;
    state.location = { latitude:lat, longitude:lon }; updateLocationStatus('تم حفظ الموقع'); updatePrayerTimes(); updateQibla();
  }
  function locate() {
    if (!navigator.geolocation) { status('locationStatus','تحديد الموقع غير متاح. أدخل الإحداثيات يدويًا.',true); return; }
    status('locationStatus','بانتظار إذنك لتحديد الموقع…');
    navigator.geolocation.getCurrentPosition(function (position) {
      state.location = { latitude:position.coords.latitude, longitude:position.coords.longitude };
      $('latitude').value = state.location.latitude.toFixed(6); $('longitude').value = state.location.longitude.toFixed(6);
      store('ahl-athar-latitude',String(state.location.latitude)); store('ahl-athar-longitude',String(state.location.longitude));
      updateLocationStatus('تم تحديد الموقع بإذنك'); updatePrayerTimes(); updateQibla();
    }, function (error) {
      status('locationStatus',({1:'لم يُسمح بالوصول إلى الموقع. أدخل الإحداثيات يدويًا.',2:'تعذر تحديد الموقع الآن.',3:'انتهت مهلة تحديد الموقع.'})[error.code] || 'تعذر تحديد الموقع.',true);
    },{enableHighAccuracy:false,timeout:15000,maximumAge:60000});
  }
  function updateQibla() {
    if (!state.location || !window.adhan) { $('qiblaBearing').textContent='—°'; status('compassStatus','حدد موقعك من قسم الصلاة أولًا.'); return; }
    var bearing = window.adhan.Qibla(new window.adhan.Coordinates(state.location.latitude,state.location.longitude));
    $('qiblaBearing').textContent = Math.round(bearing)+'° من الشمال';
    $('compassArrow').style.transform = 'rotate('+(bearing-(state.compass || 0))+'deg)';
    status('compassStatus',state.compass === null ? 'الاتجاه محسوب من الشمال. شغّل البوصلة لتحريك المؤشر.' : 'اتجاه القبلة بالنسبة إلى اتجاه الجهاز.');
  }
  function startCompass() {
    if (!window.DeviceOrientationEvent) { status('compassStatus','مستشعر البوصلة غير متاح. استخدم زاوية القبلة الظاهرة.',true); return; }
    var request = window.DeviceOrientationEvent.requestPermission;
    (typeof request === 'function' ? request.call(window.DeviceOrientationEvent) : Promise.resolve('granted'))
      .then(function (permission) {
        if (permission !== 'granted') throw new Error('permission');
        function orientation(event) {
          var heading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading :
            event.absolute && Number.isFinite(event.alpha) ? (360-event.alpha)%360 : null;
          if (heading !== null) { state.compass = heading; updateQibla(); }
        }
        window.addEventListener('deviceorientation',orientation);
        if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute',orientation);
        status('compassStatus','حرّك الهاتف ببطء لمعايرة البوصلة.');
      }).catch(function () { status('compassStatus','تعذر تشغيل مستشعر الاتجاه أو لم يُسمح به.',true); });
  }

  /* Daily adhkar: counts are device-local and synced through the same user_data row. */
  var adhkar = {
    morning:[
      {id:'kursi',text:'آية الكرسي — الله لا إله إلا هو الحي القيوم، تُقرأ كاملة.',count:1,ref:'البقرة: 255'},
      {id:'muawwidhat',text:'سورة الإخلاص وسورتا الفلق والناس.',count:3,ref:'كل سورة ثلاث مرات'},
      {id:'asbahna',text:'أصبحنا وأصبح الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد، وهو على كل شيء قدير.',count:1,ref:'ذكر الصباح'},
      {id:'raditu',text:'رضيت بالله ربًا، وبالإسلام دينًا، وبمحمد ﷺ نبيًا.',count:3,ref:'ثلاث مرات'},
      {id:'bismillah',text:'بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم.',count:3,ref:'ثلاث مرات'},
      {id:'subhanallah',text:'سبحان الله وبحمده.',count:100,ref:'مئة مرة'}
    ],
    evening:[
      {id:'kursi',text:'آية الكرسي — الله لا إله إلا هو الحي القيوم، تُقرأ كاملة.',count:1,ref:'البقرة: 255'},
      {id:'muawwidhat',text:'سورة الإخلاص وسورتا الفلق والناس.',count:3,ref:'كل سورة ثلاث مرات'},
      {id:'amsayna',text:'أمسينا وأمسى الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد، وهو على كل شيء قدير.',count:1,ref:'ذكر المساء'},
      {id:'raditu',text:'رضيت بالله ربًا، وبالإسلام دينًا، وبمحمد ﷺ نبيًا.',count:3,ref:'ثلاث مرات'},
      {id:'bismillah',text:'بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم.',count:3,ref:'ثلاث مرات'},
      {id:'subhanallah',text:'سبحان الله وبحمده.',count:100,ref:'مئة مرة'}
    ]
  };
  function dateKey(date) { return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'); }
  function renderAdhkar() {
    var host = $('adhkarList'); if (!host) return; host.replaceChildren();
    adhkar[state.period].forEach(function (entry) {
      var key = 'ahl-athar-dhikr-'+dateKey(new Date())+'-'+state.period+'-'+entry.id, count = 0;
      try { count = Math.min(entry.count,Number(readStore(key))||0); } catch (e) {}
      var article = document.createElement('article'); article.className = 'v3-dhikr-entry';
      var text = document.createElement('p'); text.textContent = entry.text;
      var footer = document.createElement('div'); footer.className = 'v3-dhikr-footer';
      var ref = document.createElement('span'); ref.textContent = entry.ref;
      var button = document.createElement('button'); button.type = 'button'; button.className = 'v3-counter';
      function paint() { button.textContent = count+' / '+entry.count; button.disabled = count>=entry.count; button.setAttribute('aria-label','تسجيل الذكر '+count+' من '+entry.count); }
      button.addEventListener('click',function () { count=Math.min(entry.count,count+1); if(store(key,String(count))) { paint(); scheduleSync(); } });
      paint(); footer.append(ref,button); article.append(text,footer); host.appendChild(article);
    });
  }
  function selectPeriod(period) {
    state.period = period;
    [['morningBtn','morning'],['eveningBtn','evening']].forEach(function (pair) {
      var active = pair[1]===period; $(pair[0]).classList.toggle('on',active); $(pair[0]).setAttribute('aria-pressed',String(active));
    });
    renderAdhkar();
  }

  /* Published library API contract: GET /api/library -> { items: [...] }. */
  async function loadLibrary() {
    if (state.libraryPromise) return state.libraryPromise;
    status('mediaStatus','جارٍ تحميل المكتبة…');
    state.libraryPromise = (async function () {
      try {
        var response = await fetch(api('/api/library'));
        if (!response.ok) throw new Error('request failed');
        var decoded = new TextDecoder('utf-8',{fatal:true}).decode(await response.arrayBuffer());
        var result = JSON.parse(decoded);
        if (!Array.isArray(result.items)) throw new Error('invalid');
        state.media = result.items; renderLibrary();
      } catch (e) { status('mediaStatus','تعذر تحميل المكتبة الآن. حاول مرة أخرى.',true); }
    })();
    return state.libraryPromise;
  }
  function renderLibrary() {
    var host = $('mediaItems'); host.replaceChildren();
    var items = state.media.filter(function (item) { return state.mediaCategory==='all' || item.category===state.mediaCategory; });
    status('mediaStatus',items.length?'عدد المواد: '+items.length:(state.media.length?'لا توجد مواد في هذا التصنيف.':'لا توجد مواد منشورة بعد.'));
    items.forEach(function (item) {
      var article = document.createElement('article'); article.className = 'v3-library-entry';
      var kind = document.createElement('span'); kind.textContent = item.categoryName || item.category || 'مادة';
      var title = document.createElement('h3'); title.textContent = item.title || 'مادة علمية';
      article.append(kind,title);
      if (item.kind==='audio' || item.kind==='video') {
        var player = document.createElement(item.kind); player.controls=true; player.preload='none'; player.setAttribute('data-src',api(item.url)); article.appendChild(player);
      } else if (item.kind==='image') {
        var image = document.createElement('img'); image.src=api(item.url); image.alt=item.title||'مادة من المكتبة'; image.loading='lazy'; article.appendChild(image);
      } else {
        var link = document.createElement('a'); link.href=api(item.url); link.download=''; link.textContent='تحميل المادة'; article.appendChild(link);
      }
      if (item.uploadedAt) { var date = document.createElement('time'); date.dateTime=item.uploadedAt; date.textContent=new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium'}).format(new Date(item.uploadedAt)); article.appendChild(date); }
      host.appendChild(article);
    });
  }
  /* Turnstile + questions: preserve POST /api/questions and payload contract. */
  function siteKey() { return String(window.AHL_TURNSTILE_SITE_KEY || '').trim(); }
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (state.turnstilePromise) return state.turnstilePromise;
    state.turnstilePromise = new Promise(function (resolve,reject) {
      var script=document.createElement('script'); script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async=true; script.defer=true; script.onload=function(){window.turnstile?resolve():reject(new Error('Turnstile unavailable'));};
      script.onerror=function(){reject(new Error('Turnstile failed'));}; document.head.appendChild(script);
    });
    return state.turnstilePromise;
  }
  async function prepareTurnstile() {
    if (!siteKey()) return false;
    $('questionTurnstile').hidden=false; $('questionTurnstileStatus').hidden=false;
    try {
      await loadTurnstile();
      if (state.turnstileId===null) state.turnstileId=window.turnstile.render($('questionTurnstile'),{
        sitekey:siteKey(),action:'submit_question',
        callback:function(){status('questionTurnstileStatus','اكتمل التحقق الأمني.');},
        'expired-callback':function(){status('questionTurnstileStatus','انتهت صلاحية التحقق. أعد التحقق.');},
        'error-callback':function(){status('questionTurnstileStatus','تعذر إكمال التحقق الأمني.',true);}
      });
      return true;
    } catch(e) { status('questionTurnstileStatus','تعذر تحميل التحقق الأمني. حاول مجددًا.',true); return false; }
  }
  async function sendQuestion() {
    var question=$('qt').value.trim(), button=$('sendQuestionBtn');
    if(question.length<5||question.length>1600){status('qm','اكتب سؤالًا بين 5 و1600 حرف.',true);return;}
    if(!$('questionConsent').checked){status('qm','وافق على إرسال السؤال للمراجعة أولًا.',true);return;}
    var token='';
    if(siteKey()) {
      if(!await prepareTurnstile()) return;
      token=window.turnstile.getResponse(state.turnstileId)||'';
      if(!token){status('qm','أكمل التحقق الأمني قبل الإرسال.',true);return;}
    }
    button.disabled=true; status('qm','جارٍ إرسال السؤال للمراجعة…');
    try {
      var payload={question:question}; if(token) payload.turnstileToken=token;
      var response=await fetch(api('/api/questions'),{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(payload)});
      var result; try { result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await response.arrayBuffer())); }
      catch(e){throw new Error('استجابة الخادم غير صالحة. حاول لاحقًا.');}
      if(!response.ok) throw new Error(result.error||'تعذر إرسال السؤال.');
      status('qm','وصل سؤالك إلى الشيخ على Telegram. سيطّلع عليه الشيخ بنفسه.');
    } catch(e) { status('qm',e instanceof TypeError?'تعذر الاتصال بالخادم الخلفي. حاول مجددًا.':e.message,true); }
    finally { if(window.turnstile&&state.turnstileId!==null)window.turnstile.reset(state.turnstileId); button.disabled=!$('questionConsent').checked; }
  }

  /* Supabase client contract is provided by the generated authentication bundle. */
  function collectDhikr() {
    var data={}, prefix='ahl-athar-dhikr-'+dateKey(new Date())+'-';
    try { var storage = safeStorage(); if (storage) for(var i=0;i<storage.length;i++){var key=storage.key(i);if(key&&key.indexOf(prefix)===0)data[key.slice('ahl-athar-dhikr-'.length)]=Number(readStore(key))||0;} } catch(e){}
    return data;
  }
  async function syncAccount(user,merge) {
    if(!user||!window.ahlAuth||!window.ahlAuth.configured)return;
    status('syncStatus','جارٍ مزامنة الأذكار وطريقة الحساب…');
    try {
      var remote=await window.ahlAuth.loadUserData(user.id), data=remote&&remote.data&&typeof remote.data==='object'?remote.data:{};
      if(merge&&['auto','egypt','umm','mwl'].indexOf(data.calculationMethod)>=0){$('calcMethod').value=data.calculationMethod;store('ahl-athar-calculation-method',data.calculationMethod);}
      if(merge&&['shafi','hanafi'].indexOf(data.asrMadhab)>=0){$('asrMadhab').value=data.asrMadhab;store('ahl-athar-asr-madhab',data.asrMadhab);}
      var local=collectDhikr(), remoteDhikr=data.dhikr&&typeof data.dhikr==='object'&&!Array.isArray(data.dhikr)?data.dhikr:{};
      var today=dateKey(new Date())+'-';
      Object.keys(remoteDhikr).forEach(function(key){if(key.indexOf(today)!==0)return;var n=Number(remoteDhikr[key]);if(Number.isFinite(n)&&n>=0){var merged=Math.max(Number(local[key])||0,n);local[key]=merged;store('ahl-athar-dhikr-'+key,String(merged));}});
      await window.ahlAuth.saveUserData(user.id,{version:1,calculationMethod:$('calcMethod').value,asrMadhab:$('asrMadhab').value,dhikr:collectDhikr()});
      renderAdhkar();updatePrayerTimes();status('syncStatus','تمت المزامنة. الموقع الدقيق محفوظ على هذا الجهاز فقط.');
    } catch(e) { status('syncStatus','تعذرت المزامنة: '+e.message,true); }
  }
  function scheduleSync() {
    if(!state.account||!window.ahlAuth||!window.ahlAuth.configured)return;
    clearTimeout(state.syncTimer);state.syncTimer=setTimeout(function(){syncAccount(state.account,false);},600);
  }
  function accountState(info) {
    var form=$('authForm'), signed=$('accountSignedIn');
    if(!info.configured){state.account=null;$('authConfigMissing').hidden=false;form.hidden=true;signed.hidden=true;status('authMessage','أضف إعدادات Supabase لتفعيل الحسابات.');return;}
    $('authConfigMissing').hidden=true;state.account=info.user;
    if(info.event==='PASSWORD_RECOVERY'){$('passwordResetPanel').hidden=false;form.hidden=true;signed.hidden=true;status('authMessage','أدخل كلمة المرور الجديدة لإكمال الاستعادة.');return;}
    $('passwordResetPanel').hidden=true;
    if(!info.user){form.hidden=false;signed.hidden=true;status('authMessage','سجّل الدخول أو أنشئ حسابًا بالبريد الإلكتروني.');return;}
    form.hidden=true;signed.hidden=false;$('accountEmail').textContent=info.user.email||'';
    status('authMessage','تسجيل الدخول محفوظ تلقائيًا على هذا الجهاز.');
    syncAccount(info.user,true);
  }
  function initAuth() {
    if(!window.ahlAuth){status('authMessage','تعذر تحميل مكتبة تسجيل الدخول.',true);return;}
    window.ahlAuth.init(accountState);
    $('authForm').addEventListener('submit',async function(event){
      event.preventDefault();if(!$('authForm').reportValidity())return;
      $('signInBtn').disabled=true;$('signUpBtn').disabled=true;status('authMessage','جارٍ تسجيل الدخول…');
      try{var result=await window.ahlAuth.signIn($('authEmail').value.trim(),$('authPassword').value);if(result.error)throw result.error;status('authMessage','تم تسجيل الدخول.');}
      catch(e){status('authMessage','تعذر تسجيل الدخول: '+e.message,true);}
      finally{$('signInBtn').disabled=false;$('signUpBtn').disabled=false;}
    });
    $('signUpBtn').addEventListener('click',async function(){
      if(!$('authForm').reportValidity())return;
      $('signInBtn').disabled=true;$('signUpBtn').disabled=true;status('authMessage','جارٍ إنشاء الحساب…');
      try{var result=await window.ahlAuth.signUp($('authEmail').value.trim(),$('authPassword').value);if(result.error)throw result.error;
        status('authMessage',result.data.session?'تم إنشاء الحساب وتسجيل الدخول.':'تم إنشاء الحساب. افتح رسالة البريد لتأكيد العنوان ثم سجّل الدخول.');}
      catch(e){status('authMessage','تعذر إنشاء الحساب: '+e.message,true);}
      finally{$('signInBtn').disabled=false;$('signUpBtn').disabled=false;}
    });
    $('resetPasswordBtn').addEventListener('click',async function(){
      var email=$('authEmail').value.trim();
      if(!email||!$('authEmail').checkValidity()){status('authMessage','أدخل بريدك الإلكتروني الصحيح أولًا.',true);$('authEmail').focus();return;}
      $('resetPasswordBtn').disabled=true;
      try{var result=await window.ahlAuth.requestPasswordReset(email);if(result.error)throw result.error;status('authMessage','إذا كان البريد مسجلًا، فستصلك رسالة استعادة كلمة المرور.');}
      catch(e){status('authMessage','تعذر إرسال رابط الاستعادة: '+e.message,true);}
      finally{$('resetPasswordBtn').disabled=false;}
    });
    $('updatePasswordBtn').addEventListener('click',async function(){
      var password=$('newAuthPassword').value;
      if(password.length<8){status('authMessage','كلمة المرور يجب ألا تقل عن 8 أحرف.',true);$('newAuthPassword').focus();return;}
      $('updatePasswordBtn').disabled=true;
      try{var result=await window.ahlAuth.updatePassword(password);if(result.error)throw result.error;$('passwordResetPanel').hidden=true;$('newAuthPassword').value='';status('authMessage','تم تحديث كلمة المرور بنجاح.');}
      catch(e){status('authMessage','تعذر تحديث كلمة المرور: '+e.message,true);}
      finally{$('updatePasswordBtn').disabled=false;}
    });
    $('signOutBtn').addEventListener('click',async function(){
      status('authMessage','جارٍ تسجيل الخروج…');try{var result=await window.ahlAuth.signOut();if(result.error)throw result.error;status('authMessage','تم تسجيل الخروج.');}
      catch(e){status('authMessage','تعذر تسجيل الخروج: '+e.message,true);}
    });
  }

  /* Support, clipboard, sharing and install */
  window.copySupportNumber = async function(button) {
    var number=button&&button.getAttribute('data-support-number');if(!number)return;
    var feedback=button.parentElement&&button.parentElement.parentElement.querySelector('.copy-feedback');
    try{await navigator.clipboard.writeText(number);if(feedback)feedback.textContent='تم نسخ رقم فودافون كاش.';}
    catch(e){if(feedback)feedback.textContent='تعذر النسخ. يمكنك نسخ الرقم يدويًا.';}
  };
  window.copyQ = async function() {
    var value=$('qt').value;if(!value){status('qm','اكتب سؤالك أولًا.');return;}
    try{await navigator.clipboard.writeText(value);status('qm','تم نسخ السؤال.');}
    catch(e){status('qm','تعذر نسخ السؤال. تحقق من إذن الحافظة.',true);}
  };
  window.share = async function() {
    try{if(navigator.share)await navigator.share({title:'استراحة أهل الأثر',url:location.href});
      else {await navigator.clipboard.writeText(location.href);status('prayerDate','تم نسخ رابط المجلس.');}}
    catch(e){if(e.name!=='AbortError')status('prayerDate','تعذرت مشاركة التطبيق.',true);}
  };
  window.addEventListener('beforeinstallprompt',function(event){event.preventDefault();state.installPrompt=event;$('inst').hidden=false;});
  window.install = async function() {
    if(!state.installPrompt)return;
    state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$('inst').hidden=true;
  };

  function init() {
    renderSchedule(); updateScheduleClock(); Promise.all([loadLectures(), loadLibrary()]);
    $('calcMethod').value=readStore('ahl-athar-calculation-method')||'auto';
    $('asrMadhab').value=readStore('ahl-athar-asr-madhab')||'shafi';
    state.location=loadLocation();
    if(state.location){$('latitude').value=state.location.latitude;$('longitude').value=state.location.longitude;updateLocationStatus();}
    $('calcMethod').addEventListener('change',function(){store('ahl-athar-calculation-method',this.value);updatePrayerTimes();scheduleSync();});
    $('asrMadhab').addEventListener('change',function(){store('ahl-athar-asr-madhab',this.value);updatePrayerTimes();scheduleSync();});
    $('saveLocation').addEventListener('click',saveLocation);$('locateBtn').addEventListener('click',locate);$('qiblaLocateBtn').addEventListener('click',locate);$('compassBtn').addEventListener('click',startCompass);
    $('morningBtn').addEventListener('click',function(){selectPeriod('morning');});$('eveningBtn').addEventListener('click',function(){selectPeriod('evening');});
    $('mediaFilters').addEventListener('click',function(event){var button=event.target.closest('[data-media-category]');if(!button)return;
      state.mediaCategory=button.getAttribute('data-media-category');
      $('mediaFilters').querySelectorAll('[data-media-category]').forEach(function(item){var active=item===button;item.classList.toggle('on',active);item.setAttribute('aria-pressed',String(active));});renderLibrary();if(!$('media').hidden)activateMediaSources();});
    $('questionConsent').addEventListener('change',function(){ $('sendQuestionBtn').disabled=!this.checked;if(this.checked&&siteKey())prepareTurnstile();if(!this.checked&&window.turnstile&&state.turnstileId!==null)window.turnstile.reset(state.turnstileId);});
    $('sendQuestionBtn').addEventListener('click',sendQuestion);
    $('adhanUrl').value=readStore('ahl-athar-adhan-url')||'';
    $('saveAdhan').addEventListener('click',function(){
      try{var url=new URL($('adhanUrl').value.trim());if(url.protocol!=='https:')throw new Error('protocol');
        store('ahl-athar-adhan-url',url.href);$('adhanAudio').src=url.href;$('adhanAudio').hidden=false;$('adhanAudio').load();status('audioStatus','حُفظ الرابط. استخدم مشغّل الصوت لبدء الأذان.');
      }catch(e){status('audioStatus','أدخل رابط HTTPS صحيحًا لتسجيل الأذان.',true);}
    });
    $('adhanAudio').addEventListener('error',function(){status('audioStatus','تعذر تحميل تسجيل الأذان.',true);});
    $('adhanAudio').addEventListener('play',function(){status('audioStatus','يُشغّل التسجيل الآن.');});
    renderAdhkar(); updatePrayerTimes(); updateQibla(); initRadio(); initAuth();
    setInterval(updateScheduleClock,1000);setInterval(updatePrayerCountdown,1000);setInterval(updatePrayerTimes,60000);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/v3/sw.js',{scope:'/v3/'}).catch(function(){});
    document.body.classList.add('v3-ready');
    var opening=document.querySelector('.opening');if(opening&&!reduced)opening.classList.add('is-revealed');
    window.dispatchEvent(new CustomEvent('haress-v3:ready'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.HaressV3Runtime={navigate:navigate,loadLibrary:loadLibrary,renderAdhkar:renderAdhkar};
})();