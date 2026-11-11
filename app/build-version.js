(function () {
  'use strict';
  var target = document.getElementById('buildVersion');
  if (!target) return;
  fetch('./version.json', { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(function (response) { if (!response.ok) throw new Error('version-unavailable'); return response.json(); })
    .then(function (data) {
      if (typeof data.version !== 'string' || typeof data.sha !== 'string') return;
      target.textContent = 'الإصدار ' + data.version + ' · ' + data.sha;
      target.hidden = false;
    })
    .catch(function () { target.hidden = true; });
})();
