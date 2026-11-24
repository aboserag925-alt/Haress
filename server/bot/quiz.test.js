'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBot } = require('./bot');
const { runQuizCycle, parseAddQuiz, validateQuiz } = require('./features/quiz');
const { createFakeNetwork, createFakeSupabase, baseEnv, json, textMessage } = require('./test-helpers');

const ID = '00000000-0000-4000-8000-000000000001';
const KEYS = {
  quizzes: ['id'], 'quizzes:autoid': true, 'quizzes:defaults': { state: 'scheduled', claimed_at: null, message_id: null },
  quiz_answers: ['quiz_id', 'telegram_user_id']
};
const NOW = Date.parse('2026-12-02T10:30:00Z'); // 12:30 Cairo, Wednesday
const quiz = { id: ID, question: 'كم عدد أركان الإسلام؟', options: ['ثلاثة', 'خمسة', 'ستة'], correct_index: 1,
  explanation: 'أركان الإسلام خمسة.', reviewed_by: 900, publish_at: '2026-12-02T10:00:00Z',
  reveal_at: '2026-12-02T16:00:00Z', state: 'scheduled', claimed_at: null, message_id: null };

function setup(rows, options) {
  options = options || {};
  const db = createFakeSupabase({ quizzes: rows, quiz_answers: options.answers || [] }, KEYS);
  const network = createFakeNetwork({
    supabase: db.handler,
    telegram: Object.assign({
      getChatMember: function (p) { return json(200, { ok: true, result: { status: p.user_id === 900 ? 'administrator' : 'member' } }); }
    }, options.telegram)
  });
  let current = NOW;
  const bot = createBot({
    env: Object.assign({}, baseEnv, options.env || {}), fetch: network.fetch, sleep: async function () {},
    username: 'TestBot', now: function () { return current; }, logger: { error: function () {} }
  });
  return { bot: bot, db: db, network: network, setNow: function (v) { current = v; } };
}

function sent(network) { return network.telegram.filter(function (c) { return c.method === 'sendMessage'; }); }
function tap(userId, data, name) {
  return { update_id: 2, callback_query: { id: 'cb' + userId, data: data, from: { id: userId, first_name: name || 'U' + userId } } };
}

test('parser and validation', function () {
  const parsed = parseAddQuiz('س؟ | أ | ب | 2 | شرح | 2026-12-05');
  assert.deepEqual([parsed.options, parsed.correct, parsed.date], [['أ', 'ب'], 2, '2026-12-05']);
  assert.equal(validateQuiz(parsed), null);
  assert.match(validateQuiz(Object.assign({}, parsed, { correct: 3 })), /رقم الإجابة/);
  assert.match(validateQuiz(Object.assign({}, parsed, { explanation: '' })), /الشرح/);
  assert.equal(parseAddQuiz('س | أ | 1'), null);
});

test('/addquiz is admin-only and stores a reviewed quiz', async function () {
  const t = setup([]);
  await t.bot.handleUpdate(textMessage('/addquiz س؟ | أ | ب | 1 | شرح', { message: Object.assign(textMessage('').message, { text: '/addquiz س؟ | أ | ب | 1 | شرح', chat: { id: -100500, type: 'supergroup' }, from: { id: 5, is_bot: false } }) }));
  assert.equal(t.db.tables.quizzes.length, 0);
  assert.match(sent(t.network).pop().payload.text, /لمشرفي المجموعة فقط/);
  const msg = textMessage('').message;
  await t.bot.handleUpdate({ update_id: 3, message: Object.assign(msg, { text: '/addquiz س؟ | أ | ب | 2 | شرح', chat: { id: -100500, type: 'supergroup' }, from: { id: 900, is_bot: false } }) });
  const row = t.db.tables.quizzes[0];
  assert.equal(row.correct_index, 1);
  assert.equal(row.reviewed_by, 900);
  assert.equal(Date.parse(row.reveal_at) - Date.parse(row.publish_at), 6 * 3600 * 1000);
  assert.equal(row.publish_at, '2026-12-03T10:00:00.000Z');
});

test('posting shows answer buttons and no correct answer; answers are first-only and give no hint', async function () {
  const t = setup([quiz]);
  const result = await runQuizCycle(t.bot.ctx);
  assert.equal(result.posted, 1);
  const post = sent(t.network)[0].payload;
  assert.doesNotMatch(post.text, /أركان الإسلام خمسة/);
  assert.equal(post.reply_markup.inline_keyboard[0].length, 3);
  assert.equal(t.db.tables.quizzes[0].state, 'posted');

  await t.bot.handleUpdate(tap(5, 'qz:' + ID + ':1'));
  const first = t.network.telegram.filter(function (c) { return c.method === 'answerCallbackQuery'; }).pop().payload.text;
  assert.match(first, /سُجلت/);
  assert.doesNotMatch(first, /صحيح|خطأ/);
  await t.bot.handleUpdate(tap(5, 'qz:' + ID + ':0'));
  assert.match(t.network.telegram.filter(function (c) { return c.method === 'answerCallbackQuery'; }).pop().payload.text, /من قبل/);
  assert.equal(t.db.tables.quiz_answers.length, 1);
  assert.equal(t.db.tables.quiz_answers[0].is_correct, true);
});

