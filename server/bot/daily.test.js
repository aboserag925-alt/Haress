'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBot } = require('./bot');
const { runDailyCycle, validateEntry } = require('./features/daily');
const { cairoInstant, cairoParts } = require('./cairo-time');
const { createFakeNetwork, createFakeSupabase, baseEnv, json, textMessage } = require('./test-helpers');

const KEYS = { daily_content: ['id'], 'daily_content:autoid': true, 'daily_content:defaults': { state: 'scheduled' } };

function setup(rows, options) {
  options = options || {};
  const db = createFakeSupabase({ daily_content: rows }, KEYS);
  const admins = new Set(options.admins || [900]);
  const telegram = Object.assign({
    getChatMember: function (payload) {
      return json(200, { ok: true, result: { status: admins.has(payload.user_id) ? 'administrator' : 'member' } });
    }
  }, options.telegram);
  const network = createFakeNetwork({ supabase: db.handler, telegram: telegram });
  let current = options.now;
  const bot = createBot({
    env: Object.assign({}, baseEnv, options.env || {}),
    fetch: network.fetch, sleep: async function () {}, username: 'TestBot',
    now: function () { return current; }, logger: { error: function () {} }
  });
  return { bot: bot, db: db, network: network, setNow: function (v) { current = v; } };
}

const NOW = Date.parse('2026-12-02T06:00:00Z'); // 08:00 in Cairo (UTC+2)
const reviewed = { id: 'a', type: 'حديث', text: 'إنما الأعمال بالنيات', source: 'صحيح البخاري 1',
  reviewed_by: 900, publish_at: '2026-12-02T05:00:00Z', state: 'scheduled' };

function posts(network) {
  return network.telegram.filter(function (c) { return c.method === 'sendMessage'; });
}

test('cairoInstant handles Egypt daylight saving time', function () {
  assert.equal(new Date(cairoInstant('2026-12-02', '07:00')).toISOString(), '2026-12-02T05:00:00.000Z');
  const summer = cairoInstant('2026-07-02', '07:00');
  assert.equal(cairoParts(summer).hour, 7);
  assert.equal(new Date(summer).toISOString(), '2026-07-02T04:00:00.000Z');
});

test('posts one reviewed item with its source and does not repeat the same day', async function () {
  const t = setup([reviewed], { now: NOW });
  const result = await runDailyCycle(t.bot.ctx);
  assert.equal(result.posted, true);
  const text = posts(t.network)[0].payload.text;
  assert.match(text, /إنما الأعمال بالنيات/);
  assert.match(text, /المصدر:<\/b> صحيح البخاري 1/);
  assert.equal(t.db.tables.daily_content[0].state, 'sent');
  assert.equal(t.db.tables.daily_content[0].post_date, '2026-12-02');
  await runDailyCycle(t.bot.ctx);
  assert.equal(posts(t.network).length, 1);
});

test('never publishes content without a source, without a reviewer, before its time, or not scheduled', async function () {
  const t = setup([
    Object.assign({}, reviewed, { id: 'n1', source: '   ' }),
    Object.assign({}, reviewed, { id: 'n2', reviewed_by: null }),
    Object.assign({}, reviewed, { id: 'n3', publish_at: '2026-12-03T05:00:00Z' }),
    Object.assign({}, reviewed, { id: 'n4', state: 'sent', post_date: '2026-12-01' })
  ], { now: NOW });
  assert.equal((await runDailyCycle(t.bot.ctx)).posted, false);
  assert.equal(posts(t.network).length, 0);
});

test('a failed send releases the item and the next cycle retries it', async function () {
  let fail = true;
  const t = setup([reviewed], {
    now: NOW,
    telegram: { sendMessage: function () {
      if (fail) { fail = false; return json(500, { ok: false, error_code: 500, description: 'x' }); }
      return null;
    } }
  });
  await runDailyCycle(t.bot.ctx);
  assert.equal(t.db.tables.daily_content[0].state, 'scheduled');
  await runDailyCycle(t.bot.ctx);
  assert.equal(t.db.tables.daily_content[0].state, 'sent');
});

test('crash recovery: an abandoned claim is retried only after the timeout', async function () {
  const claimed = Object.assign({}, reviewed, {
    state: 'claiming', post_date: '2026-12-02', claimed_at: new Date(NOW - 10000).toISOString()
  });
  const t = setup([claimed], { now: NOW });
  assert.equal((await runDailyCycle(t.bot.ctx)).posted, false);
  t.setNow(NOW + 3 * 60 * 1000);
  assert.equal((await runDailyCycle(t.bot.ctx)).posted, true);
  assert.equal(t.db.tables.daily_content[0].state, 'sent');
  assert.equal(posts(t.network).length, 1);
});

test('validation requires a source and a book/number or grading for hadith', function () {
  assert.match(validateEntry({ type: 'فائدة', text: 'نص', source: '' }), /مصدر/);
  assert.match(validateEntry({ type: 'حديث', text: 'نص', source: 'كتاب' }), /الكتاب والرقم/);
  assert.equal(validateEntry({ type: 'حديث', text: 'نص', source: 'مسلم 2564' }), null);
  assert.equal(validateEntry({ type: 'ذكر', text: 'سبحان الله', source: 'صحيح مسلم' }), null);
  assert.match(validateEntry({ type: 'خبر', text: 'نص', source: 'م' }), /النوع/);
});

test('/addcontent is admin-only, requires a source, and stores the reviewer', async function () {
  const t = setup([], { now: NOW });
  const text = '/addcontent حديث | إنما الأعمال بالنيات | صحيح البخاري 1 | 2026-12-05';
  const stranger = textMessage(text);
  await t.bot.handleUpdate(stranger);
  assert.equal(t.db.tables.daily_content.length, 0);
  assert.match(posts(t.network).pop().payload.text, /لمشرفي المجموعة فقط/);

  const admin = textMessage(text);
  admin.message.from = { id: 900, is_bot: false };
  await t.bot.handleUpdate(admin);
  assert.equal(t.db.tables.daily_content.length, 1);
  const row = t.db.tables.daily_content[0];
  assert.equal(row.reviewed_by, 900);
  assert.equal(row.source, 'صحيح البخاري 1');
  assert.equal(row.publish_at, '2026-12-05T05:00:00.000Z');

  const noSource = textMessage('/addcontent فائدة | نص بلا مصدر');
  noSource.message.from = { id: 900, is_bot: false };
  await t.bot.handleUpdate(noSource);
  assert.equal(t.db.tables.daily_content.length, 1);
});

test('/addcontent without a date schedules after the latest queued item', async function () {
  const t = setup([Object.assign({}, reviewed, { publish_at: '2026-12-04T05:00:00Z', state: 'scheduled' })],
    { now: NOW });
  const admin = textMessage('/addcontent ذكر | سبحان الله وبحمده | صحيح مسلم 2692');
  admin.message.from = { id: 900, is_bot: false };
  await t.bot.handleUpdate(admin);
  assert.equal(t.db.tables.daily_content[1].publish_at, '2026-12-05T05:00:00.000Z');
});

test('/addcontent is not listed in the public command menu', async function () {
  const t = setup([], { now: NOW });
  await t.bot.start();
  const menu = t.network.telegram.find(function (c) { return c.method === 'setMyCommands'; });
  assert.equal(menu.payload.commands.some(function (c) { return c.command === 'addcontent'; }), false);
});
