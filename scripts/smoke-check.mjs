import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

for (const rel of required) {
  const file = path.join(root, rel);
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size === 0) {
    console.error('SMOKE FAIL: missing/empty ' + rel);
    process.exit(1);
  }
}

const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
if (!/lang="ar"/.test(html) || !/dir="rtl"/.test(html)) {
  console.error('SMOKE FAIL: app/index.html missing Arabic RTL markers');
  process.exit(1);
}

const port = 18080 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ALLOWED_ORIGINS: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let out = '';
let err = '';
child.stdout.on('data', (d) => { out += String(d); });
child.stderr.on('data', (d) => { err += String(d); });

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) throw new Error('server exited early: ' + err + out);
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/api/health');
      const body = await res.json();
      if (res.status === 200 && body && body.ok === true) {
        console.log('SMOKE OK: assets present, RTL markers present, /api/health=200');
        child.kill();
        process.exit(0);
      }
    } catch {}
    await wait(150);
  }
  throw new Error('timeout waiting for /api/health');
}

run().catch((e) => {
  console.error('SMOKE FAIL: ' + (e && e.message ? e.message : e));
  try { child.kill(); } catch {}
  process.exit(1);
});
