(function () {
  'use strict';
  var KEY = 'haress-nudge-preferences-v1';
  var state = { disabled: false, dismissed: [] };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    state.disabled = saved.disabled === true;
    state.dismissed = Array.isArray(saved.dismissed) ? saved.dismissed : [];
  } catch (_) {}
  if (state.disabled) return;

  var tips = [
    { id: 'library', title: 'ابدأ رحلتك من المكتبة العلمية', body: 'يمكنك الوصول إلى المواد والدروس العلمية من قسم المكتبة.', target: '#library, [data-tab="library"], #media' },
    { id: 'radio', title: 'استمع إلى إذاعة القرآن الكريم', body: 'انتقل إلى قسم الإذاعة للاستماع إلى التلاوة.', target: '#radio, [data-tab="radio"], #quranRadio' },
    { id: 'dialogue', title: 'شارك في الحوار بأدب العلم', body: 'تعرّف على قسم المناقشات والحوار عندما يكون متاحًا.', target: '#discussions, #forum, [data-tab="discussions"]' },
    { id: 'account', title: 'احفظ تجربتك بتسجيل الدخول', body: 'يمكنك تسجيل الدخول للوصول إلى المزايا المرتبطة بحسابك.', target: '#account, #auth, [data-tab="account"]' }
  ];
  var current = 0;
  var root, panel, message, title, body, action, status;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }
  function availableTip() {
    for (var i = 0; i < tips.length; i++) {
      var index = (current + i) % tips.length;
      if (state.dismissed.indexOf(tips[index].id) === -1) {
        current = index;
        return tips[index];
      }
    }
    return null;
  }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function render() {
    var tip = availableTip();
    if (!tip) {
      title.textContent = 'أنت تتحكم في تجربتك';
      body.textContent = 'انتهت التلميحات الحالية. يمكنك إعادة تفعيلها من إعدادات المساعد.';
      action.hidden = true;
      status.textContent = '';
      return;
    }
    title.textContent = tip.title;
    body.textContent = tip.body;
    action.hidden = false;
    action.textContent = 'اعرض القسم';
    action.onclick = function () {
      var target = document.querySelector(tip.target);
      if (target) {
        var tab = target.matches('[data-tab]') ? target : target.closest('[data-tab]');
        if (tab) tab.click();
        target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        status.textContent = 'تم توجيهك إلى القسم.';
      } else {
        status.textContent = 'هذا القسم غير ظاهر حاليًا؛ يمكنك الوصول إليه من قائمة الأقسام.';
      }
    };
  }
  function close() {
    panel.hidden = true;
    root.querySelector('.haress-nudge-launcher').setAttribute('aria-expanded', 'false');
  }
  function mount() {
    if (document.getElementById('haressNudge')) return;
    root = element('div', 'haress-nudge');
    root.id = 'haressNudge';
    var launcher = element('button', 'haress-nudge-launcher', 'كيف أبدأ؟');
    launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'haressNudgePanel');
    launcher.setAttribute('aria-label', 'افتح مرشد استخدام المنصة');
    panel = element('section', 'haress-nudge-panel');
    panel.id = 'haressNudgePanel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'haressNudgeTitle');
    var head = element('div', 'haress-nudge-head');
    var headingWrap = element('div', 'haress-nudge-heading');
    headingWrap.appendChild(element('span', 'haress-nudge-eyebrow', 'مرشد المنصة'));
    title = element('h2', '', 'أهلًا بك في استراحة أهل الأثر');
    title.id = 'haressNudgeTitle';
    headingWrap.appendChild(title);
    var closeButton = element('button', 'haress-nudge-close', 'إغلاق');
    closeButton.type = 'button';
    closeButton.addEventListener('click', close);
    head.append(headingWrap, closeButton);
    body = element('p', 'haress-nudge-copy', 'اختر ما تريد استكشافه، وسنرشدك إلى المكان المناسب.');
    action = element('button', 'haress-nudge-action', 'ابدأ');
    action.type = 'button';
    status = element('p', 'haress-nudge-status', '');
    status.setAttribute('role', 'status');
    var controls = element('div', 'haress-nudge-controls');
    var next = element('button', 'haress-nudge-secondary', 'تلميح آخر');
    next.type = 'button';
    next.addEventListener('click', function () { current = (current + 1) % tips.length; render(); });
    var stop = element('button', 'haress-nudge-secondary', 'إيقاف التلميحات');
    stop.type = 'button';
    stop.addEventListener('click', function () {
      state.disabled = true;
      save();
      root.remove();
    });
    controls.append(next, stop);
    panel.append(head, body, action, status, controls);
    launcher.addEventListener('click', function () {
      var opening = panel.hidden;
      panel.hidden = !opening;
      launcher.setAttribute('aria-expanded', String(opening));
      if (opening) { render(); closeButton.focus(); }
    });
    root.append(launcher, panel);
    document.body.appendChild(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();