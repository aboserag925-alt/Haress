(function () {
  'use strict';
  var root = document.documentElement;
  var themeButton = document.querySelector('[data-v3-theme-toggle]');
  var navButtons = Array.prototype.slice.call(document.querySelectorAll('[data-v3-target]'));
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var themeMeta = document.querySelector('meta[name="theme-color"]');

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#181818' : '#f3f3f3');
    if (themeButton) {
      themeButton.setAttribute('aria-label', theme === 'dark' ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الداكن');
      themeButton.textContent = theme === 'dark' ? '☼' : '◐';
    }
    try { localStorage.setItem('haress-v3-theme', theme); } catch (error) {}
  }

  try {
    var saved = localStorage.getItem('haress-v3-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
    else setTheme('dark');
  } catch (error) { setTheme('dark'); }

  if (themeButton) themeButton.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  function announceNavigation(button) {
    navButtons.forEach(function (item) {
      var active = item === button;
      if (item.classList.contains('nav-item')) {
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      }
    });
    if (button && button.classList.contains('nav-item') && window.matchMedia('(max-width: 680px)').matches) {
      button.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  navButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var target = button.getAttribute('data-v3-target');
      announceNavigation(button);
      window.dispatchEvent(new CustomEvent('haress-v3:navigate', { detail: target }));
    });
  });

  document.querySelectorAll('[data-v3-target="q"]').forEach(function (button) {
    button.addEventListener('click', function () {
      var textarea = document.getElementById('qt');
      if (textarea) window.setTimeout(function () { textarea.focus({ preventScroll: true }); }, reducedMotion ? 0 : 260);
    });
  });

  function revealEditorialContent() {
    if (reducedMotion || !('IntersectionObserver' in window)) {
      document.querySelectorAll('.scene,.section-heading,.next,.v3-timeline-entry,.v3-managed-entry').forEach(function (node) {
        node.classList.add('editorial-visible');
      });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('editorial-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -7% 0px', threshold: 0.08 });
    document.querySelectorAll('.scene,.section-heading,.next,.v3-timeline-entry,.v3-managed-entry').forEach(function (node) {
      node.classList.add('editorial-reveal');
      observer.observe(node);
    });
  }

  window.addEventListener('haress-v3:ready', function () {
    document.body.classList.add('v3-ready');
    revealEditorialContent();
  });
  window.HaressV3 = { setTheme: setTheme, reducedMotion: reducedMotion };
})();
