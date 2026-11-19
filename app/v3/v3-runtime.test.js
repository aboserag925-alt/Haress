'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const forbidden = ['app', '.js'].join('');
const concatenatedLegacyPath = /(?:\/app|app)\s*['"]?\s*\+\s*['"]\.js/i;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (entry.isFile() && /\.(?:html|js|css|json)$/i.test(entry.name) && !entry.name.endsWith('.test.js')) return [full];
    return [];
  });
}

test('V3.1 runtime is independent from the legacy application entry point', () => {
  const files = sourceFiles(root);
  assert.ok(files.includes(path.join(root, 'v3-runtime.js')), 'native V3 runtime module must exist');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /\/v3\/v3-runtime\.js/, 'V3.1 page must load its own runtime');
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.toLowerCase().includes(forbidden), false,
      path.relative(process.cwd(), file) + ' must not reference the legacy app entry point');
    assert.doesNotMatch(source, concatenatedLegacyPath, 'must not construct the legacy app path from fragments');
  }
});

test('V3.1 adapter is a passive native boundary, not a script loader', () => {
  const adapter = fs.readFileSync(path.join(root, 'v3-adapter.js'), 'utf8');
  assert.doesNotMatch(adapter, /createElement\s*\(\s*['"]script['"]\s*\)/i);
  assert.doesNotMatch(adapter, /\b(?:fetch|importScripts)\s*\(/i);
  assert.match(adapter, /runtime:\s*['"]native['"]/);
});

test('V3 native runtime owns required feature entry points', () => {
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.match(runtime, /register\(['"]\/v3\/sw\.js['"],\s*\{scope:['"]\/v3\/['"]\}\)/, 'V3.1 must register its own scoped service worker');
  for (const marker of [
    'function renderSchedule', 'function navigate', 'function initRadio',
    'function updatePrayerTimes', 'function updateQibla', 'function renderAdhkar',
    'async function loadLibrary', 'async function sendQuestion', 'function initAuth',
    'beforeinstallprompt', 'function scheduleSync'
  ]) assert.ok(runtime.includes(marker), 'missing native feature: ' + marker);
});


test('V3.1 design system preserves the approved identity and reduced-motion support', () => {
  const css = fs.readFileSync(path.join(root, 'v3.css'), 'utf8');
  assert.match(css, /--v31-space-1:/, 'V3.1 spacing tokens must be present');
  assert.match(css, /--v31-text-display:/, 'V3.1 Arabic type scale must be present');
  assert.match(css, /--v31-motion:/, 'V3.1 motion token must be present');
  assert.match(css, /prefers-reduced-motion:\s*reduce/, 'motion must respect reduced-motion preferences');
  assert.ok(css.includes("--paper:var(--v2-bg)"), "V3 canvas must use shared V2 tokens");
  assert.ok(css.includes("--forest:var(--v2-green)"), "V3 green must use shared V2 tokens");
  assert.ok(css.includes("--bronze:var(--v2-gold)"), "V3 gold must use shared V2 tokens");
  assert.doesNotMatch(css, /IBM Plex Sans Arabic|#f4f0e6|#183d31|#9a7042/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /class="identity-v2"/);
  assert.ok(html.includes('href="/identity-tokens.css"'));
  assert.ok(html.includes('href="/identity-tokens.css"'));
  assert.ok(html.includes('href="/identity-v2.css"'));
  assert.ok(html.includes('class="brand-shield" src="/icon.svg"'));
  assert.ok(html.includes("family=Noto+Naskh+Arabic"));
});

test('V3.1 page has no root base URL and keeps fragment navigation local', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(html.includes('<base href="/">'), false);
  assert.match(html, /href=["']#main["']/);
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

test('V3.1 runtime and page remain independent from /app.js', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.equal((html + runtime).includes('/app.js'), false);
});

test('account recovery exposes reset and update actions and handles the recovery event', () => {
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const authClient = fs.readFileSync(path.join(root, '..', '..', 'src', 'auth-client.js'), 'utf8');
  for (const id of ['resetPasswordBtn', 'passwordResetPanel', 'newAuthPassword', 'updatePasswordBtn']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing recovery UI element: ' + id);
  }
  assert.match(runtime, /info\.event===['"]PASSWORD_RECOVERY['"]/);
  assert.match(runtime, /\$\(['"]resetPasswordBtn['"]\)\.addEventListener/);
  assert.match(runtime, /\$\(['"]updatePasswordBtn['"]\)\.addEventListener/);
  assert.match(authClient, /auth\.resetPasswordForEmail\(email,\s*\{\s*redirectTo:\s*redirectTo\s*\}\)/);
  assert.match(authClient, /auth\.updateUser\(\{\s*password:\s*password\s*\}\)/);
});

test('V3 PWA manifest and service worker use the shared identity cache generation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background_color, '#f5f9f5');
  assert.equal(manifest.theme_color, '#f5f9f5');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /identity-v2/);
  assert.ok(sw.includes("'/identity-tokens.css'"));
  assert.ok(sw.includes("'/identity-v2.css'"));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('href="/identity-v2.css"'));
});

