/* أهل الأثر: cache only the local app shell and static files.
   Authenticated/API and third-party responses are deliberately never cached. */
'use strict';

var CACHE_NAME = 'ahl-athar-v5';
var APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './identity-tokens.css',
  './identity-v2.css'
];
var STATIC_FILE = /\.(?:css|js|mjs|json|svg|png|jpe?g|webp|ico|woff2?|ttf|eot)$/i;
/* Mutable frontend assets (JS/CSS) must be revalidated on every load so a
   returning visitor can never stay pinned to a stale cached copy. */
var MUTABLE_FILE = /\.(?:css|js|mjs)$/i;

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys
      .filter(function (key) {
        return key.indexOf('ahl-athar-') === 0 && key !== CACHE_NAME;
      })
      .map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET' ||
      request.headers.has('authorization') ||
      request.headers.has('range') ||
      request.cache === 'no-store') {
    return;
  }

  var url = new URL(request.url);
  var appScope = new URL(self.registration.scope);

  // Never intercept third-party requests or URLs outside this app's scope.
  if (url.origin !== self.location.origin ||
      url.pathname.indexOf(appScope.pathname) !== 0) {
    return;
  }

  // API responses can contain private or rapidly changing user data.
  if (url.pathname.indexOf('/api/') !== -1 || /\/api$/.test(url.pathname)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async function () {
      var cache = await caches.open(CACHE_NAME);
      var shellUrl = new URL('index.html', appScope).href;
      try {
        var response = await fetch(request);
        if (response.ok && response.status === 200 && response.type === 'basic') {
          await cache.put(shellUrl, response.clone());
        }
        return response;
      } catch (error) {
        return (await cache.match(shellUrl)) || new Response(
          'لا يوجد اتصال بالإنترنت. اتصل بالشبكة ثم أعد المحاولة.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Mutable frontend assets (JS/CSS) are revalidated on every load so a
  // returning visitor can never stay pinned to a stale cached copy. The cache
  // is only a fallback for offline use.
  if (MUTABLE_FILE.test(url.pathname)) {
    event.respondWith((async function () {
      var cache = await caches.open(CACHE_NAME);
      try {
        var fresh = await fetch(request);
        if (fresh.ok && fresh.status === 200 && fresh.type === 'basic') {
          await cache.put(request, fresh.clone()).catch(function () {});
        }
        return fresh;
      } catch (error) {
        var cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // Immutable static assets (images, fonts, and other static files) may be
  // served cache-first because their content does not change under one URL.
  if (!STATIC_FILE.test(url.pathname) || url.search) {
    return;
  }

  event.respondWith((async function () {
    var cache = await caches.open(CACHE_NAME);
    var cached = await cache.match(request);
    if (cached) return cached;

    var response = await fetch(request);
    if (response.ok && response.status === 200 && response.type === 'basic') {
      await cache.put(request, response.clone()).catch(function () {});
    }
    return response;
  })());
});
