'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBot } = require('./bot');
const { runReminderCycle } = require('./features/reminders');
const { createFakeNetwork, createFakeSupabase, baseEnv, textMessage } = require('./test-helpers');

const KEYS = { sent_reminders: ['lecture_id', 'kind', 'starts_at'], subscribers: ['telegram_user_id'] };

function setup(lectures, options) {
  options = options || {};
  const db = createFakeSupabase({
    lectures: lectures,
    sent_reminders: options.sent || [],
    subscribers: options.subscribers || []
  }, KEYS);
  const network = createFakeNetwork({ supabase: db.handler, telegram: options.telegram });
  let current = options.now;
  const bot = createBot({
    env: Object.assign({}, baseEnv, options.env || {}),
    fetch: network.fetch,
    sleep: async function () {},
    now: function () { return current; },
    username: 'TestBot',
    logger: { error: function () {} }
  });
  return { bot: bot, db: db, network: network, setNow: function (value) { current = value; } };
}

const T0 = Date.parse('2026-12-01T16:00:00Z');
const lecture = { id: 'L1', title: 'شرح <الواسطية>', status: 'published',
  starts_at: '2026-12-01T17:00:00Z', stream_url: 'https://live.example.test/x' };

function groupMessages(network) {
  return network.telegram.filter(function (c) { return c.method === 'sendMessage'; });
}

test('sends one reminder an hour before and one at start with the stream link', async function () {
  const env = setup([lecture], { now: T0 });
  await runReminderCycle(env.bot.ctx);
  let messages = groupMessages(env.network);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].payload.chat_id, baseEnv.TELEGRAM_CHAT_ID);
  assert.match(messages[0].payload.text, /بعد ساعة/);
  assert.match(messages[0].payload.text, /&lt;الواسطية&gt;/);

  // Repeated cycles in the same minute do not duplicate.
  await runReminderCycle(env.bot.ctx);
  assert.equal(groupMessages(env.network).length, 1);

  env.setNow(Date.parse('2026-12-01T17:01:00Z'));
  await runReminderCycle(env.bot.ctx);
  messages = groupMessages(env.network);
  assert.equal(messages.length, 2);
  assert.match(messages[1].payload.text, /بدأت الآن/);
  assert.match(messages[1].payload.text, /href="https:\/\/live\.example\.test\/x"/);
  assert.deepEqual(env.db.tables.sent_reminders.map(function (r) { return r.kind + ':' + r.state; }).sort(),
    ['hour:sent', 'start:sent']);
});

test('a restart does not duplicate reminders already recorded', async function () {
  const env = setup([lecture], {
    now: T0,
    sent: [{ lecture_id: 'L1', kind: 'hour', starts_at: '2026-12-01T17:00:00Z', state: 'sent' }]
  });
  const result = await runReminderCycle(env.bot.ctx);
  assert.equal(result.sent, 0);
  assert.equal(groupMessages(env.network).length, 0);
});

test('drafts, archived lectures and lectures outside the window are ignored', async function () {
  const env = setup([
    Object.assign({}, lecture, { id: 'D', status: 'draft' }),
    Object.assign({}, lecture, { id: 'A', status: 'archived' }),
    Object.assign({}, lecture, { id: 'F', starts_at: '2026-12-03T17:00:00Z' }),
    Object.assign({}, lecture, { id: 'P', starts_at: '2026-12-01T10:00:00Z' })
  ], { now: T0 });
  await runReminderCycle(env.bot.ctx);
  assert.equal(groupMessages(env.network).length, 0);
});

test('a rescheduled lecture is reminded again for the new time and flagged as updated', async function () {
  const env = setup([Object.assign({}, lecture, { starts_at: '2026-12-01T17:30:00Z' })], {
    now: T0 + 40 * 60 * 1000,
    sent: [{ lecture_id: 'L1', kind: 'hour', starts_at: '2026-12-01T17:00:00Z' }]
  });
  await runReminderCycle(env.bot.ctx);
  const messages = groupMessages(env.network);
  assert.equal(messages.length, 1);
  assert.match(messages[0].payload.text, /تحديث/);
  assert.match(messages[0].payload.text, /بعد 50 دقيقة/);
});

test('a failed send releases the claim so the next cycle retries without losing it', async function () {
  let failures = 1;
  const env = setup([lecture], {
    now: T0,
    telegram: {
      sendMessage: function () {
        if (failures > 0) {
          failures -= 1;
          const { json } = require('./test-helpers');
          return json(500, { ok: false, error_code: 500, description: 'oops' });
        }
        return null;
      }
    }
  });
  await runReminderCycle(env.bot.ctx);
  assert.equal(env.db.tables.sent_reminders.length, 0);
  await runReminderCycle(env.bot.ctx);
  assert.equal(env.db.tables.sent_reminders.length, 1);
});

