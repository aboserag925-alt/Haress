'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createBot } = require('./bot');
const { createStore } = require('./store');
const { createTelegramClient } = require('./telegram-client');
const { createQuestionService } = require('./questions');
const { createFakeNetwork, createFakeSupabase, baseEnv, json, textMessage } = require('./test-helpers');
const { createServer } = require('../index');

const KEYS = { questions: ['id'], 'questions:autoid': true, 'questions:defaults': { status: 'pending' }, question_messages: ['chat_id', 'message_id'] };
const GROUP = -100500;
const env = Object.assign({}, baseEnv, { GEMINI_API_KEY: 'g-key', TELEGRAM_BOT_ENABLED: 'true' });

function setup(options) {
  options = options || {};
  const db = createFakeSupabase({ questions: options.questions || [] }, KEYS);
  const network = createFakeNetwork({ supabase: db.handler, telegram: options.telegram });
  const store = createStore({ env: env, fetch: network.fetch });
  const client = createTelegramClient({ token: 't', fetch: network.fetch, sleep: async function () {} });
  const service = createQuestionService({
    env: env, store: store, client: client, logger: { error: function () {} },
    now: function () { return Date.parse('2026-12-01T10:00:00Z'); },
    createDraft: async function () { return 'مسودة غير معتمدة'; }
  });
  const admins = new Set(options.admins || [900]);
  const bot = createBot({
    env: env, fetch: network.fetch, sleep: async function () {}, username: 'TestBot',
    store: store, client: client, questionService: service, logger: { error: function () {} },
    now: function () { return Date.parse('2026-12-01T10:00:00Z'); }
  });
  // Administrator status comes from getChatMember. Make the fake honour the admin set.
  network.setAdmins = admins;
  return { db: db, network: network, service: service, bot: bot, admins: admins };
}

function adminFetchPatch(env2) {
  // Re-create the network so getChatMember reflects the admin set.
  return env2;
}

function withAdmins(options) {
  const admins = options.admins instanceof Set ? options.admins : new Set(options.admins || [900]);
  options.telegram = Object.assign({}, options.telegram, {
    getChatMember: function (payload) {
      return json(200, { ok: true, result: { status: admins.has(payload.user_id) ? 'administrator' : 'member' } });
    }
  });
  return options;
}

function callback(data, userId, extra) {
  return { update_id: 9, callback_query: Object.assign({
    id: 'cb', data: data, from: { id: userId, first_name: 'Admin' },
    message: { message_id: 500, chat: { id: GROUP } }
  }, extra || {}) };
}

function sent(network) {
  return network.telegram.filter(function (c) { return c.method === 'sendMessage'; });
}

test('submit stores the question, posts it with a question_id and review buttons, returns only the id', async function () {
  const t = setup(withAdmins({}));
  const result = await t.service.submit('ما شروط الحديث الصحيح؟', { source: 'web' });
  assert.deepEqual(Object.keys(result), ['id']);
  assert.equal(t.db.tables.questions.length, 1);
  assert.equal(t.db.tables.questions[0].status, 'pending');
  const message = sent(t.network)[0].payload;
  assert.equal(String(message.chat_id), String(GROUP));
  assert.match(message.text, new RegExp(result.id));
  assert.equal(message.reply_markup.inline_keyboard[0].length, 3);
  assert.equal(t.db.tables.question_messages[0].kind, 'question');
});

test('submit drops the stored question if Telegram cannot deliver it', async function () {
  const t = setup(withAdmins({
    telegram: { sendMessage: function () { return json(500, { ok: false, error_code: 500, description: 'x' }); } }
  }));
  await assert.rejects(t.service.submit('سؤال صالح للاختبار', { source: 'web' }));
  assert.equal(t.db.tables.questions.length, 0);
});

test('a moderator reply is saved for review and not published until the publish button', async function () {
  const t = setup(withAdmins({}));
  const { id } = await t.service.submit('ما حكم هذا السؤال؟', { source: 'web' });
  const questionMessageId = t.db.tables.question_messages[0].message_id;

  const reply = textMessage('هذه إجابة المشرف.');
  reply.message.chat = { id: GROUP, type: 'supergroup' };
  reply.message.from = { id: 900, is_bot: false, first_name: 'Dr' };
  reply.message.reply_to_message = { message_id: questionMessageId };
  assert.equal(await t.bot.handleUpdate(reply), true);
  assert.equal(t.db.tables.questions[0].status, 'review');
  assert.equal(t.db.tables.questions[0].answer, 'هذه إجابة المشرف.');
  assert.equal((await t.service.listPublished()).length, 0);

  await t.bot.handleUpdate(callback('q:pub:' + id, 900));
  assert.equal(t.db.tables.questions[0].status, 'published');
  const published = await t.service.listPublished();
  assert.deepEqual(Object.keys(published[0]).sort(), ['answer', 'id', 'published_at', 'question']);
  assert.equal(published[0].answer, 'هذه إجابة المشرف.');
});

