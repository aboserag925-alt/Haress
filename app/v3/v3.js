(function () {
  'use strict';
  var root = document.documentElement;
  var themeButton = document.querySelector('[data-v3-theme-toggle]');
  var navButtons = Array.prototype.slice.call(document.querySelectorAll('[data-v3-target]'));
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (themeButton) {
      themeButton.setAttribute('aria-label', theme === 'dark' ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الداكن');
      themeButton.textContent = theme === 'dark' ? '◐' : '◑';
    }
    try { localStorage.setItem('haress-v3-theme', theme); } catch (error) {}
  }

  try {
    var saved = localStorage.getItem('haress-v3-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  } catch (error) {}

  if (themeButton) themeButton.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  navButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var target = button.getAttribute('data-v3-target');
      if (typeof window.show === 'function') window.show(target);
      else window.dispatchEvent(new CustomEvent('haress-v3:navigate', { detail: target }));
    });
  });

  document.querySelectorAll('[data-v3-target="q"]').forEach(function (button) {
    button.addEventListener('click', function () {
      var textarea = document.getElementById('qt');
      if (textarea) window.setTimeout(function () { textarea.focus({ preventScroll: true }); }, reducedMotion ? 0 : 260);
    });
  });

  window.addEventListener('haress-v3:ready', function () {
    document.body.classList.add('v3-ready');
    var opening = document.querySelector('.opening');
    if (opening && !reducedMotion) opening.classList.add('is-revealed');
  });
  window.HaressV3 = { setTheme: setTheme, reducedMotion: reducedMotion };
})();
