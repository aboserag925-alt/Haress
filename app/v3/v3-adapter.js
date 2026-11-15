(function () {
  'use strict';
  var script = document.createElement('script');
  script.src = '/app.js';
  script.async = false;
  script.onload = function () {
    var nav = document.querySelectorAll('[data-v3-target]');
    nav.forEach(function (button) {
      button.addEventListener('click', function () {
        var target = button.getAttribute('data-v3-target');
        if (typeof window.show === 'function') window.show(target);
      });
    });
    var radioButton = document.getElementById('quranRadioButton');
    var radioPanel = document.getElementById('quranRadioPanel');
    if (radioButton && radioPanel) {
      radioButton.addEventListener('click', function () {
        window.setTimeout(function () {
          if (!radioPanel.hidden) radioPanel.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            block: 'nearest'
          });
        }, 0);
      });
    }
    window.dispatchEvent(new CustomEvent('haress-v3:ready'));
  };
  script.onerror = function () {
    var status = document.getElementById('authMessage');
    if (status) status.textContent = 'تعذر تحميل طبقة وظائف المجلس. أعد تحميل الصفحة.';
    document.body.classList.add('v3-adapter-error');
  };
  document.head.appendChild(script);

  window.copySupportNumber = async function (button) {
    var number = button && button.getAttribute('data-support-number');
    if (!number) return;
    var feedback = button.parentElement && button.parentElement.parentElement.querySelector('.copy-feedback');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(number);
      else {
        var field = document.createElement('textarea');
        field.value = number;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        var copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('copy-unavailable');
      }
      if (feedback) feedback.textContent = 'تم نسخ رقم فودافون كاش.';
    } catch (error) {
      if (feedback) feedback.textContent = 'تعذر النسخ. يمكنك نسخ الرقم يدويًا.';
    }
  };
})();
