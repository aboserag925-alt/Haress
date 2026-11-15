'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const forbidden = ['/', 'app', '.js'].join('');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (entry.isFile() && /\.(?:html|js|css|json)$/i.test(entry.name) && !entry.name.endsWith('.test.js')) return [full];
    return [];
  });
}

test('V3 runtime is independent from the legacy application entry point', () => {
  const files = sourceFiles(root);
  assert.ok(files.includes(path.join(root, 'v3-runtime.js')), 'native V3 runtime module must exist');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /\/v3\/v3-runtime\.js/, 'V3 page must load its own runtime');
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes(forbidden), false,
      path.relative(process.cwd(), file) + ' must not reference the legacy app entry point');
  }
});

test('V3 adapter is a passive native boundary, not a script loader', () => {
  const adapter = fs.readFileSync(path.join(root, 'v3-adapter.js'), 'utf8');
  assert.doesNotMatch(adapter, /createElement\s*\(\s*['"]script['"]\s*\)/i);
  assert.doesNotMatch(adapter, /\b(?:fetch|importScripts)\s*\(/i);
  assert.match(adapter, /runtime:\s*['"]native['"]/);
});

test('V3 native runtime owns required feature entry points', () => {
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  for (const marker of [
    'function renderSchedule', 'function navigate', 'function initRadio',
    'function updatePrayerTimes', 'function updateQibla', 'function renderAdhkar',
    'async function loadLibrary', 'async function sendQuestion', 'function initAuth',
    'beforeinstallprompt', 'function scheduleSync'
  ]) assert.ok(runtime.includes(marker), 'missing native feature: ' + marker);
});
