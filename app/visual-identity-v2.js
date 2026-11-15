/* Haress V2 visual controller: theme + restrained reveal motion only. */
(function () {
  'use strict';
  var root = document.documentElement;
  var storageKey = 'hares-ui-theme';
  var button;
  function readTheme() {
    try { return localStorage.getItem(storageKey) || 'dark'; }
    catch (_) { return 'dark'; }
  }
  function applyTheme(theme) {
    var dark = theme !== 'light';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#11100f' : '#eee8dc');
    if (button) {
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي');
      button.textContent = dark ? 'الوضع النهاري' : 'الوضع الليلي';
    }
    try { localStorage.setItem(storageKey, dark ? 'dark' : 'light'); } catch (_) {}
  }
  function initMotion() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var nodes = document.querySelectorAll('.content-frame, .feature-panel, .library-masthead, .consultation-intro');
    nodes.forEach(function (node) { node.classList.add('motion-reveal'); });
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (node) { node.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
    nodes.forEach(function (node) { observer.observe(node); });
  }
  function init() {
    button = document.getElementById('themeToggle');
    applyTheme(readTheme());
    if (button) button.addEventListener('click', function () {
      applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    initMotion();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();