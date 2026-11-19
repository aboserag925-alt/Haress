'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDirectory = __dirname;
const html = fs.readFileSync(path.join(appDirectory, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(appDirectory, 'manifest.json'), 'utf8'));

test('PWA uses the approved shield and supported metadata', function () {
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="apple-touch-icon" href="icon\.svg"/);
  const icon = fs.readFileSync(path.join(appDirectory, 'icon.svg'), 'utf8');
  assert.match(icon, /حرس الحدود/);
  assert.match(icon, /#176b49/);
  assert.ok(manifest.icons.some(function (entry) {
    return entry.src === 'icon.svg' && entry.type === 'image/svg+xml';
  }));
  assert.equal(manifest.icons.some(function (entry) {
    return entry.src === 'apple-touch-icon.png';
  }), false);
});

test('PWA manifest and offline-cache shell files exist', function () {
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  for (const entry of manifest.icons) {
    assert.ok(fs.existsSync(path.join(appDirectory, entry.src)), entry.src);
  }
  const worker = fs.readFileSync(path.join(appDirectory, 'sw.js'), 'utf8');
  for (const asset of ['./index.html', './manifest.json', './icon.svg', './identity-tokens.css', './identity-v2.css']) {
    assert.ok(worker.includes("'" + asset + "'"), asset);
    assert.ok(fs.existsSync(path.join(appDirectory, asset.replace(/^\.\//, ''))), asset);
  }
  assert.equal(fs.existsSync(path.join(appDirectory, 'apple-touch-icon.png')), false);
});
