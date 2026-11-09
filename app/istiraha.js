/* إستراحة أهل الأثر — منطق الواجهة المشتركة.
   يقرأ البيانات من app/istiraha-content.js ولا يخترع أي معلومة.
   لا يعتمد على أي framework، ويعمل في الصفحة الرئيسية وتطبيق PWA. */
(function () {
  'use strict';

  var cfg = window.AHL_ISTIRAHA;
  if (!cfg) return;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function safeHttps(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch (error) {
      return false;
    }
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function scrollToNode(node) {
    if (!node) return;
    node.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    try { node.focus({ preventScroll: true }); } catch (error) { /* focus is optional */ }
  }

  function isAppPage() {
    return Boolean(document.getElementById('istirahaHome'));
  }

  function linkNode(key, className) {
    var item = cfg.links[key];
    if (!item) return null;
    var anchor = el('a', className || 'ist-chip', item.label);
    anchor.href = item.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.setAttribute('aria-label', item.label + ' — رابط خارجي');
    return anchor;
  }

  function updateActiveNav(key) {
    $$('[data-ist-nav]').forEach(function (link) {
      var active = link.getAttribute('data-ist-nav') === key;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function liveState() {
    if (!cfg.live) return 'offline';
    if (cfg.live.state !== 'live' || cfg.live.verified !== true) return 'offline';
    return safeHttps(cfg.live.url) ? 'live' : 'offline';
  }

  function hydrateLinks() {
    $$('[data-istiraha-link]').forEach(function (node) {
      var item = cfg.links[node.getAttribute('data-istiraha-link')];
      if (!item) return;
      node.href = item.url;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
      if (!node.hasAttribute('aria-label')) {
        node.setAttribute('aria-label', item.label + ' — رابط خارجي');
      }
      if (node.hasAttribute('data-istiraha-link-text')) {
        node.textContent = item.label;
      }
    });
  }

  function renderSocial() {
    var all = ['youtube', 'tiktok', 'telegramChannel', 'telegramGroup', 'recordings'];
    $$('[data-istiraha-social]').forEach(function (container) {
      var requested = (container.getAttribute('data-istiraha-social-keys') || '')
        .split(',')
        .map(function (key) { return key.trim(); })
        .filter(Boolean);
      var keys = requested.length ? requested : all;
      container.textContent = '';
      keys.forEach(function (key) {
        var anchor = linkNode(key, 'ist-chip');
        if (anchor) container.appendChild(anchor);
      });
    });
  }

  function renderDoctor() {
    $$('[data-istiraha-doctor]').forEach(function (container) {
      container.textContent = '';
      container.appendChild(el('h3', null, cfg.doctor.name));
      container.appendChild(el('p', 'ist-role', cfg.doctor.role));

      var facts = el('ul', 'ist-list');
      cfg.doctor.verifiedFacts.forEach(function (fact) {
        facts.appendChild(el('li', null, fact));
      });
      container.appendChild(facts);

      var topics = el('div', 'ist-chip-row');
      topics.setAttribute('aria-label', 'المواد العلمية');
      cfg.doctor.topics.forEach(function (topic) {
        topics.appendChild(el('span', 'ist-chip', topic));
      });
      container.appendChild(topics);

      var placeholder = el('p', 'ist-placeholder', cfg.doctor.bioPlaceholder);
      placeholder.setAttribute('role', 'note');
      container.appendChild(placeholder);
    });
  }

  function renderLive() {
    var state = liveState();
    var isLive = state === 'live';

    $$('[data-istiraha-live]').forEach(function (container) {
      container.textContent = '';
      container.classList.toggle('is-live', isLive);
      container.setAttribute('data-state', state);

      var badge = el('span', 'ist-live-badge' + (isLive ? ' is-live' : ''));
      var dot = el('span', 'ist-live-dot');
      dot.setAttribute('aria-hidden', 'true');
      badge.appendChild(dot);
      badge.appendChild(document.createTextNode(isLive ? 'مباشر الآن' : 'غير مباشر'));
      container.appendChild(badge);

      var status = el('p', 'ist-live-status', isLive
        ? 'البث جارٍ الآن' + (cfg.live.platform ? ' على ' + cfg.live.platform : '') + '.'
        : cfg.live.offlineMessage);
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      container.appendChild(status);

      var schedule = el('p', 'ist-note',
        'مواعيد المجالس: ' + cfg.schedule.days + ' — ' + cfg.schedule.times + '. ' + cfg.schedule.friday + '.');
      container.appendChild(schedule);

      var actions = el('div', 'ist-actions');
      if (isLive) {
        var liveLink = el('a', 'ist-btn ist-btn--live', 'افتح البث المباشر');
        liveLink.href = cfg.live.url;
        liveLink.target = '_blank';
        liveLink.rel = 'noopener noreferrer';
        actions.appendChild(liveLink);
      } else {
        var channel = linkNode('youtube', 'ist-btn ist-btn--primary');
        if (channel) {
          channel.textContent = 'متابعة القناة على يوتيوب';
          actions.appendChild(channel);
        }
      }
      container.appendChild(actions);

      var note = el('p', 'ist-note', cfg.live.note);
      container.appendChild(note);
    });

    $$('[data-ist-live-trigger]').forEach(function (trigger) {
      trigger.classList.toggle('is-live', isLive);
      trigger.setAttribute('aria-label', 'البث المباشر — ' + (isLive ? 'مباشر الآن' : 'غير مباشر'));
    });
  }

  function renderForum() {
    $$('[data-istiraha-forum]').forEach(function (container) {
      container.textContent = '';
      var badge = el('span', 'ist-badge', cfg.forum.label);
      container.appendChild(badge);
      container.appendChild(el('p', 'ist-forum-message', cfg.forum.message));
      container.appendChild(el('p', 'ist-note', cfg.forum.note));
      var actions = el('div', 'ist-actions');
      var group = linkNode('telegramGroup', 'ist-btn ist-btn--primary');
      if (group) {
        group.textContent = 'الانضمام إلى مجموعة المجلس';
        actions.appendChild(group);
      }
      container.appendChild(actions);
    });
  }

  function renderNotes() {
    var map = {
      'data-istiraha-consultation-note': cfg.consultation.note,
      'data-istiraha-library-note': cfg.library.note,
      'data-istiraha-recitations-note': cfg.recitations.note,
      'data-istiraha-support-note': cfg.support.method + ' — ' + cfg.support.note
    };
    Object.keys(map).forEach(function (attribute) {
      $$('[' + attribute + ']').forEach(function (node) {
        node.textContent = map[attribute];
      });
    });
    $$('[data-istiraha-support-number]').forEach(function (node) {
      node.textContent = cfg.support.number;
    });
  }

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try {
        var copied = document.execCommand('copy');
        field.remove();
        if (copied) resolve();
        else reject(new Error('copy-unavailable'));
      } catch (error) {
        field.remove();
        reject(error);
      }
    });
  }

  function initSupport() {
    $$('[data-istiraha-support-open]').forEach(function (button) {
      button.addEventListener('click', function () {
        var dialog = document.getElementById('supportDialog');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      });
    });

    $$('[data-istiraha-copy-support]').forEach(function (button) {
      button.addEventListener('click', function () {
        copyText(cfg.support.number).then(function () {
          button.textContent = 'تم نسخ الرقم';
        }).catch(function () {
          button.textContent = 'تعذر النسخ — انسخه يدويًا';
        });
      });
    });
  }

  function installShowWrapper() {
    var home = document.getElementById('istirahaHome');
    if (!home || typeof window.show !== 'function' || window.show.__istirahaWrapped) return;

    var originalShow = window.show;
    function wrappedShow(sectionId) {
      home.hidden = sectionId !== 'sched';
      var result = originalShow.apply(this, arguments);
      updateActiveNav(
        sectionId === 'sched' ? 'home' :
          sectionId === 'media' ? 'library' :
            sectionId === 'q' ? 'consultation' : ''
      );
      return result;
    }
    wrappedShow.__istirahaWrapped = true;
    window.show = wrappedShow;
  }

  function showHomeAndScroll(id) {
    var home = document.getElementById('istirahaHome');
    var target = document.getElementById(id);
    if (!home) {
      scrollToNode(target);
      return;
    }
    if (typeof window.show === 'function') window.show('sched');
    else home.hidden = false;
    updateActiveNav(id === 'live' ? 'home' : id);
    window.requestAnimationFrame(function () {
      scrollToNode(target);
    });
  }

  function initAppNavigation() {
    var app = isAppPage();

    $$('[data-ist-nav]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        var key = link.getAttribute('data-ist-nav');
        if (!app) {
          updateActiveNav(key);
          return;
        }
        event.preventDefault();
        if (key === 'home') {
          if (typeof window.show === 'function') window.show('sched');
          updateActiveNav('home');
          window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        } else if (key === 'library') {
          if (typeof window.show === 'function') window.show('media');
          updateActiveNav('library');
        } else if (key === 'forum' || key === 'contact') {
          showHomeAndScroll(key);
        }
      });
    });

    $$('[data-ist-live-trigger]').forEach(function (trigger) {
      trigger.addEventListener('click', function (event) {
        if (!app) return;
        event.preventDefault();
        showHomeAndScroll('live');
      });
    });

    $$('[data-istiraha-open-question]').forEach(function (control) {
      control.addEventListener('click', function (event) {
        if (!app) return;
        event.preventDefault();
        if (typeof window.show === 'function') window.show('q');
      });
    });

    $$('[data-istiraha-open-library]').forEach(function (control) {
      control.addEventListener('click', function (event) {
        if (!app) return;
        event.preventDefault();
        if (typeof window.show === 'function') window.show('media');
      });
    });

    $$('[data-istiraha-open-radio]').forEach(function (control) {
      control.addEventListener('click', function (event) {
        if (!app) return;
        event.preventDefault();
        var radioButton = document.getElementById('quranRadioButton');
        if (!radioButton) return;
        var panel = document.getElementById('quranRadioPanel');
        if (panel && panel.hidden) radioButton.click();
        scrollToNode(panel || radioButton);
      });
    });

    if (app) {
      var params = new URLSearchParams(window.location.search);
      var hash = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : '';
      var target = params.get('section') || hash;
      var allowed = ['sched', 'prayers', 'qibla', 'adhkar', 'media', 'q', 'account', 'about'];
      var wantsRadio = params.get('radio') === '1' || target === 'quranRadio' || target === 'quranRadioPanel';
      if (allowed.indexOf(target) !== -1) {
        window.setTimeout(function () {
          if (typeof window.show === 'function') window.show(target);
        }, 0);
      }
      if (wantsRadio) {
        window.setTimeout(function () {
          var radioButton = document.getElementById('quranRadioButton');
          var panel = document.getElementById('quranRadioPanel');
          if (radioButton && panel && panel.hidden) radioButton.click();
          scrollToNode(panel || radioButton);
        }, 0);
      }
    }
  }

  function initScrollSpy() {
    if (isAppPage() || !('IntersectionObserver' in window)) return;
    var map = { top: 'home', library: 'library', forum: 'forum', contact: 'contact' };
    var observer = new IntersectionObserver(function (entries) {
      var best = null;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
      });
      if (best && map[best.target.id]) updateActiveNav(map[best.target.id]);
    }, { rootMargin: '-40% 0px -50% 0px', threshold: [0, 0.2, 0.6] });

    Object.keys(map).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) observer.observe(node);
    });
  }

  function init() {
    hydrateLinks();
    renderSocial();
    renderDoctor();
    renderLive();
    renderForum();
    renderNotes();
    initSupport();
    installShowWrapper();
    initAppNavigation();
    initScrollSpy();
    updateActiveNav('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
