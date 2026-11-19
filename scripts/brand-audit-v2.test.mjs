import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, name));

test('all web surfaces share one V2 token source and component layer', () => {
  for (const file of ['app/index.html', 'app/admin.html', 'app/v3/index.html']) {
    assert.ok(read(file).includes('identity-tokens.css'), file + ' must load shared tokens');
    assert.ok(read(file).includes('identity-v2.css'), file + ' must load shared components');
  }
  assert.ok(exists('app/identity-tokens.css'));
  const tokens = read('app/identity-tokens.css');
  assert.match(tokens, /--v2-bg:#f5f9f5/);
  assert.match(tokens, /--v2-green:#176b49/);
  assert.match(tokens, /--v2-gold:#c5a04a/);
  assert.match(tokens, /--v2-font:"Noto Naskh Arabic"/);
  assert.match(tokens, /html\.identity-v2\[data-theme="dark"\]/);
  assert.doesNotMatch(read('app/identity-v2.css'), /--v2-bg:#f5f9f5|--v2-font:/);
});

test('main app and admin share V2 components without inline style layers', () => {
  const main = read('app/index.html');
  const admin = read('app/admin.html');
  assert.ok(main.includes('src="identity-v2.js"'));
  assert.ok(admin.includes('src="identity-v2.js"'));
  for (const html of [main, admin]) {
    assert.match(html, /family=Noto\+Naskh\+Arabic/);
    assert.doesNotMatch(html, /family=(?:Aref\+Ruqaa|Reem\+Kufi|Cairo|Amiri|IBM\+Plex)/i);
    assert.doesNotMatch(html, /font-family\s*:[^;]*(?:Aref Ruqaa|Reem Kufi|Cairo|Amiri|IBM Plex Sans Arabic)/i);
    assert.doesNotMatch(html, /<style\b|\sstyle\s*=/i);
  }
  assert.match(admin, /class="identity-v2 admin-v2"/);
  assert.match(read('app/identity-v2.css'), /html\.identity-v2\.admin-v2/);
});

test('V3 keeps its editorial layout but uses the shared V2 identity tokens', () => {
  const html = read('app/v3/index.html');
  const css = read('app/v3/v3.css');
  assert.match(html, /class="identity-v2"/);
  assert.ok(html.includes('href="/identity-tokens.css"'));
  assert.ok(html.includes('href="/identity-v2.css"'));
  assert.ok(html.includes('src="/icon.svg"'));
  assert.match(html, /family=Noto\+Naskh\+Arabic/);
  assert.doesNotMatch(html, /IBM\+Plex\+Sans\+Arabic|class="mark"/);
  assert.match(css, /--paper:var\(--v2-bg\)/);
  assert.match(css, /--forest:var\(--v2-green\)/);
  assert.match(css, /--bronze:var\(--v2-gold\)/);
  assert.doesNotMatch(css, /#f4f0e6|#183d31|#9a7042|IBM Plex Sans Arabic/);
});

test('approved shield is the only brand mark asset used by the application', () => {
  const icon = read('app/icon.svg');
  assert.match(icon, /حرس الحدود/);
  assert.match(icon, /#176b49/);
  assert.match(read('app/identity-v2.js'), /src="icon\.svg"/);
  assert.match(read('app/v3/index.html'), /src="\/icon\.svg"/);
  assert.doesNotMatch(read('app/identity-v2.js'), /brand-mark-light\.svg/);
});

test('identity behavior is scoped and respects reduced-motion preferences', () => {
  const html = read('app/index.html');
  assert.ok(html.includes('identity-v2.js'));
  const js = read('app/identity-v2.js');
  const css = read('app/identity-v2.css');
  assert.match(js, /root\.classList\.contains\('identity-v2'\)/);
  assert.match(js, /root\.querySelector\('\.wrap > header'\)/);
  assert.match(js, /root\.querySelector/);
  assert.doesNotMatch(js, /document\.querySelector/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
});

test('obsolete visual layers and prototypes are absent', () => {
  for (const file of [
    'app/brand-motion.css',
    'app/interactive-identity.css',
    'app/brand-intro.js',
    'app/interactive-identity.js',
    'assets/brand-mark-light.svg',
    'assets/logo.jpg',
    'screens/home.html',
    'screens/archive.html',
    'screens/schedule.html',
    'screens/section.html',
    '.github/workflows/pages.yml',
    'app/tailwind.css',
    'src/tailwind.css'
  ]) assert.equal(exists(file), false, file + ' must not be shipped');
  assert.doesNotMatch(read('app/index.html') + read('app/admin.html'),
    /brand-motion\.css|interactive-identity\.css|brand-intro\.js|tailwind\.css/);
});

test('PWA manifests and service workers use the current identity generation', () => {
  const main = JSON.parse(read('app/manifest.json'));
  const v3 = JSON.parse(read('app/v3/manifest.json'));
  assert.equal(main.background_color, '#f5f9f5');
  assert.equal(main.theme_color, '#f5f9f5');
  assert.equal(v3.background_color, '#f5f9f5');
  assert.equal(v3.theme_color, '#f5f9f5');
  assert.match(read('app/sw.js'), /ahl-athar-v5/);
  const v3sw = read('app/v3/sw.js');
  assert.match(v3sw, /identity-v2/);
  assert.ok(v3sw.includes("'/identity-tokens.css'"));
  assert.ok(v3sw.includes("'/identity-v2.css'"));
});

test('the root document routes visitors to the current V2 application', () => {
  const html = read('index.html');
  assert.match(html, /app\/index\.html/);
  assert.doesNotMatch(html, /Aref Ruqaa|Reem Kufi|Cairo|brand-motion\.css/);
});

test('the app does not retain a Tailwind runtime or stale screen scan', () => {
  const html = read('app/index.html');
  const pkg = JSON.parse(read('package.json'));
  assert.doesNotMatch(html, /tailwind\.css|leading-relaxed/);
  assert.ok(!pkg.scripts['build:css'] && !pkg.scripts['dev:css']);
  assert.ok(!pkg.devDependencies['tailwindcss'] && !pkg.devDependencies['@tailwindcss/cli']);
});
