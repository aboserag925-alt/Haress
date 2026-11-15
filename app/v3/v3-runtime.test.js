'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (entry.isFile() && /\.(?:html|js|css|json)$/i.test(entry.name) && !entry.name.endsWith('.test.js')) return [full];
    return [];
  });
}

test('V3.2 runtime is independent from the legacy application entry point', () => {
  const files = sourceFiles(root);
  assert.ok(files.includes(path.join(root, 'v3-runtime.js')), 'native V3 runtime module must exist');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /\/v3\/v3-runtime\.js/, 'V3.2 page must load its own runtime');
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.toLowerCase().includes('/app.js'), false,
      path.relative(process.cwd(), file) + ' must not reference the legacy app entry point');
    assert.doesNotMatch(source, /(?:\/app|app)\s*['"]?\s*\+\s*['"]\.js/i, 'must not construct the legacy app path from fragments');
  }
});

test('V3.2 adapter is a passive native boundary, not a script loader', () => {
  const adapter = fs.readFileSync(path.join(root, 'v3-adapter.js'), 'utf8');
  assert.doesNotMatch(adapter, /createElement\s*\(\s*['"]script['"]\s*\)/i);
  assert.doesNotMatch(adapter, /\b(?:fetch|importScripts)\s*\(/i);
  assert.match(adapter, /runtime:\s*['"]native['"]/);
});

test('V3.2 native runtime owns required feature entry points', () => {
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.match(runtime, /register\(['"]\/v3\/sw\.js['"],\s*\{scope:['"]\/v3\/['"]\}\)/, 'V3.2 must register its own scoped service worker');
  for (const marker of [
    'function renderSchedule', 'function renderProgramTimeline', 'function navigate',
    'function initRadio', 'function updatePrayerTimes', 'function updateQibla',
    'function renderAdhkar', 'async function loadLibrary', 'async function sendQuestion',
    'function initAuth', 'function saveLocation', 'function locate',
    'beforeinstallprompt', 'function scheduleSync', 'function renderHomePrayerDashboard',
    'function renderProgramLectures'
  ]) assert.ok(runtime.includes(marker), 'missing native feature: ' + marker);
});

test('V3.2 design system preserves the approved identity and reduced-motion support', () => {
  const css = fs.readFileSync(path.join(root, 'v3.css'), 'utf8');
  assert.match(css, /--color-ivory:/, 'V3.2 ivory token must be present');
  assert.match(css, /--color-forest:/, 'V3.2 forest-green identity must remain');
  assert.match(css, /--color-bronze:/, 'V3.2 bronze accent must remain');
  assert.match(css, /--color-ink:/, 'V3.2 ink token must be present');
  assert.match(css, /--text-display:/, 'V3.2 Arabic display type scale must be present');
  assert.match(css, /--motion:/, 'V3.2 motion token must be present');
  assert.match(css, /prefers-reduced-motion:\s*reduce/, 'motion must respect reduced-motion preferences');
  assert.match(css, /@media \(min-width: 900px\)/, 'desktop breakpoint must be present');
  assert.match(css, /@media \(max-width: 680px\)/, 'mobile breakpoint must be present');
  assert.match(css, /bottom-nav/, 'mobile bottom navigation must be present');
  assert.match(css, /media-detail-panel/, 'media detail panel must be present');
  assert.match(css, /prayer-dash/, 'prayer dashboard must be present');
  assert.match(css, /sections-grid/, 'site sections grid must be present');
  assert.match(css, /library-shell/, 'library shell must be present');
  assert.match(css, /radio-console/, 'quran radio console must be present');
  assert.match(css, /compass-scene/, 'qibla compass scene must be present');
  assert.match(css, /consultation-card/, 'consultation card must be present');
  assert.match(css, /data-theme='dark'|\[data-theme='dark'\]/, 'dark mode must be defined');
});

test('V3.2 page has no root base URL and keeps fragment navigation local', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(html.includes('<base href="/">'), false);
  assert.match(html, /href=["']#main["']/);
  assert.equal(html.includes('/app.js'), false, 'index.html must not load /app.js');
});

test('V3 service worker cache namespace is isolated from legacy cleanup', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /CACHE_NAMESPACE\s*=\s*['"]haress-v3-cache-/);
  assert.doesNotMatch(sw, /CACHE_NAMESPACE\s*=\s*['"]ahl-athar-/);
  assert.match(sw, /key\.indexOf\(CACHE_NAMESPACE\)/);
  assert.equal(sw.includes('ahl-athar-'), false);
});

test('blocked localStorage is handled without throwing during storage access', () => {
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.match(runtime, /function safeStorage\(\)\s*\{\s*try\s*\{\s*return window\.localStorage;\s*\}\s*catch/);
  assert.match(runtime, /function readStore\(key\)/);
  assert.match(runtime, /function store\(key, value\)/);
  assert.doesNotMatch(runtime, /localStorage\.(?:getItem|setItem|length|key)\s*(?:\(|\b)/);
  const vm = require('node:vm');
  const helperStart = runtime.indexOf('  function safeStorage()');
  const helperEnd = runtime.indexOf('  function cairoClock()', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const sandbox = { window: Object.defineProperty({}, 'localStorage', { get() { throw new Error('blocked'); } }) };
  vm.runInNewContext(runtime.slice(helperStart, helperEnd), sandbox);
  assert.equal(sandbox.safeStorage(), null);
  assert.equal(sandbox.readStore('key'), null);
  assert.equal(sandbox.store('key', 'value'), false);
});

test('V3.2 index.html contains all primary interactive views', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const id of ['view-home','view-program','view-library','view-prayers','view-qibla','view-adhkar','view-questions','view-account']) {
    assert.ok(html.includes('id="'+id+'"'), 'view ' + id + ' must exist in index.html');
  }
  assert.ok(html.includes('data-v3-target="library"'), 'library nav target must exist');
  assert.ok(html.includes('bottom-nav'), 'mobile bottom nav must exist');
});

test('V3.2 runtime and page remain independent from /app.js', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'v3.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'v3.js'), 'utf8');
  assert.equal((html + runtime + css + js).includes('/app.js'), false);
});
