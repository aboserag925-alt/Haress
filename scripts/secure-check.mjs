/**
 * تحقق سريع: يفشل إن وُجد سر مكشوف أو رابط خارجي بلا noopener أو مفتاح سري في الواجهة.
 * التشغيل: node scripts/secure-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const frontendRoots = [path.join(root, 'index.html'), path.join(root, 'app/index.html'), path.join(root, 'app/istiraha.js'), path.join(root, 'app/istiraha-content.js')];
const secretPatterns = [
  /service_role["'\s:]+[A-Za-z0-9._~-]{30,}/i,
  /AIza[A-Za-z0-9_-]{35}/,
  /ghp_[A-Za-z0-9]{36}/,
  /BEGIN (RSA )?PRIVATE KEY/,
  /TELEGRAM_BOT_TOKEN["'\s:]+[0-9]{8}:/,
  /YOUTUBE_API_KEY["'\s:]+[A-Za-z0-9_-]{20,}/,
];

let failed = false;
for (const file of frontendRoots) {
  const text = fs.readFileSync(file, 'utf8');
  for (const re of secretPatterns) {
    if (re.test(text)) {
      console.error('Secure-check FAILED: secret-like pattern in ' + path.relative(root, file));
      failed = true;
    }
  }
}

const htmls = ['index.html', 'app/index.html'];
for (const rel of htmls) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const anchors = [...text.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
  for (const tag of anchors) {
    if (!tag.includes('target="_blank"') && !tag.includes("target='_blank'")) continue;
    if (!/rel=("[^"]*noopener[^"]*"|'[^']*noopener[^']*')/i.test(tag)) {
      console.error('Secure-check FAILED: external link without noopener in ' + rel + ': ' + tag.slice(0, 120));
      failed = true;
    }
  }
  if (!text.includes('application/ld+json')) {
    console.error('Secure-check FAILED: missing JSON-LD in ' + rel);
    failed = true;
  }
}

const offline = path.join(root, 'app/offline.html');
if (!fs.existsSync(offline)) {
  console.error('Secure-check FAILED: app/offline.html missing');
  failed = true;
}

if (failed) process.exit(1);
console.log('Secure-check passed: no secrets, external links gated, JSON-LD + offline present.');
