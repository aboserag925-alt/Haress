'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBot } = require('./bot');
const { createFakeNetwork, createFakeSupabase, baseEnv, json } = require('./test-helpers');

const GROUP = -100500;

function setup(options) {
  options = options || {};
  const db = createFakeSupabase({ member_warnings: [] }, { member_warnings: ['chat_id', 'telegram_user_id'] });
  const admins = new Set(options.admins || [900]);
  const network = createFakeNetwork({
    supabase: db.handler,
    telegram: Object.assign({
      getChatMember: function (payload) {
        return json(200, { ok: true, result: { status: admins.has(payload.user_id) ? 'administrator' : 'member' } });
      }
    }, options.telegram)
  });
  const logs = [];
  const bot = createBot({
    env: Object.assign({}, baseEnv, options.env || {}),
    fetch: network.fetch, sleep: async function () {}, username: 'TestBot',
    now: function () { return Date.parse('2026-12-02T06:00:00Z'); },
    logger: { error: function (m) { logs.push(m); } }
  });
  return { bot: bot, network: network, db: db, logs: logs };
}

function groupMessage(text, userId, extra) {
  return { update_id: 1, message: Object.assign({
    message_id: 40, date: 1, chat: { id: GROUP, type: 'supergroup' },
    from: { id: userId, is_bot: false, first_name: 'Sami' }, text: text
  }, extra || {}) };
}

function methods(network, name) {
  return network.telegram.filter(function (c) { return c.method === name; });
}

test('welcome message shows the rules and is deleted after the configured delay', async function () {
  const t = setup({ env: { BOT_WELCOME_DELETE_SECONDS: '5' } });
  const update = groupMessage('', 5, { text: undefined, new_chat_members: [{ id: 8, is_bot: false, first_name: 'Omar<b>' }] });
  assert.equal(await t.bot.handleUpdate(update), true);
  const sent = methods(t.network, 'sendMessage')[0].payload;
  assert.match(sent.text, /قواعد المجموعة/);
  assert.match(sent.text, /Omar&lt;b&gt;/);
  assert.equal(methods(t.network, 'deleteMessage').length, 0);
  await new Promise(function (resolve) { setTimeout(resolve, 5200); });
  const deleted = methods(t.network, 'deleteMessage');
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].payload.message_id, 1001);
  await t.bot.stop();
});

test('link from a regular member is deleted with a warning, then a repeat mutes temporarily', async function () {
  const t = setup();
  assert.equal(await t.bot.handleUpdate(groupMessage('زوروا https://spam.example.com الآن', 5)), true);
  assert.equal(methods(t.network, 'deleteMessage').length, 1);
  assert.match(methods(t.network, 'sendMessage')[0].payload.text, /التحذير 1 من 2/);
  assert.equal(methods(t.network, 'restrictChatMember').length, 0);

  await t.bot.handleUpdate(groupMessage('www.ads.example.org', 5));
  const restrict = methods(t.network, 'restrictChatMember');
  assert.equal(restrict.length, 1);
  assert.equal(restrict[0].payload.user_id, 5);
  assert.equal(restrict[0].payload.permissions.can_send_messages, false);
  assert.equal(restrict[0].payload.until_date, Date.parse('2026-12-02T06:00:00Z') / 1000 + 3600);
  assert.match(methods(t.network, 'sendMessage').pop().payload.text, /كُتم/);
});

test('administrators, allowed domains, bots, channel posts and plain text are never moderated', async function () {
  const t = setup({ env: { BOT_ALLOWED_LINK_DOMAINS: 'youtube.com' } });
  assert.equal(await t.bot.handleUpdate(groupMessage('https://spam.example.com', 900)), false);
  assert.equal(await t.bot.handleUpdate(groupMessage('https://www.youtube.com/watch?v=1', 5)), false);
  assert.equal(await t.bot.handleUpdate(groupMessage('السلام عليكم ورحمة الله', 5)), false);
  assert.equal(await t.bot.handleUpdate(groupMessage('https://x.example.com', 5, { sender_chat: { id: -1 } })), false);
  assert.equal(methods(t.network, 'deleteMessage').length, 0);
});

test('link filter and welcome can be disabled from the environment', async function () {
  const t = setup({ env: { BOT_LINK_FILTER_ENABLED: 'false', BOT_WELCOME_ENABLED: 'false' } });
  assert.equal(await t.bot.handleUpdate(groupMessage('https://spam.example.com', 5)), false);
  const join = groupMessage('', 5, { text: undefined, new_chat_members: [{ id: 8, is_bot: false, first_name: 'A' }] });
  assert.equal(await t.bot.handleUpdate(join), false);
  assert.equal(t.network.telegram.length, 0);
});

test('/warn and /mute are admin-only replies, never touch admins, and /rules is public', async function () {
  const t = setup();
  const reply = { message_id: 30, from: { id: 5, is_bot: false, first_name: 'Sami' } };
  await t.bot.handleUpdate(groupMessage('/warn مخالفة', 6, { reply_to_message: reply }));
  assert.match(methods(t.network, 'sendMessage').pop().payload.text, /لمشرفي المجموعة فقط/);

  await t.bot.handleUpdate(groupMessage('/warn إعلان مزعج', 900, { reply_to_message: reply }));
  assert.match(methods(t.network, 'sendMessage').pop().payload.text, /التحذير 1 من 2/);
  assert.equal(t.db.tables.member_warnings[0].warnings, 1);

  await t.bot.handleUpdate(groupMessage('/mute 15', 900, { reply_to_message: reply }));
  const restrict = methods(t.network, 'restrictChatMember').pop();
  assert.equal(restrict.payload.until_date, Date.parse('2026-12-02T06:00:00Z') / 1000 + 15 * 60);

  await t.bot.handleUpdate(groupMessage('/mute', 900, { reply_to_message: { message_id: 3, from: { id: 900, is_bot: false } } }));
  assert.match(methods(t.network, 'sendMessage').pop().payload.text, /مشرف/);
  assert.equal(methods(t.network, 'restrictChatMember').length, 1);

  await t.bot.handleUpdate(groupMessage('/rules', 7));
  assert.match(methods(t.network, 'sendMessage').pop().payload.text, /قواعد المجموعة/);
});

test('missing delete or restrict rights are logged once and do not crash moderation', async function () {
  const t = setup({
    telegram: {
      deleteMessage: function () { return json(400, { ok: false, error_code: 400, description: 'not enough rights' }); },
      restrictChatMember: function () { return json(400, { ok: false, error_code: 400, description: 'not enough rights' }); }
    }
  });
  await t.bot.handleUpdate(groupMessage('https://a.example.com', 5));
  await t.bot.handleUpdate(groupMessage('https://b.example.com', 5));
  assert.equal(t.logs.filter(function (m) { return /admin rights/.test(m); }).length, 1);
  assert.match(methods(t.network, 'sendMessage').pop().payload.text, /لا أملك صلاحية التقييد/);
});
