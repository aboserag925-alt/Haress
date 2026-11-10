(function (root) {
  'use strict';
  var allowedHosts = ['tiktok.com', 'facebook.com', 't.me'];
  function allowedUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password &&
        (!url.port || url.port === '443') &&
        allowedHosts.some(function (host) { return url.hostname === host || url.hostname.endsWith('.' + host); });
    } catch (_) { return false; }
  }
  function api(path) {
    var base = typeof root.AHL_API_BASE_URL === 'string' ? root.AHL_API_BASE_URL.replace(/\/+$/, '') : '';
    return base + path;
  }
  async function getState() {
    var response = await fetch(api('/api/live/state'), { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('تعذر قراءة حالة البث.');
    var data = await response.json();
    if (data.stream_url && !allowedUrl(data.stream_url)) data.stream_url = null;
    return data;
  }
  root.AHL_LIVE = Object.freeze({ allowedUrl: allowedUrl, getState: getState, api: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = { allowedUrl: allowedUrl };
})(typeof window !== 'undefined' ? window : globalThis);
