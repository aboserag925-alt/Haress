'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBot } = require('./bot');
const { createFakeNetwork, baseEnv, json, textMessage } = require('./test-helpers');
const { TelegramError, escapeHtml } = require('./telegram-client');

function make(options) {
  options = options || {};
  const network = createFakeNetwork(options.network);
  const logs = [];
  const bot = createBot({
    env: Object.assign({}, baseEnv, options.env || {}),
    fetch: network.fetch,
    sleep: async function () {},
    now: options.now,
    username: 'TestBot',
    mediaLibrary: options.mediaLibrary,
    submitQuestion: options.submitQuestion,
    logger: { error: function (message) { logs.push(message); } }
  });
  return { bot: bot, network: network, logs: logs };
}

test('start registers help text, site button and command menu', async function () {
  const { bot, network } = make();
  assert.equal(await bot.handleUpdate(textMessage('/start')), true);
  const sent = network.telegram.find(function (c) { return c.method === 'sendMessage'; });
  assert.equal(sent.payload.parse_mode, 'HTML');
  assert.match(sent.payload.text, /\/schedule/);
  assert.match(sent.payload.text, /\/library/);
  assert.match(sent.payload.text, /\/ask/);
  assert.equal(sent.payload.reply_markup.inline_keyboard[0][0].url.startsWith('https://'), true);

  await bot.start();
  const menu = network.telegram.find(function (c) { return c.method === 'setMyCommands'; });
  const names = menu.payload.commands.map(function (c) { return c.command; });
  assert.deepEqual(['start', 'help', 'schedule', 'library', 'ask'].every(function (n) {
    return names.includes(n);
  }), true);
});

test('ignores commands addressed to another bot and unknown commands', async function () {
  const { bot, network } = make();
  assert.equal(await bot.handleUpdate(textMessage('/start@OtherBot')), false);
  assert.equal(await bot.handleUpdate(textMessage('/media-remove abc')), false);
  assert.equal(network.telegram.length, 0);
});

test('schedule lists published lectures of the next 7 days in Cairo time', async function () {
  const fixedNow = Date.parse('2026-11-24T10:00:00Z');
  const { bot, network } = make({
    now: function () { return fixedNow; },
    network: {
      supabase: function (url) {
        assert.match(url, /lectures\?select=/);
        assert.match(url, /status=eq\.published/);
        assert.match(url, /starts_at=gte\./);
        assert.match(url, /starts_at=lte\./);
        return json(200, [
          { id: '1', title: 'شرح <الأصول>', starts_at: '2026-11-25T17:30:00Z', category: 'درس' }
        ]);
      }
    }
  });
  await bot.handleUpdate(textMessage('/schedule'));
  const sent = network.telegram.find(function (c) { return c.method === 'sendMessage'; });
  // 17:30 UTC is 19:30 in Cairo (UTC+2 in November).
  assert.match(sent.payload.text, /7:30/);
  assert.match(sent.payload.text, /شرح &lt;الأصول&gt;/);
  assert.doesNotMatch(sent.payload.text, /<الأصول>/);
  const publicCall = network.calls.find(function (c) { return c.url.includes('/rest/v1/lectures'); });
  assert.equal(publicCall.init.headers.apikey, baseEnv.SUPABASE_ANON_KEY);
});

test('schedule reports an empty week', async function () {
  const { bot, network } = make();
  await bot.handleUpdate(textMessage('/schedule'));
  assert.match(network.telegram[0].payload.text, /لا توجد محاضرات/);
});

test('library shows the latest 10 approved items and filters by category buttons', async function () {
  const items = [];
  for (let i = 0; i < 12; i += 1) {
    items.push({ id: 'id' + i, title: 'مادة ' + i, category: i % 2 ? 'audio' : 'books',
      categoryName: i % 2 ? 'صوتيات' : 'كتب', url: '/api/library/files/id' + i });
  }
  const { bot, network } = make({
    mediaLibrary: { listApproved: async function () { return items; } },
    env: { PUBLIC_API_BASE_URL: 'https://api.example.test' }
  });
  await bot.handleUpdate(textMessage('/library'));
  const sent = network.telegram.find(function (c) { return c.method === 'sendMessage'; });
  assert.equal((sent.payload.text.match(/\n\d+\./g) || []).length, 10);
  assert.match(sent.payload.text, /href="https:\/\/api\.example\.test\/api\/library\/files\/id0"/);
  const buttons = sent.payload.reply_markup.inline_keyboard[0].map(function (b) { return b.callback_data; });
  assert.deepEqual(buttons, ['lib:all', 'lib:audio', 'lib:video', 'lib:books', 'lib:images']);

  await bot.handleUpdate({
    update_id: 2,
    callback_query: { id: 'cb1', data: 'lib:audio', from: { id: 5 },
      message: { message_id: 55, chat: { id: 77 } } }
  });
  const edit = network.telegram.find(function (c) { return c.method === 'editMessageText'; });
  assert.equal(edit.payload.message_id, 55);
  assert.equal((edit.payload.text.match(/\n\d+\./g) || []).length, 6);
  assert.match(edit.payload.text, /صوتيات/);
  assert.doesNotMatch(edit.payload.text, /كتب/);
});

