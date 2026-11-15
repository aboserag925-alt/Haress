(function () {
  'use strict';

  var root = document.documentElement;
  var themeButton = document.querySelector('[data-v3-theme-toggle]');
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var VIEWS = ['home', 'program', 'library', 'prayers', 'qibla', 'adhkar', 'questions', 'account'];
  var currentView = 'home';

  /* ============================================================
     Theme
     ============================================================ */
  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#161c18' : '#f7f3ea');
    if (themeButton) {
      themeButton.setAttribute('aria-label', theme === 'dark' ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الداكن');
      themeButton.textContent = theme === 'dark' ? '☼' : '◐';
    }
    try { localStorage.setItem('haress-v3-theme', theme); } catch (error) {}
  }

  try {
    var saved = localStorage.getItem('haress-v3-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
    else setTheme('light');
  } catch (error) { setTheme('light'); }

  if (themeButton) themeButton.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* ============================================================
     View navigation (no full-page reload, never leaves /v3/)
     ============================================================ */
  function el(id) { return document.getElementById(id); }

  function setActiveNav(target) {
    /* desktop + bottom nav + side selectors */
    var selectors = [
      '[data-v3-target="' + target + '"]',
      '.bottom-nav-item[data-v3-target="' + target + '"]',
      '.nav-btn[data-v3-target="' + target + '"]'
    ];
    document.querySelectorAll('[data-v3-target]').forEach(function (button) {
      var isActive = selectors.some(function (s) { return button.matches(s); });
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    if (bottomScrollContainer) {
      bottomScrollContainer.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    }
  }

  function navigate(target, opts) {
    opts = opts || {};
    if (VIEWS.indexOf(target) < 0) return;
    if (target === currentView && !opts.force) return;

    var from = currentView;
    currentView = target;

    function apply() {
      VIEWS.forEach(function (v) {
        var node = el('view-' + v);
        if (node) node.hidden = v !== target;
      });
      setActiveNav(target);
      window.scrollTo(0, 0);
      if (target === 'library' || target === 'home') {
        if (typeof window.HaressV3Runtime !== 'undefined' && window.HaressV3Runtime.loadLibrary) {
          window.HaressV3Runtime.loadLibrary();
        }
      }
      if (target === 'adhkar') {
        if (typeof window.HaressV3Runtime !== 'undefined' && window.HaressV3Runtime.renderAdhkar) {
          window.HaressV3Runtime.renderAdhkar();
        }
      }
      if (target === 'qibla') {
        if (typeof window.HaressV3Runtime !== 'undefined' && window.HaressV3Runtime.updateQibla) {
          window.HaressV3Runtime.updateQibla();
        }
      }
      document.body.classList.remove('v32-view-enter');
      void document.body.offsetWidth;
      document.body.classList.add('v32-view-enter');
      window.dispatchEvent(new CustomEvent('haress-v3:viewchange', { detail: { from: from, to: target } }));
    }

    if (opts.useTransition !== false && document.startViewTransition) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }

  /* wire all navigation buttons */
  function wireNav() {
    document.querySelectorAll('[data-v3-target]').forEach(function (button) {
      button.addEventListener('click', function () {
        navigate(button.getAttribute('data-v3-target'));
      });
    });
  }

  /* Bottom nav scroll container ref */
  var bottomScrollContainer = null;

  /* ============================================================
     Library search (client-side filtering of loaded data)
     ============================================================ */
  function initLibrarySearch() {
    var input = el('librarySearch');
    var grid = el('libraryGrid');
    var empty = el('libraryEmpty');
    var status = el('libraryStatus');
    if (!input || !grid) return;

    var allItems = [];
    var debounceTimer = null;

    function render(filtered) {
      grid.replaceChildren();
      if (filtered.length === 0) {
        if (empty) empty.hidden = false;
        if (status) status.hidden = true;
        return;
      }
      if (empty) empty.hidden = true;
      if (status) { status.hidden = false; status.textContent = 'عدد المواد: ' + filtered.length; }
      filtered.forEach(function (item) {
        var card = document.createElement('article');
        card.className = 'media-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', item.title || 'مادة علمية');
        var thumb = document.createElement('div');
        thumb.className = 'media-thumb';
        thumb.textContent = item.kind === 'audio' ? '▶' : item.kind === 'video' ? '⏯' : item.kind === 'image' ? '🖼' : '📄';
        var title = document.createElement('h3');
        title.textContent = item.title || 'مادة علمية';
        var meta = document.createElement('div');
        meta.className = 'media-meta';
        meta.textContent = (item.categoryName || item.category || 'مادة') + ' · ' + (item.uploadedAt ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(item.uploadedAt)) : '');
        var actions = document.createElement('div');
        actions.className = 'media-actions';
        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.textContent = 'فتح';
        openBtn.onclick = function (ev) { ev.stopPropagation(); openMediaDetail(item); };
        var playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.textContent = item.kind === 'audio' || item.kind === 'video' ? 'تشغيل' : 'تفاصيل';
        playBtn.onclick = function (ev) { ev.stopPropagation(); openMediaDetail(item); };
        actions.appendChild(openBtn);
        actions.appendChild(playBtn);
        card.appendChild(thumb);
        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(actions);
        card.onclick = function () { openMediaDetail(item); };
        card.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openMediaDetail(item); } };
        grid.appendChild(card);
      });
    }

    function query() {
      var q = input.value.trim();
      if (status) {
        status.hidden = false;
        status.textContent = q ? 'نتائج البحث: جاري التصفية…' : 'عدد المواد: ' + allItems.length;
      }
      if (empty) empty.hidden = true;
      var filtered = allItems.filter(function (item) {
        if (!q) return true;
        var haystack = ((item.title || '') + ' ' + (item.categoryName || item.category || '') + ' ' + (item.category || '')).toLocaleLowerCase('ar-EG');
        return haystack.indexOf(q.toLocaleLowerCase('ar-EG')) >= 0;
      });
      render(filtered);
      if (status) {
        status.hidden = false;
        status.textContent = q ? ('نتائج البحث: ' + filtered.length + ' مادة') : ('عدد المواد: ' + allItems.length);
      }
    }

    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(query, 150);
    });

    window.addEventListener('haress-v3:viewchange', function (ev) {
      if (ev.detail.to === 'library') {
        if (typeof window.HaressV3Runtime !== 'undefined' && window.HaressV3Runtime.loadLibrary) {
          window.HaressV3Runtime.loadLibrary();
        }
      }
    });

    /* expose for runtime to inject loaded items */
    window.__v32Library = {
      setItems: function (items) { allItems = items || []; query(); },
      appendItems: function (items) { allItems = (allItems || []).concat(items || []); query(); },
      reset: function () { allItems = []; query(); }
    };
  }

  /* ============================================================
     Media detail panel
     ============================================================ */
  function openMediaDetail(item) {
    var panel = el('mediaDetailPanel');
    var card = el('mediaDetailCard');
    if (!panel || !card) return;
    var kindLabel = item.kind === 'audio' ? 'مادة صوتية' : item.kind === 'video' ? 'مادة مرئية' : item.kind === 'image' ? 'صورة' : 'مادة';
    var date = item.uploadedAt ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(item.uploadedAt)) : '—';
    card.innerHTML = [
      '<button class="media-detail-close" type="button" onclick="closeMediaDetail()" aria-label="إغلاق التفاصيل">×</button>',
      '<div class="media-meta">' + kindLabel + ' · ' + date + '</div>',
      '<h2>' + (item.title || 'مادة علمية') + '</h2>',
      '<p>' + (item.description || 'لا يوجد وصف متاح لهذه المادة.') + '</p>',
      item.url ? '<div class="media-actions"><button class="gold-action" type="button" onclick="openMediaUrl(\'' + String(item.url).replace(/'/g, "\\'") + '\')">فتح المادة</button></div>' : ''
    ].join('');
    panel.classList.add('open');
  }
  window.openMediaDetail = openMediaDetail;

  function closeMediaDetail() {
    var panel = el('mediaDetailPanel');
    if (panel) panel.classList.remove('open');
  }
  window.closeMediaDetail = closeMediaDetail;

  function openMediaUrl(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  window.openMediaUrl = openMediaUrl;

  /* close detail on backdrop click */
  var panel = el('mediaDetailPanel');
  if (panel) {
    panel.addEventListener('click', function (ev) {
      if (ev.target === panel) closeMediaDetail();
    });
  }

  /* ============================================================
     Adhkar reset confirmation
     ============================================================ */
  function initAdhkarReset() {
    var btn = el('adhkarReset');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!confirm('هل تريد إعادة تعيين تقدم الأذكار لهذا اليوم؟ لا يمكن التراجع عن هذا الإجراء.')) return;
      var today = new Date();
      var dateKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      var prefix = 'ahl-athar-dhikr-' + dateKey + '-';
      try {
        var storage = window.localStorage;
        if (storage) {
          var keys = [];
          for (var i = 0; i < storage.length; i++) {
            var k = storage.key(i);
            if (k && k.indexOf(prefix) === 0) keys.push(k);
          }
          keys.forEach(function (k) { storage.removeItem(k); });
        }
      } catch (e) {}
      if (typeof window.HaressV3Runtime !== 'undefined' && window.HaressV3Runtime.renderAdhkar) {
        window.HaressV3Runtime.renderAdhkar();
      }
    });
  }

  /* ============================================================
     Global helpers exposed to HTML
     ============================================================ */
  window.share = function () {
    try {
      if (navigator.share) return navigator.share({ title: 'استراحة أهل الأثر', url: location.href });
      return navigator.clipboard.writeText(location.href);
    } catch (e) { if (e.name !== 'AbortError') console.log('share failed', e); }
  };
  window.copyQ = function () {
    var value = el('questionText');
    if (!value || !value.value) { var m = el('questionMsg'); if (m) { m.textContent = 'اكتب سؤالك أولًا.'; m.className = 'qm error'; } return; }
    try {
      navigator.clipboard.writeText(value.value);
      var m2 = el('questionMsg');
      if (m2) { m2.textContent = 'تم نسخ السؤال.'; m2.className = 'qm'; }
    } catch (e) {
      var m3 = el('questionMsg');
      if (m3) { m3.textContent = 'تعذر نسخ السؤال. تحقق من إذن الحافظة.'; m3.className = 'qm error'; }
    }
  };
  window.copySupportNumber = function (button) {
    var number = button && button.getAttribute('data-support-number'); if (!number) return;
    var feedback = button.parentElement && button.parentElement.parentElement.querySelector('.copy-feedback');
    try {
      navigator.clipboard.writeText(number);
      if (feedback) feedback.textContent = 'تم نسخ رقم فودافون كاش.';
    } catch (e) {
      if (feedback) feedback.textContent = 'تعذر النسخ. يمكنك نسخ الرقم يدويًا.';
    }
  };
  window.install = function () {
    if (!window.__v32InstallPrompt) return;
    window.__v32InstallPrompt.prompt();
    return window.__v32InstallPrompt.userChoice.then(function () {
      window.__v32InstallPrompt = null;
      var inst = el('inst'); if (inst) inst.hidden = true;
    });
  };

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    wireNav();
    initLibrarySearch();
    initAdhkarReset();
    setActiveNav('home');

    /* install prompt capture */
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      window.__v32InstallPrompt = event;
      var inst = el('inst'); if (inst) inst.hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      window.__v32InstallPrompt = null;
      var inst = el('inst'); if (inst) inst.hidden = true;
    });

    /* bottom nav container reference after DOM ready */
    bottomScrollContainer = document.querySelector('.bottom-nav-item.is-active');

    document.body.classList.add('v3-ready');
    window.dispatchEvent(new CustomEvent('haress-v3:ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.HaressV3 = { setTheme: setTheme, reducedMotion: reducedMotion, navigate: navigate };
})();
