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
  assert.match(worker, /ahl-athar-v5/);
  assert.ok(fs.existsSync(path.join(appDirectory, 'offline.html')), 'offline.html exists');
  for (const asset of ['./index.html', './offline.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './share-1200x630.jpg', './istiraha.css', './brand-motion.css', './istiraha-content.js', './istiraha.js', './brand-intro.js']) {
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

test('live wiring uses safe /api/live without exposing keys', function () {
  const istiraha = fs.readFileSync(path.join(appDirectory, 'istiraha.js'), 'utf8');
  const content = fs.readFileSync(path.join(appDirectory, 'istiraha-content.js'), 'utf8');
  assert.ok(istiraha.includes('apiPath'), 'fetch uses apiPath');
  assert.ok(content.includes("apiPath: '/api/live'"), 'content apiPath retained for future opt-in');
  assert.ok(content.includes('autoDetect: false'), 'automatic live detection remains disabled');
  assert.ok(istiraha.includes('function isLiveDetectionEnabled() {') && istiraha.includes('cfg.live.autoDetect === true') && istiraha.includes('cfg.live.apiPath'), 'live detection requires explicit opt-in');
  assert.ok(istiraha.includes('function startLivePolling() {\n    if (!isLiveDetectionEnabled()) {') && istiraha.includes('      renderLive();\n      return;\n    }\n    checkLiveStatus();'), 'disabled detection exits before creating polling timers');
  assert.ok(!istiraha.match(/YOUTUBE_API_KEY/), 'no api key in frontend');
  assert.ok(istiraha.includes('noopener noreferrer'), 'external links gated');
});