test('/remind subscribes in a private chat and toggles off', async function () {
  const env = setup([], { now: T0 });
  await env.bot.handleUpdate(textMessage('/remind'));
  assert.equal(env.db.tables.subscribers.length, 1);
  assert.equal(env.db.tables.subscribers[0].chat_id, 77);
  assert.match(groupMessages(env.network)[0].payload.text, /فُعّل/);
  await env.bot.handleUpdate(textMessage('/remind'));
  assert.equal(env.db.tables.subscribers.length, 0);

  const group = textMessage('/remind');
  group.message.chat = { id: -100500, type: 'supergroup' };
  await env.bot.handleUpdate(group);
  assert.match(groupMessages(env.network).pop().payload.text, /محادثة خاصة/);
  assert.equal(env.db.tables.subscribers.length, 0);
});

test('subscribers receive private reminders and a blocked subscriber is flagged', async function () {
  const { json } = require('./test-helpers');
  const env = setup([lecture], {
    now: T0,
    subscribers: [
      { telegram_user_id: 5, chat_id: 501, blocked: false },
      { telegram_user_id: 6, chat_id: 601, blocked: false }
    ],
    telegram: {
      sendMessage: function (payload) {
        if (payload.chat_id === 601) {
          return json(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
        }
        return null;
      }
    }
  });
  await runReminderCycle(env.bot.ctx);
  const targets = groupMessages(env.network).map(function (c) { return c.payload.chat_id; });
  assert.deepEqual(targets, [baseEnv.TELEGRAM_CHAT_ID, 501, 601]);
  assert.equal(env.db.tables.subscribers.find(function (s) { return s.telegram_user_id === 6; }).blocked, true);
  assert.equal(env.db.tables.subscribers.find(function (s) { return s.telegram_user_id === 5; }).blocked, false);
});

test('reminders use the service role only through the server store', async function () {
  const env = setup([lecture], { now: T0 });
  await runReminderCycle(env.bot.ctx);
  const supabaseCalls = env.network.calls.filter(function (c) { return c.url.includes('/rest/v1/'); });
  assert.ok(supabaseCalls.length > 0);
  supabaseCalls.forEach(function (c) {
    assert.equal(c.init.headers.apikey, baseEnv.SUPABASE_SERVICE_ROLE_KEY);
  });
  groupMessages(env.network).forEach(function (c) {
    assert.doesNotMatch(JSON.stringify(c.payload), /service-test-key/);
  });
});

test('crash recovery: an abandoned claim is not retried early but is retried after the timeout', async function () {
  const claimedAt = new Date(T0 - 10 * 1000).toISOString();
  const env = setup([lecture], {
    now: T0,
    sent: [{ lecture_id: 'L1', kind: 'hour', starts_at: '2026-12-01T17:00:00Z',
      state: 'claiming', claimed_at: claimedAt }]
  });
  await runReminderCycle(env.bot.ctx);
  assert.equal(groupMessages(env.network).length, 0);

  env.setNow(T0 + 3 * 60 * 1000);
  await runReminderCycle(env.bot.ctx);
  assert.equal(groupMessages(env.network).length, 1);
  assert.equal(env.db.tables.sent_reminders[0].state, 'sent');

  env.setNow(T0 + 6 * 60 * 1000);
  await runReminderCycle(env.bot.ctx);
  assert.equal(groupMessages(env.network).length, 1);
});

test('ambiguous send (response lost) keeps the claim and may repeat after the timeout, by design', async function () {
  let first = true;
  const env = setup([lecture], {
    now: T0,
    telegram: {
      sendMessage: function () {
        if (first) { first = false; throw new Error('socket hang up'); }
        return null;
      }
    }
  });
  await runReminderCycle(env.bot.ctx);
  assert.equal(env.db.tables.sent_reminders.length, 1);
  assert.equal(env.db.tables.sent_reminders[0].state, 'claiming');
  env.setNow(T0 + 30 * 1000);
  await runReminderCycle(env.bot.ctx);
  assert.equal(groupMessages(env.network).length, 1);
  env.setNow(T0 + 3 * 60 * 1000);
  await runReminderCycle(env.bot.ctx);
  // The second attempt is the retry. The first may or may not have reached Telegram.
  assert.equal(groupMessages(env.network).length, 2);
  assert.equal(env.db.tables.sent_reminders[0].state, 'sent');
});
