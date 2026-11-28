(function (root) {
  'use strict';
  function text(value) {
    return String(value == null ? '' : value).normalize('NFKD')
      .replace(/[\u064B-\u065F\u0670]/g, '').replace(/\u0640/g, '')
      .toLocaleLowerCase('ar').trim();
  }
  function unique(values) {
    var seen = new Set();
    return values.filter(function (value) {
      var key = text(value);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function search(items, query) {
    var needle = text(query);
    if (!needle) return items.slice();
    return items.filter(function (item) {
      return [item.title, item.sheikh, item.lecturer, item.author,
        item.description, item.category, item.categoryName]
        .some(function (value) { return text(value).includes(needle); });
    });
  }
  function filterSort(items, filters) {
    filters = filters || {};
    var result = search(items, filters.query || '').filter(function (item) {
      var categoryOk = !filters.category || filters.category === 'all' ||
        text(item.category) === text(filters.category);
      var sheikh = item.sheikh || item.lecturer || item.author || '';
      var sheikhOk = !filters.sheikh || filters.sheikh === 'all' ||
        text(sheikh) === text(filters.sheikh);
      return categoryOk && sheikhOk;
    });
    result.sort(function (a, b) {
      if (filters.sort === 'name') return text(a.title).localeCompare(text(b.title), 'ar');
      var aDate = Date.parse(a.uploadedAt || a.created_at || a.starts_at || '') || 0;
      var bDate = Date.parse(b.uploadedAt || b.created_at || b.starts_at || '') || 0;
      return bDate - aDate;
    });
    return result;
  }
  function mediaType(item) {
    var kind = text(item && item.kind);
    var mime = text(item && item.mimeType);
    var url = text(item && (item.recording_url || item.stream_url || item.url || item.fileName));
    if (kind === 'audio' || mime.indexOf('audio/') === 0 || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])/.test(url)) return 'audio';
    if (kind === 'video' || mime.indexOf('video/') === 0 || /\.(mp4|m4v|webm|mov|m3u8|mpd)(?:$|[?#])/.test(url) || /youtube\.com|youtu\.be|vimeo\.com/.test(url)) return 'video';
    return 'document';
  }
  function durationLabel(item) {
    var seconds = Number(item && (item.durationSeconds || item.duration_seconds));
    if (!Number.isFinite(seconds) || seconds <= 0) {
      var raw = item && item.duration;
      return raw == null || raw === '' ? 'غير محددة' : String(raw);
    }
    var minutes = Math.floor(seconds / 60), remainder = Math.round(seconds % 60);
    return minutes + ':' + String(remainder).padStart(2, '0');
  }
  async function fetchList(fetchImpl, url) {
    var response = await fetchImpl(url, { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!response || !response.ok) throw new Error('Public list request failed');
    var result = await response.json();
    if (!result || !Array.isArray(result.items)) throw new Error('Invalid public list response');
    return result.items;
  }
  function progressKey(id) { return 'haress-media-progress-v1:' + String(id || ''); }
  function safeUrl(value) {
    try {
      var url = new URL(String(value || ''), root && root.location ? root.location.origin : 'https://haress.invalid');
      return url.protocol === 'https:' || url.origin === (root && root.location ? root.location.origin : 'https://haress.invalid') ? url.href : '';
    } catch (error) { return ''; }
  }
  var api = { text: text, unique: unique, search: search, filterSort: filterSort,
    mediaType: mediaType, durationLabel: durationLabel, progressKey: progressKey, safeUrl: safeUrl, fetchList: fetchList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HaressLibraryMedia = api;
})(typeof window !== 'undefined' ? window : globalThis);
