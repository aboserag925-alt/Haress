'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDirectory = __dirname;
const html = fs.readFileSync(path.join(appDirectory, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(appDirectory, 'manifest.json'), 'utf8'));

test('provides an iOS home-screen icon and supported PWA metadata', function () {
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon\.png"/);

  const icon = fs.readFileSync(path.join(appDirectory, 'apple-touch-icon.png'));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 180);
  assert.equal(icon.readUInt32BE(20), 180);
  assert.ok(manifest.icons.some(function (entry) {
    return entry.src === 'apple-touch-icon.png' &&
      entry.sizes === '180x180' &&
      entry.type === 'image/png';
  }));
});

test('all PWA manifest and offline-cache files exist within the app', function () {
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  for (const entry of manifest.icons) {
    assert.ok(fs.existsSync(path.join(appDirectory, entry.src)), entry.src);
  }

  const worker = fs.readFileSync(path.join(appDirectory, 'sw.js'), 'utf8');
  assert.match(worker, /ahl-athar-v6/);
  assert.ok(fs.existsSync(path.join(appDirectory, 'offline.html')), 'offline.html exists');
  for (const asset of ['./index.html', './offline.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './share-1200x630.jpg', './istiraha.css', './brand-motion.css', './istiraha-content.js', './istiraha.js', './brand-intro.js', './live-client.js', './live.html', './live-admin.html']) {
    assert.ok(worker.includes("'" + asset + "'"), asset);
    assert.ok(fs.existsSync(path.join(appDirectory, asset.replace(/^\.\//, ''))), asset);
  }
});

test('SEO and security headers are present', function () {
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /application\/ld\+json/);
  const headersPath = path.join(appDirectory, '_headers');
  assert.ok(fs.existsSync(headersPath), '_headers exists');
  const headers = fs.readFileSync(headersPath, 'utf8');
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /Strict-Transport-Security/);
});

test('manual live UI only links to allowlisted HTTPS providers and does not embed streams', function () {
  const { allowedUrl } = require('./live-client');
  assert.equal(allowedUrl('https://www.tiktok.com/@example/live'), true);
  assert.equal(allowedUrl('https://evil.example/live'), false);
  assert.equal(allowedUrl('https://media.example.test/live', ['media.example.test']), true);
  assert.equal(allowedUrl('https://evil.example/live', ['media.example.test']), false);
  assert.equal(allowedUrl('http://www.tiktok.com/live'), false);
  const client = fs.readFileSync(path.join(appDirectory, 'live-client.js'), 'utf8');
  const livePage = fs.readFileSync(path.join(appDirectory, 'live.html'), 'utf8');
  const adminPage = fs.readFileSync(path.join(appDirectory, 'live-admin.html'), 'utf8');
  const homeLogic = fs.readFileSync(path.join(appDirectory, 'istiraha.js'), 'utf8');
  assert.match(client, /tiktok\.com/);
  assert.match(client, /facebook\.com/);
  assert.match(client, /t\.me/);
  assert.match(client, /url\.protocol === 'https:'/);
  assert.match(livePage, /rel="noopener noreferrer"/);
  assert.match(livePage, /60000/);
  assert.match(livePage, /visibilitychange/);
  assert.doesNotMatch(livePage, /<iframe/i);
  assert.doesNotMatch(adminPage, /<iframe/i);
  assert.match(adminPage, /api\/admin\/live/);
  assert.match(homeLogic, /live\.html/);
  assert.doesNotMatch(homeLogic + client + livePage + adminPage, /youtube|YOUTUBE_API_KEY|YOUTUBE_CHANNEL_ID/i);
});