test('ask without text explains how to send a question', async function () {
  const { bot, network } = make();
  await bot.handleUpdate(textMessage('/ask'));
  assert.match(network.telegram[0].payload.text, /\/ask/);
  assert.match(network.telegram[0].payload.text, /قبل اعتماد مشرف/);
});

test('ask submits through the shared question pipeline and never returns the draft', async function () {
  const submitted = [];
  const { bot, network } = make({
    submitQuestion: async function (question, meta) {
      submitted.push({ question: question, source: meta.source });
      return { draft: 'مسودة سرية' };
    }
  });
  await bot.handleUpdate(textMessage('/ask ما شروط قبول الحديث؟'));
  assert.deepEqual(submitted, [{ question: 'ما شروط قبول الحديث؟', source: 'telegram' }]);
  const text = network.telegram[0].payload.text;
  assert.match(text, /وصل سؤالك/);
  assert.doesNotMatch(text, /مسودة سرية/);
});

test('ask rejects too short questions and limits repeated questions per user', async function () {
  const submitted = [];
  const { bot, network } = make({
    env: { BOT_RATE_LIMIT: '50' },
    submitQuestion: async function (question) { submitted.push(question); return {}; }
  });
  await bot.handleUpdate(textMessage('/ask abc'));
  assert.equal(submitted.length, 0);
  for (let i = 0; i < 5; i += 1) await bot.handleUpdate(textMessage('/ask سؤال رقم ' + i));
  assert.equal(submitted.length, 3);
  assert.match(network.telegram[network.telegram.length - 1].payload.text, /حد الأسئلة/);
});

test('per-user command rate limit warns once then stays quiet', async function () {
  const { bot, network } = make({ env: { BOT_RATE_LIMIT: '2', BOT_RATE_WINDOW_SECONDS: '60' } });
  for (let i = 0; i < 6; i += 1) await bot.handleUpdate(textMessage('/help'));
  const texts = network.telegram.map(function (c) { return c.payload.text; });
  assert.equal(texts.filter(function (t) { return /أوامر كثيرة/.test(t); }).length, 1);
  assert.equal(texts.length, 3);
  // Another user is not affected.
  const other = textMessage('/help');
  other.message.from = { id: 6, is_bot: false };
  await bot.handleUpdate(other);
  assert.equal(network.telegram.length, 4);
});

test('Telegram 429 is retried after retry_after seconds', async function () {
  const sleeps = [];
  let attempts = 0;
  const network = createFakeNetwork({
    telegram: {
      sendMessage: function () {
        attempts += 1;
        if (attempts === 1) {
          return json(429, { ok: false, error_code: 429, description: 'Too Many Requests',
            parameters: { retry_after: 3 } });
        }
        return null;
      }
    }
  });
  const { createTelegramClient } = require('./telegram-client');
  const client = createTelegramClient({
    token: 't', fetch: network.fetch, sleep: async function (ms) { sleeps.push(ms); }
  });
  await client.sendMessage(1, 'مرحبا');
  assert.deepEqual(sleeps, [3000]);
  assert.equal(attempts, 2);
});

test('Telegram 403 marks the user as blocked without crashing the loop', async function () {
  const { bot, network, logs } = make({
    network: {
      telegram: {
        sendMessage: function () {
          return json(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
        }
      }
    }
  });
  const cleaned = [];
  bot.ctx.onUserBlocked = async function (id) { cleaned.push(id); };
  assert.equal(await bot.handleUpdate(textMessage('/help')), true);
  assert.deepEqual(cleaned, [5]);
  assert.equal(bot.ctx.blockedUsers.has('5'), true);
  // The failed reply is not retried in a loop.
  assert.equal(network.telegram.filter(function (c) { return c.method === 'sendMessage'; }).length, 1);
  assert.deepEqual(logs, []);
});

test('escapeHtml neutralises markup and errors expose blocked flag', function () {
  assert.equal(escapeHtml('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  assert.equal(new TelegramError('sendMessage', 403, 'x').blocked, true);
  assert.equal(new TelegramError('sendMessage', 500, 'x').blocked, false);
});

test('Telegram 429 retries are bounded and the final error is raised', async function () {
  const sleeps = [];
  let attempts = 0;
  const network = createFakeNetwork({
    telegram: { sendMessage: function () {
      attempts += 1;
      return json(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 500 } });
    } }
  });
  const { createTelegramClient } = require('./telegram-client');
  const client = createTelegramClient({ token: 't', fetch: network.fetch, sleep: async function (ms) { sleeps.push(ms); } });
  await assert.rejects(client.sendMessage(1, 'x'), function (error) { return error.name === 'TelegramError'; });
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [60000, 60000]);
});
