/* أهل الأثر — Next.js site service worker (Stage 1).
   New cache version, distinct from the legacy site's cache.
   Caches the local shell and static files only; /api/* and third-party
   responses are deliberately never cached. */
'use strict';

var CACHE_NAME = 'ahl-athar-web-v1';
var OFFLINE_URL = '/offline/';
var APP_FILES = ['/', OFFLINE_URL, '/manifest.webmanifest', '/icon.svg'];
var STATIC_FILE = /\.(?:css|js|mjs|wasm|txt|xml|json|svg|png|jpe?g|webp|ico|avif|woff2?|ttf|eot)$/i;

self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      var cache = await caches.open(CACHE_NAME);
      await Promise.all(APP_FILES.map(function (url) {
        return fetch(new Request(url, { cache: 'no-store' })).then(function (res) {
          if (res && (res.ok || res.type === 'opaqueredirect')) return cache.put(url, res.clone());
        }).catch(function () { /* a missing file must not block install */ });
      }));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    await Promise.all(names.map(function (name) {
      return name === CACHE_NAME ? Promise.resolve() : caches.delete(name);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // API mutations and other methods: network only.
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // third parties: network only.
  if (url.pathname.startsWith('/api/')) return;   // API responses: never cached.

  // Navigation: network first, fall back to the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async function () {
        var cache = await caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      })
    );
    return;
  }

  // Static assets: cache first, then network (and back-fill the cache).
  if (STATIC_FILE.test(url.pathname)) {
    event.respondWith(
      (async function () {
        var cache = await caches.open(CACHE_NAME);
        var cached = await cache.match(req);
        if (cached) return cached;
        var res = await fetch(req).catch(function () { return null; });
        if (res && res.ok) await cache.put(req, res.clone());
        return res || Response.error();
      })()
    );
  }
});
