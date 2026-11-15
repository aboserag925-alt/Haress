/* Haress V2 — editorial motion and navigation choreography */
(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;

  function reveal() {
    var nodes = document.querySelectorAll(
      '.main-intro,.weekly-stage,.destination-index,.section-stage-heading,.section-stage>section,.colophon,.destination-link'
    );
    if (reduced || !('IntersectionObserver' in window)) {
      nodes.forEach(function (node) { node.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -42px 0px' });
    nodes.forEach(function (node, index) {
      node.classList.add('motion-reveal');
      if (node.classList.contains('destination-link')) {
        node.style.transitionDelay = Math.min(index * 55, 240) + 'ms';
      }
      observer.observe(node);
    });

    var schedule = document.getElementById('sched');
    if (schedule && 'MutationObserver' in window) {
      var childObserver = new MutationObserver(function () {
        schedule.querySelectorAll(':scope > .card:not(.motion-reveal)').forEach(function (card, index) {
          card.classList.add('motion-reveal');
          card.style.transitionDelay = Math.min(index * 65, 260) + 'ms';
          observer.observe(card);
        });
      });
      childObserver.observe(schedule, { childList: true });
    }
  }

  function createProgress() {
    var bar = document.createElement('div');
    bar.className = 'reading-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var value = max > 0 ? window.scrollY / max : 0;
      bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, value)) + ')';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  function addDepth() {
    if (reduced || window.innerWidth < 900) return;
    var art = document.querySelector('.opening-art');
    if (!art) return;
    var stage = document.querySelector('.opening-stage');
    stage.addEventListener('pointermove', function (event) {
      if (event.pointerType !== 'mouse') return;
      var rect = stage.getBoundingClientRect();
      var x = (event.clientX - rect.left) / rect.width - 0.5;
      var y = (event.clientY - rect.top) / rect.height - 0.5;
      art.style.transform = 'translate3d(' + (x * -10) + 'px,' + (y * -8) + 'px,0)';
    });
    stage.addEventListener('pointerleave', function () {
      art.style.transform = '';
    });
  }

  function syncNavigation() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('button[onclick*="show("]');
      if (!button) return;
      var match = button.getAttribute('onclick').match(/show\(['"]([^'"]+)['"]\)/);
      if (!match) return;
      var ids = { sched: 't1', prayers: 't2', qibla: 't3', adhkar: 't4', media: 't5', q: 't6', about: 't7', account: 't8' };
      var active = ids[match[1]];
      if (!active) return;
      document.querySelectorAll('.floating-index .tab').forEach(function (tab) {
        var selected = tab.id === active;
        tab.classList.toggle('on', selected);
        tab.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      root.setAttribute('data-active-section', match[1]);
    });
  }

  function boot() {
    reveal();
    createProgress();
    addDepth();
    syncNavigation();
    root.classList.add('haress-motion-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();