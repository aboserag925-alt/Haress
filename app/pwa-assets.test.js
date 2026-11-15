'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDirectory = __dirname;
const html = fs.readFileSync(path.join(appDirectory, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(appDirectory, 'manifest.json'), 'utf8'));
const rootHtml = fs.readFileSync(path.join(appDirectory, '..', 'index.html'), 'utf8');
const identityCss = fs.readFileSync(path.join(appDirectory, 'interactive-identity.css'), 'utf8');

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
  for (const asset of ['./index.html', './manifest.json', './icon.svg']) {
    assert.ok(worker.includes("'" + asset + "'"), asset);
    assert.ok(fs.existsSync(path.join(appDirectory, asset.replace(/^\.\//, ''))), asset);
  }
});

test('keeps the approved light identity and top-level radio/login actions', function () {
  assert.equal(manifest.background_color, '#f6faf6');
  assert.equal(manifest.theme_color, '#f6faf6');
  assert.match(html, /id="quranRadioButton"/);
  assert.match(html, /class="social-link login-launch"/);
  const radioIndex = html.indexOf('id="quranRadioButton"');
  const tabsIndex = html.indexOf('<nav class="tabs"');
  assert.ok(radioIndex >= 0 && tabsIndex > radioIndex, 'radio action belongs in the app header, before the section tabs');
  assert.match(rootHtml, /assets\/brand-mark-light\.svg/);
  assert.doesNotMatch(html, /\\\\n/, 'app HTML must not contain literal newline escapes');
  assert.doesNotMatch(rootHtml, /\\\\n/, 'root HTML must not contain literal newline escapes');
  assert.doesNotMatch(identityCss, /\\\\n/, 'identity CSS must not contain literal newline escapes');
});