test('replies from non-administrators never create an answer', async function () {
  const t = setup(withAdmins({}));
  await t.service.submit('سؤال يحتاج مراجعة', { source: 'web' });
  const reply = textMessage('أنا أجيب');
  reply.message.chat = { id: GROUP, type: 'supergroup' };
  reply.message.from = { id: 5, is_bot: false };
  reply.message.reply_to_message = { message_id: t.db.tables.question_messages[0].message_id };
  assert.equal(await t.bot.handleUpdate(reply), false);
  assert.equal(t.db.tables.questions[0].status, 'pending');
  assert.equal(t.db.tables.questions[0].answer === undefined || t.db.tables.questions[0].answer === null, true);
});

test('approve draft, edit and reject buttons are admin-only and explicit', async function () {
  const t = setup(withAdmins({}));
  const { id } = await t.service.submit('سؤال للاعتماد', { source: 'web' });

  await t.bot.handleUpdate(callback('q:ap:' + id, 5));
  assert.equal(t.db.tables.questions[0].status, 'pending');
  assert.equal((await t.service.listPublished()).length, 0);

  await t.bot.handleUpdate(callback('q:ed:' + id, 900));
  const prompt = t.db.tables.question_messages.find(function (m) { return m.kind === 'edit_prompt'; });
  assert.ok(prompt);
  const promptPayload = sent(t.network).pop().payload;
  assert.equal(promptPayload.reply_markup.force_reply, true);

  const edited = textMessage('الإجابة المعدلة');
  edited.message.chat = { id: GROUP, type: 'supergroup' };
  edited.message.from = { id: 900, is_bot: false };
  edited.message.reply_to_message = { message_id: prompt.message_id };
  await t.bot.handleUpdate(edited);
  assert.equal(t.db.tables.questions[0].status, 'review');
  assert.equal(t.db.tables.questions[0].answer, 'الإجابة المعدلة');

  await t.bot.handleUpdate(callback('q:cx:' + id, 900));
  assert.equal(t.db.tables.questions[0].status, 'pending');

  await t.bot.handleUpdate(callback('q:ap:' + id, 900));
  assert.equal(t.db.tables.questions[0].status, 'published');
  assert.equal(t.db.tables.questions[0].answer, 'مسودة غير معتمدة');
  // Pressing again does not change a processed question.
  await t.bot.handleUpdate(callback('q:rj:' + id, 900));
  assert.equal(t.db.tables.questions[0].status, 'published');
});

test('reject removes the question from review and nothing is published', async function () {
  const t = setup(withAdmins({}));
  const { id } = await t.service.submit('سؤال سيرفض', { source: 'web' });
  await t.bot.handleUpdate(callback('q:rj:' + id, 900));
  assert.equal(t.db.tables.questions[0].status, 'rejected');
  assert.equal((await t.service.listPublished()).length, 0);
});

test('callbacks from another chat are refused', async function () {
  const t = setup(withAdmins({}));
  const { id } = await t.service.submit('سؤال في مجموعة', { source: 'web' });
  await t.bot.handleUpdate(callback('q:ap:' + id, 900, { message: { message_id: 1, chat: { id: -999 } } }));
  assert.equal(t.db.tables.questions[0].status, 'pending');
});

