(function (root) {
  'use strict';
  // Accept identifiers only from known YouTube URL shapes. Never inject embed HTML.
  function parse(value) {
    var url;
    try { url = new URL(value); } catch (e) { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    var host = url.hostname.toLowerCase();
    var allowed = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com'];
    if (allowed.indexOf(host) < 0) return null;
    var parts = url.pathname.split('/').filter(Boolean), video = '', list = '';
    if (host === 'youtu.be') {
      if (parts.length !== 1) return null;
      video = parts[0];
    } else if (url.pathname === '/watch') {
      video = url.searchParams.get('v') || '';
      list = url.searchParams.get('list') || '';
    } else if (url.pathname === '/playlist') {
      list = url.searchParams.get('list') || '';
    } else if (parts.length === 2 && ['embed', 'shorts', 'live'].indexOf(parts[0]) >= 0) {
      if (parts[1] === 'videoseries' && parts[0] === 'embed') list = url.searchParams.get('list') || '';
      else video = parts[1];
    } else return null;
    if (video && !/^[A-Za-z0-9_-]{11}$/.test(video)) return null;
    if (list && !/^[A-Za-z0-9_-]{10,100}$/.test(list)) return null;
    if (!video && !list) return null;
    var embed = 'https://www.youtube-nocookie.com/embed/' + (video || 'videoseries');
    if (list) embed += '?list=' + encodeURIComponent(list);
    return { video: video, playlist: list, embed: embed, original: url.href };
  }
  var api = Object.freeze({ parse: parse });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HaressYouTube = api;
})(typeof window !== 'undefined' ? window : globalThis);
