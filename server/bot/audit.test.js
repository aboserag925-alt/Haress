'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); } else out.push(full);
  });
  return out;
}

test('only one getUpdates poller exists in the server code', function () {
  const hits = walk(path.join(ROOT, 'server'), []).filter(function (file) {
    return file.endsWith('.js') && !file.endsWith('.test.js') && /getUpdates/.test(fs.readFileSync(file, 'utf8')) &&
      /telegram\(\s*'getUpdates'/.test(fs.readFileSync(file, 'utf8'));
  });
  assert.deepEqual(hits.map(function (f) { return path.basename(f); }), ['media-library.js']);
  const bot = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
  assert.doesNotMatch(bot, /getUpdates|setWebhook/);
});

test('the service role key and bot token never appear in client files', function () {
  walk(path.join(ROOT, 'app'), []).filter(function (file) { return /\.(js|html|css)$/.test(file); }).forEach(function (file) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /SERVICE_ROLE_KEY|service_role_key|TELEGRAM_BOT_TOKEN|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/,
      path.relative(ROOT, file));
  });
});

test('bot migrations enable RLS and grant only service_role', function () {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  fs.readdirSync(dir).filter(function (name) { return /^20261124_0[2-6]/.test(name); }).forEach(function (name) {
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.match(sql, /enable row level security/i, name);
    assert.match(sql, /revoke all on [^;]+ from anon, authenticated/i, name);
    assert.match(sql, /grant all on [^;]+ to service_role/i, name);
    assert.doesNotMatch(sql, /to (anon|authenticated|public)\b/i, name);
  });
});

test('daily_content rows cannot exist without a reviewer or a source at the database level', function () {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261124_04_daily_content.sql'), 'utf8');
  assert.match(sql, /reviewed_by bigint not null/);
  assert.match(sql, /source text not null check \(char_length\(trim\(source\)\) > 0\)/);
});