test('a Telegram asker gets the approved answer privately and a blocked asker does not break publishing', async function () {
  const t = setup(withAdmins({
    telegram: {
      sendMessage: function (payload) {
        if (payload.chat_id === 77) {
          return json(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
        }
        return null;
      }
    }
  }));
  const { id } = await t.service.submit('سؤال من تيليجرام', { source: 'telegram', user: { id: 77 } });
  await t.bot.handleUpdate(callback('q:ap:' + id, 900));
  assert.equal(t.db.tables.questions[0].status, 'published');
  assert.ok(sent(t.network).some(function (c) { return c.payload.chat_id === 77; }));
});

test('GET /api/answers exposes only id, question, answer and published_at', async function () {
  const t = setup(withAdmins({
    questions: [
      { id: 'a', question: 'س؟', draft: 'SECRET DRAFT', status: 'published', answer: 'ج', answer_source: 'draft',
        asker_telegram_id: 4242, answered_by: 900, published_at: '2026-12-01T09:00:00Z' },
      { id: 'b', question: 'غير منشور', draft: 'SECRET 2', status: 'pending', answer: null }
    ]
  }));
  const server = createServer({ env: env, fetch: t.network.fetch, questionService: t.service });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/api/answers', { headers: { Origin: base } });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /SECRET|4242|answered_by|draft/);
    assert.deepEqual(JSON.parse(text).items.map(function (i) { return Object.keys(i).sort(); }),
      [['answer', 'id', 'published_at', 'question']]);
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});

test('POST /api/questions with Supabase stores the question and never returns the draft', async function () {
  const t = setup(withAdmins({}));
  const gemini = async function (url, init) {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return { ok: true, arrayBuffer: async function () {
        return Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'DRAFT-LEAK-CHECK' }] } }] }), 'utf8');
      } };
    }
    return t.network.fetch(url, init);
  };
  const server = createServer({ env: env, fetch: gemini });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ question: 'ما هي شروط الحديث الصحيح؟' })
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /DRAFT-LEAK-CHECK|draft/);
    const body = JSON.parse(text);
    assert.equal(body.telegramSent, true);
    assert.equal(body.status, 'pending_review');
    assert.equal(t.db.tables.questions.length, 1);
    assert.equal(t.db.tables.questions[0].draft, 'DRAFT-LEAK-CHECK');
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});

test('frontend never renders a Gemini draft to the asker', function () {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'index.html'), 'utf8');
  assert.doesNotMatch(js, /result\.draft/);
  assert.doesNotMatch(js, /questionDraft/);
  assert.doesNotMatch(html, /questionDraft/);
  assert.match(js, /\/api\/answers/);
});

test('approving a draft as is publishes it without the trailing "unapproved draft" notice', async function () {
  const { stripDraftNotice } = require('./questions');
  const draft = 'يشترط في الحديث الصحيح اتصال السند وعدالة الرواة.\n\nهذه مسودة غير معتمدة حتى يراجعها الدكتور خالد.';
  assert.equal(stripDraftNotice(draft), 'يشترط في الحديث الصحيح اتصال السند وعدالة الرواة.');
  // Ordinary content, including the word "معتمدة" elsewhere, is kept.
  const keep = 'الرواية غير معتمدة عند أهل العلم.';
  assert.equal(stripDraftNotice(keep), keep);
  assert.equal(stripDraftNotice('فقرة أولى.\nفقرة ثانية عن كتب معتمدة.'), 'فقرة أولى.\nفقرة ثانية عن كتب معتمدة.');

  const t = setup(withAdmins({}));
  t.service = createQuestionService({
    env: env, store: createStore({ env: env, fetch: t.network.fetch }),
    client: createTelegramClient({ token: 't', fetch: t.network.fetch, sleep: async function () {} }),
    logger: { error: function () {} }, createDraft: async function () { return draft; }
  });
  const bot = createBot({
    env: env, fetch: t.network.fetch, sleep: async function () {}, username: 'TestBot',
    questionService: t.service, logger: { error: function () {} }
  });
  const { id } = await t.service.submit('ما شروط الحديث الصحيح؟', { source: 'web' });
  await bot.handleUpdate(callback('q:ap:' + id, 900));
  assert.equal(t.db.tables.questions[0].answer, 'يشترط في الحديث الصحيح اتصال السند وعدالة الرواة.');
  assert.equal(t.db.tables.questions[0].draft, draft, 'the stored draft is not altered');
});

test('a demoted admin loses button access immediately, not after the admin cache expires', async function () {
  const adminSet = new Set([900]);
  const t = setup(withAdmins({ admins: adminSet }));
  const { id } = await t.service.submit('سؤال لاختبار الصلاحية', { source: 'web' });
  // Warm the 60 s admin cache with a command check while still an admin.
  assert.equal(await t.bot.ctx.isAdmin(900), true);
  adminSet.delete(900);
  assert.equal(await t.bot.ctx.isAdmin(900), true); // cached read, fine for non-destructive checks
  await t.bot.handleUpdate(callback('q:ap:' + id, 900));
  assert.equal(t.db.tables.questions[0].status, 'pending');
  assert.equal((await t.service.listPublished()).length, 0);
});
