import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const required = [
  'app/index.html',
  'app/manifest.json',
  'app/sw.js',
  'app/identity-tokens.css',
  'app/identity-v2.css',
  'app/identity-v2.js',
  'app/app.js',
  'app/icon.svg'
];

export function validateHtmlRtl(html) {
  const match = String(html).match(/<html\b([^>]*)>/i);
  if (!match) return { ok: false, reason: 'missing <html> element' };
  const attrs = match[1] || '';
  const hasLang = /\blang\s*=\s*(["'])ar\1/i.test(attrs) || /\blang\s*=\s*ar\b/i.test(attrs);
  const hasDir = /\bdir\s*=\s*(["'])rtl\1/i.test(attrs) || /\bdir\s*=\s*rtl\b/i.test(attrs);
  if (!hasLang || !hasDir) {
    return { ok: false, reason: 'root <html> must include lang="ar" and dir="rtl"' };
  }
  return { ok: true };
}

function fail(message, child, tempDir) {
  console.error('SMOKE FAIL: ' + message);
  try { if (child && child.exitCode === null) child.kill('SIGTERM'); } catch {}
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function runSmokeCheck(options = {}) {
  const cwd = options.cwd || root;
  for (const rel of required) {
    const file = path.join(cwd, rel);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.size === 0) throw new Error('missing/empty ' + rel);
  }

  const html = fs.readFileSync(path.join(cwd, 'app/index.html'), 'utf8');
  const rtl = validateHtmlRtl(html);
  if (!rtl.ok) throw new Error(rtl.reason);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hares-smoke-storage-'));
  const port = 18080 + Math.floor(Math.random() * 1000);
  // Isolated env: no production integrations/secrets; keep minimal runtime vars.
  const env = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    LANG: process.env.LANG || 'C.UTF-8',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    ALLOWED_ORIGINS: '',
    STORAGE_DIRECTORY: tempDir,
    TELEGRAM_MEDIA_ENABLED: 'false',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_MEDIA_GROUP_ID: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    TURNSTILE_SECRET_KEY: '',
    GEMINI_API_KEY: '',
    TRUST_PROXY: 'false'
  };

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { err += String(d); });

  try {
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) {
        throw new Error('server exited early (code ' + child.exitCode + '): ' + (err || out || 'no output'));
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: controller.signal });
        clearTimeout(timer);
        const body = await res.json();
        if (res.status === 200 && body && body.ok === true) {
          return { ok: true, tempDir, child, out, err };
        }
      } catch {}
      await wait(150);
    }
    throw new Error('timeout waiting for /api/health: ' + (err || out || 'no output'));
  } catch (e) {
    try { if (child.exitCode === null) child.kill('SIGTERM'); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    throw e;
  }
}

// Checks a deployed backend: health, public lectures, and CORS for the real frontend origin.
// Usage: node scripts/smoke-check.mjs --backend https://api.example.com --origin https://site.example
export async function runRemoteSmokeCheck(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const base = String(options.backendUrl || '').trim().replace(/\/+$/, '');
  const origin = String(options.origin || '').trim().replace(/\/+$/, '');

  let parsed;
  try { parsed = new URL(base); } catch { throw new Error('backend URL is not a valid URL'); }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('backend URL must use https');
  }
  if (!origin) throw new Error('the frontend origin (--origin) is required');

  async function call(pathname, init) {
    return fetchImpl(base + pathname, { ...init, signal: AbortSignal.timeout(10000) });
  }

  const passed = [];

  const health = await call('/api/health');
  const healthBody = await health.json().catch(() => null);
  if (health.status !== 200 || !healthBody || healthBody.ok !== true) {
    throw new Error('/api/health did not return {"ok":true} (status ' + health.status + ')');
  }
  passed.push('/api/health');

  const lectures = await call('/api/lectures', { headers: { Origin: origin } });
  const lecturesBody = await lectures.json().catch(() => null);
  if (lectures.status !== 200 || !lecturesBody || !Array.isArray(lecturesBody.items)) {
    throw new Error('/api/lectures did not return {"items":[...]} (status ' + lectures.status + ')');
  }
  passed.push('/api/lectures');

  const allowed = await call('/api/lectures', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' }
  });
  if (allowed.status !== 204 || allowed.headers.get('access-control-allow-origin') !== origin) {
    throw new Error('CORS does not allow ' + origin + ' (add it to ALLOWED_ORIGINS on the server)');
  }
  passed.push('CORS allows ' + origin);

  const blocked = await call('/api/lectures', {
    method: 'OPTIONS',
    headers: { Origin: 'https://not-allowed.invalid', 'Access-Control-Request-Method': 'GET' }
  });
  if (blocked.status !== 403) {
    throw new Error('CORS accepted an unknown origin (status ' + blocked.status + ')');
  }
  passed.push('CORS rejects unknown origins');

  return passed;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const backendUrl = argValue('--backend');
  if (backendUrl) {
    try {
      const passed = await runRemoteSmokeCheck({ backendUrl: backendUrl, origin: argValue('--origin') });
      console.log('SMOKE OK (remote): ' + passed.join(', '));
    } catch (e) {
      console.error('SMOKE FAIL: ' + (e && e.message ? e.message : String(e)));
      process.exit(1);
    }
    return;
  }
  let result;
  try {
    result = await runSmokeCheck();
  } catch (e) {
    console.error('SMOKE FAIL: ' + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }
  try { if (result.child && result.child.exitCode === null) result.child.kill('SIGTERM'); } catch {}
  try { fs.rmSync(result.tempDir, { recursive: true, force: true }); } catch {}
  console.log('SMOKE OK: assets present, <html lang="ar" dir="rtl"> verified, isolated /api/health=200');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
