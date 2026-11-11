import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const appDir = path.join(root, 'app');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const fullSha = String(process.env.GITHUB_SHA || process.env.GIT_SHA || 'local');
const version = String(process.env.APP_VERSION || packageJson.version || '0.0.0');
const payload = { version, sha: fullSha === 'local' ? 'local' : fullSha.slice(0, 7) };

fs.writeFileSync(path.join(appDir, 'version.json'), JSON.stringify(payload, null, 2) + '\n');

const headersPath = path.join(appDir, '_headers');
let headers = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, 'utf8').replace(/\s+$/, '') : '';

function setCacheRule(route, value) {
  const lines = headers ? headers.split(/\r?\n/) : [];
  const index = lines.findIndex(line => line.trim() === route);
  if (index === -1) {
    if (lines.length) lines.push('');
    lines.push(route, '  Cache-Control: ' + value);
  } else {
    let next = index + 1;
    while (next < lines.length && lines[next].trim() && !lines[next].startsWith('/')) next += 1;
    const cacheIndex = lines.findIndex((line, i) => i > index && i < next && /^\s*Cache-Control:/i.test(line));
    if (cacheIndex >= 0) lines[cacheIndex] = '  Cache-Control: ' + value;
    else lines.splice(index + 1, 0, '  Cache-Control: ' + value);
  }
  headers = lines.join('\n');
}

const noCache = 'no-cache, no-store, must-revalidate';
for (const route of ['/index.html', '/sw.js', '/runtime-config.js', '/version.json']) {
  setCacheRule(route, noCache);
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i.test(entry.name)) {
      const route = '/' + path.relative(appDir, file).split(path.sep).join('/');
      setCacheRule(route, 'public, max-age=31536000, immutable');
    }
  }
}
walk(appDir);
fs.writeFileSync(headersPath, headers + '\n');
console.log('Generated app/version.json and cache rules; fingerprinted assets are immutable.');
