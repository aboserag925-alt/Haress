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
  'app/tailwind.css',
  'app/app.js',
  'app/icon.svg',
  'app/apple-touch-icon.png'
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

async function main() {
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
