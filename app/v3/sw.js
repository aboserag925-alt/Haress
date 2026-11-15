'use strict';
var CACHE_NAMESPACE = 'haress-v3-cache-';
var CACHE_NAME = CACHE_NAMESPACE + 'native-v3.2';
var SHELL = [
  '/v3/',
  '/v3/index.html',
  '/v3/v3.css',
  '/v3/v3.js',
  '/v3/v3-runtime.js',
  '/v3/v3-adapter.js',
  '/v3/manifest.json'
];
self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (key) {
      return key.indexOf(CACHE_NAMESPACE) === 0 && key !== CACHE_NAME;
    }).map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization') ||
      request.headers.has('range') || request.cache === 'no-store') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf('/v3/') !== 0 ||
      url.pathname.indexOf('/api/') !== -1) return;
  if (request.mode === 'navigate') {
    event.respondWith((async function () {
      try {
        var fresh = await fetch(request);
        if (fresh.ok) {
          var cache = await caches.open(CACHE_NAME);
          await cache.put('/v3/index.html', fresh.clone());
        }
        return fresh;
      } catch (error) {
        var cache = await caches.open(CACHE_NAME);
        return (await cache.match('/v3/index.html')) || new Response('لا يوجد اتصال بالإنترنت.', { status:503 });
      }
    })());
    return;
  }
  if (/\.(?:css|js|json)$/i.test(url.pathname)) {
    event.respondWith((async function () {
      var cache = await caches.open(CACHE_NAME);
      try {
        var fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone()).catch(function () {});
        return fresh;
      } catch (error) {
        var cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
  }
});