test('reveal happens only after the delay, publishes answer and explanation, and closes answering', async function () {
  const t = setup([Object.assign({}, quiz, { state: 'posted', message_id: 77 })]);
  assert.equal((await runQuizCycle(t.bot.ctx)).revealed, 0);
  t.setNow(Date.parse('2026-12-02T16:05:00Z'));
  assert.equal((await runQuizCycle(t.bot.ctx)).revealed, 1);
  const text = sent(t.network).pop().payload.text;
  assert.match(text, /خمسة/);
  assert.match(text, /أركان الإسلام خمسة/);
  assert.equal(t.db.tables.quizzes[0].state, 'revealed');
  assert.ok(t.network.telegram.some(function (c) { return c.method === 'editMessageReplyMarkup'; }));
  await t.bot.handleUpdate(tap(6, 'qz:' + ID + ':1'));
  assert.match(t.network.telegram.filter(function (c) { return c.method === 'answerCallbackQuery'; }).pop().payload.text, /انتهى/);
  assert.equal(t.db.tables.quiz_answers.length, 0);
  assert.equal((await runQuizCycle(t.bot.ctx)).revealed, 0);
});

test('a Telegram error releases the claim and the next cycle retries; a stale claim is recovered after the timeout', async function () {
  let fail = true;
  const t = setup([quiz], { telegram: { sendMessage: function () {
    if (fail) { fail = false; return json(500, { ok: false, error_code: 500, description: 'x' }); }
    return null;
  } } });
  assert.equal((await runQuizCycle(t.bot.ctx)).posted, 0);
  assert.equal(t.db.tables.quizzes[0].state, 'scheduled');
  assert.equal((await runQuizCycle(t.bot.ctx)).posted, 1);

  const stuck = setup([Object.assign({}, quiz, { state: 'claiming', claimed_at: new Date(NOW - 60 * 1000).toISOString() })]);
  assert.equal((await runQuizCycle(stuck.bot.ctx)).posted, 0);
  stuck.setNow(NOW + 3 * 60 * 1000);
  assert.equal((await runQuizCycle(stuck.bot.ctx)).posted, 1);
});

test('/top ranks this week only and escapes names; weeks start on Saturday', async function () {
  const answers = [
    { quiz_id: ID, telegram_user_id: 5, display_name: 'Ali<i>', is_correct: true, answered_at: '2026-11-30T09:00:00Z', choice_index: 1 },
    { quiz_id: 'b', telegram_user_id: 5, display_name: 'Ali<i>', is_correct: true, answered_at: '2026-12-01T09:00:00Z', choice_index: 1 },
    { quiz_id: 'b', telegram_user_id: 6, display_name: 'Sara', is_correct: true, answered_at: '2026-12-01T09:00:00Z', choice_index: 1 },
    { quiz_id: 'c', telegram_user_id: 6, display_name: 'Sara', is_correct: true, answered_at: '2026-11-20T09:00:00Z', choice_index: 1 },
    { quiz_id: 'c', telegram_user_id: 7, display_name: 'Old', is_correct: false, answered_at: '2026-12-01T09:00:00Z', choice_index: 0 }
  ];
  const t = setup([], { answers: answers });
  await t.bot.handleUpdate(textMessage('/top'));
  const text = sent(t.network).pop().payload.text;
  assert.match(text, /1\. Ali&lt;i&gt;: 2/);
  assert.match(text, /2\. Sara: 1/);
  assert.doesNotMatch(text, /Old/);
});

test('quiz scheduler can be disabled from the environment', async function () {
  const t = setup([quiz], { env: { BOT_QUIZ_ENABLED: 'false' } });
  await t.bot.start();
  await t.bot.stop();
  assert.equal(sent(t.network).length, 0);
});

test('/top counts every correct answer of the week across pages (no silent 5000 cut-off)', async function () {
  const answers = [];
  for (let i = 0; i < 2500; i += 1) {
    answers.push({ quiz_id: 'q' + i, telegram_user_id: i % 2 === 0 ? 5 : 6, display_name: i % 2 === 0 ? 'Even' : 'Odd',
      is_correct: true, answered_at: '2026-12-01T09:00:00Z', choice_index: 1 });
  }
  for (let i = 0; i < 6; i += 1) {
    answers.push({ quiz_id: 'z' + i, telegram_user_id: 7, display_name: 'Late', is_correct: true,
      answered_at: '2026-12-02T09:00:00Z', choice_index: 1 });
  }
  const t = setup([], { answers: answers });
  await t.bot.handleUpdate(textMessage('/top'));
  const text = sent(t.network).pop().payload.text;
  assert.match(text, /1\. Even: 1250/);
  assert.match(text, /2\. Odd: 1250/);
  assert.match(text, /3\. Late: 6/);
  assert.doesNotMatch(text, /جزئي/);
  const gets = t.db.log.filter(function (l) { return l.table === 'quiz_answers' && l.method === 'GET'; });
  assert.equal(gets.length, 3);
});
