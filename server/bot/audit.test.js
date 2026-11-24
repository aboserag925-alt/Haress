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

test('privileged commands re-verify the admin role with Telegram every time (demotion takes effect at once)', async function () {
  const { createBot } = require('./bot');
  const { createFakeNetwork, createFakeSupabase, baseEnv, json } = require('./test-helpers');
  const admins = new Set([900]);
  const db = createFakeSupabase({ daily_content: [], quizzes: [], member_warnings: [] }, {
    daily_content: ['id'], 'daily_content:autoid': true, quizzes: ['id'], 'quizzes:autoid': true,
    member_warnings: ['chat_id', 'telegram_user_id']
  });
  const network = createFakeNetwork({
    supabase: db.handler,
    telegram: { getChatMember: function (p) {
      return json(200, { ok: true, result: { status: admins.has(p.user_id) ? 'administrator' : 'member' } });
    } }
  });
  const bot = createBot({ env: Object.assign({}, baseEnv, { BOT_RATE_LIMIT: '100' }), fetch: network.fetch, sleep: async function () {}, username: 'TestBot',
    now: function () { return Date.parse('2026-12-02T06:00:00Z'); }, logger: { error: function () {} } });
  function say(userId, text, reply) {
    return bot.handleUpdate({ update_id: 1, message: { message_id: 5, date: 1, chat: { id: -100500, type: 'supergroup' },
      from: { id: userId, is_bot: false, first_name: 'A' }, text: text,
      reply_to_message: reply ? { message_id: 3, from: { id: 5, is_bot: false, first_name: 'T' } } : undefined } });
  }
  const commands = [
    ['/warn سبب', true, 'member_warnings'],
    ['/mute 10', true, null],
    ['/addcontent ذكر | سبحان الله | صحيح مسلم 2691', false, 'daily_content'],
    ['/addquiz س؟ | أ | ب | 1 | شرح', false, 'quizzes']
  ];
  // Admin works and warms the cache.
  for (const c of commands) await say(900, c[0], c[1]);
  assert.equal(db.tables.daily_content.length, 1);
  assert.equal(db.tables.quizzes.length, 1);
  const mutedBefore = network.telegram.filter(function (c) { return c.method === 'restrictChatMember'; }).length;
  assert.equal(mutedBefore, 1);
  // Demoted: every privileged command is refused straight away.
  admins.delete(900);
  for (const c of commands) await say(900, c[0], c[1]);
  assert.equal(db.tables.daily_content.length, 1);
  assert.equal(db.tables.quizzes.length, 1);
  assert.equal(network.telegram.filter(function (c) { return c.method === 'restrictChatMember'; }).length, mutedBefore);
  assert.equal(db.tables.member_warnings[0].warnings, 1);
  const refusals = network.telegram.filter(function (c) {
    return c.method === 'sendMessage' && /لمشرفي المجموعة فقط/.test(c.payload.text);
  });
  assert.equal(refusals.length, 4);
});
