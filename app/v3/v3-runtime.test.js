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


test('Reference-led identity loads one active stylesheet and preserves accessible themes', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'identity.css'), 'utf8');
  assert.match(html, /href="\/v3\/identity\.css\?v=\d+"/);
  assert.doesNotMatch(html, /href="\/v3\/v3\.css"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /focus-visible/);
  assert.match(css, /:root\[data-theme=dark\]/);
  assert.match(css, /\.discovery-grid\{display:grid;grid-template-columns:repeat\(2,/);
  assert.match(html, /<html lang="ar" dir="rtl"/);
  assert.match(html, /src="\/v3\/hero-featured\.jpg\?v=\d+"/);
  for (const target of ['sched','prayers','qibla','adhkar','media','q','about','account']) {
    assert.ok(html.includes('data-v3-target="' + target + '"'));
    assert.ok(html.includes('id="' + target + '"'));
  }
});

test('Identity offline shell caches the active stylesheet and project image', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /'\/v3\/identity\.css\?v=\d+'/);
  assert.match(sw, /'\/v3\/council\.jpg\?v=\d+'/);
  assert.doesNotMatch(sw, /'\/v3\/v3\.css'/);
  assert.match(sw, /perf-loading-20261128/);
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

test('library filters use the category ids the server sends (audio, video, books, images, other)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/data-media-category="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['all', 'audio', 'video', 'books', 'images', 'other']);
});

test('lectures request sends the public apikey when configured, like the legacy app', () => {
  const src = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.match(src, /AHL_SUPABASE_CONFIG\s*&&\s*window\.AHL_SUPABASE_CONFIG\.anonKey/);
  assert.match(src, /api\('\/api\/lectures'\)[^;]*apikey:\s*publishableKey/);
});

test('managed lectures show only in the schedule section and skip finished lectures', () => {
  const src = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.match(src, /managed\.hidden\s*=\s*!scheduleView/);
  assert.match(src, /new Date\(item\.starts_at\)\.getTime\(\)\s*>=\s*cutoff/);
});

test('radio never autoplays: init does not call play, only visitor clicks do', () => {
  const src = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.doesNotMatch(src, /sync\(\);\s*playCairo\(\);\s*\n\s*\}/);
  const legacy = fs.readFileSync(path.join(root, '..', 'app.js'), 'utf8');
  assert.doesNotMatch(legacy, /Best-effort autoplay/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /<audio[^>]*\bautoplay\b/i);
});

test('v3 service worker caches the adhan bundle and other page files from outside /v3/', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(sw, /'\/vendor\/adhan\.umd\.min\.js\?v=\d+'/);
  assert.match(html, /<script defer src="\/vendor\/adhan\.umd\.min\.js\?v=\d+"><\/script>/);
  assert.match(sw, /isExternal\(url\.pathname\)/);
  assert.match(sw, /perf-loading-20261128/);
  assert.ok(fs.existsSync(path.join(root, '..', 'vendor', 'adhan.umd.min.js')));
});

test('public lecture and library requests run in parallel and settle without no-store', () => {
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.match(runtime, /Promise\.all\(\[loadLectures\(\), loadLibrary\(\)\]\)/);
  assert.doesNotMatch(runtime, /fetch\(api\('\/api\/(?:lectures|library)'\),\s*\{\s*cache:\s*['"]no-store['"]/);
  assert.match(runtime, /لا توجد محاضرات منشورة حاليًا/);
  assert.match(runtime, /تعذر تحميل المحاضرات الآن/);
  assert.match(runtime, /تعذر تحميل المكتبة الآن/);
});

test('legacy public lecture and library reads also avoid forced no-store caching', () => {
  const legacy = fs.readFileSync(path.join(root, '..', 'app.js'), 'utf8');
  const runtimeConfig = fs.readFileSync(path.join(root, '..', 'runtime-config.js'), 'utf8');
  assert.doesNotMatch(legacy, /cache:\s*['"]no-store['"]/);
  assert.doesNotMatch(runtimeConfig, /cache:\s*['"]no-store['"]/);
});

test('archive, audio and video assets are deferred until their sections open', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="[^"]*\/archive\//);
  assert.match(runtime, /function loadArchiveAssets/);
  assert.match(runtime, /if \(id === 'archive'\) loadArchiveAssets\(\)/);
  assert.match(runtime, /if \(id === 'prayers'\) loadPrayerAudio\(\)/);
  assert.match(runtime, /data-src',api\(item\.url\)/);
  assert.match(runtime, /if \(id === 'media'\) loadLibrary\(\)\.then\(activateMediaSources\)/);
});

test('question section tells the visitor plainly that no answer can be sent to them', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="questionNoReply"[^>]*>[\s\S]*لا توجد حاليًا وسيلة لإرسال الجواب إليك/);
  assert.doesNotMatch(html, /اعتماد أي رد/);
});

test('public suggestion form validates, posts to the Edge Function and always restores its button', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'v3-runtime.js'), 'utf8');
  assert.match(html, /id="suggestions"/);
  assert.match(html, /id="sendSuggestionBtn"/);
  assert.match(runtime, /fetch\(api\('\/api\/suggestions'\)/);
  assert.match(runtime, /action:'suggestion'/);
  assert.match(runtime, /finally\s*\{[\s\S]*button\.disabled=false/);
  assert.match(runtime, /تم إرسال اقتراحك بنجاح/);
  assert.match(runtime, /تعذر الاتصال بالخدمة/);
});
