'use strict';

const { cairoParts, cairoInstant, addDays } = require('../cairo-time');

const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
const LETTERS = ['أ', 'ب', 'ج', 'د'];

function quizEnabled(env) {
  return env.BOT_QUIZ_ENABLED !== 'false';
}

function quizTime(env) {
  const value = env.QUIZ_POST_TIME || '12:00';
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(value) ? value : '12:00';
}

function revealHours(env) {
  const value = Number(env.QUIZ_REVEAL_DELAY_HOURS);
  return Number.isFinite(value) && value >= 1 && value <= 48 ? value : 6;
}

// /addquiz السؤال | خيار | خيار | [خيار | خيار] | رقم الإجابة الصحيحة | الشرح | [التاريخ]
function parseAddQuiz(argument) {
  const parts = argument.split('|').map(function (part) { return part.trim(); });
  let datePart;
  if (parts.length && /^\d{4}-\d{2}-\d{2}$/.test(parts[parts.length - 1])) datePart = parts.pop();
  if (parts.length < 5) return null;
  const explanation = parts.pop();
  const correct = parts.pop();
  const question = parts.shift();
  return { question: question, options: parts, correct: Number(correct), explanation: explanation, date: datePart };
}

function validateQuiz(quiz) {
  if (!quiz.question || quiz.question.length > 300) return 'السؤال مطلوب وبحد أقصى 300 حرف.';
  if (quiz.options.length < 2 || quiz.options.length > 4 || quiz.options.some(function (o) { return !o || o.length > 100; })) {
    return 'يلزم من خيارين إلى أربعة خيارات، كل خيار حتى 100 حرف.';
  }
  if (!Number.isInteger(quiz.correct) || quiz.correct < 1 || quiz.correct > quiz.options.length) {
    return 'رقم الإجابة الصحيحة يجب أن يكون بين 1 و ' + quiz.options.length + '.';
  }
  if (!quiz.explanation || quiz.explanation.length > 1500) return 'الشرح مطلوب وبحد أقصى 1500 حرف.';
  return null;
}

function questionText(ctx, quiz) {
  return '<b>سؤال اليوم</b>\n' + ctx.escape(quiz.question) + '\n\n' + quiz.options.map(function (option, index) {
    return LETTERS[index] + '. ' + ctx.escape(option);
  }).join('\n') + '\n\nاختر إجابتك بالأزرار. تُنشر الإجابة الصحيحة والشرح لاحقًا.';
}

function keyboard(quiz) {
  return { inline_keyboard: [quiz.options.map(function (option, index) {
    return { text: LETTERS[index], callback_data: 'qz:' + quiz.id + ':' + index };
  })] };
}

async function addQuiz(ctx, message, argument) {
  const quiz = parseAddQuiz(argument);
  if (!quiz) {
    await ctx.reply(message, [
      '<b>إضافة سؤال</b>',
      'الصيغة: /addquiz السؤال | خيار 1 | خيار 2 | خيار 3 | رقم الإجابة الصحيحة | الشرح | التاريخ (اختياري)',
      'يلزم خياران على الأقل وأربعة على الأكثر. الشرح مطلوب.'
    ].join('\n'));
    return;
  }
  const problem = validateQuiz(quiz);
  if (problem) { await ctx.reply(message, ctx.escape(problem)); return; }
  if (!ctx.store.adminConfigured()) { await ctx.reply(message, 'الجدول غير متاح الآن.'); return; }

  const time = quizTime(ctx.env);
  const today = cairoParts(ctx.now());
  const [hour, minute] = time.split(':').map(Number);
  let date = quiz.date || (today.hour * 60 + today.minute >= hour * 60 + minute ? addDays(today.date, 1) : today.date);
  if (!quiz.date) {
    const latest = ((await ctx.store.admin('quizzes?select=publish_at&order=publish_at.desc&limit=1')) || [])[0];
    if (latest) {
      const latestDate = cairoParts(Date.parse(latest.publish_at)).date;
      if (latestDate >= date) date = addDays(latestDate, 1);
    }
  }
  const publishAt = cairoInstant(date, time);
  if (!publishAt) { await ctx.reply(message, 'تعذر تحديد موعد النشر. تحقق من التاريخ.'); return; }
  await ctx.store.admin('quizzes', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      question: quiz.question, options: quiz.options, correct_index: quiz.correct - 1,
      explanation: quiz.explanation, reviewed_by: message.from.id,
      publish_at: new Date(publishAt).toISOString(),
      reveal_at: new Date(publishAt + revealHours(ctx.env) * 3600 * 1000).toISOString()
    })
  });
  await ctx.reply(message, 'أُضيف السؤال وسيُنشر ' + ctx.escape(date) + ' الساعة ' + ctx.escape(time) + ' بتوقيت القاهرة.');
}

async function claim(ctx, row, fromState, toState) {
  const nowIso = new Date(ctx.now()).toISOString();
  const result = await ctx.store.admin('quizzes?id=eq.' + encodeURIComponent(row.id) + '&state=eq.' + fromState, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ state: toState, claimed_at: nowIso })
  });
  return Array.isArray(result) && result.length === 1;
}

function setState(ctx, row, state, extra) {
  return ctx.store.admin('quizzes?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH', body: JSON.stringify(Object.assign({ state: state }, extra || {}))
  });
}

async function postQuiz(ctx, row) {
  const target = ctx.env.QUIZ_CHAT_ID || ctx.groupChatId;
  if (!await claim(ctx, row, 'scheduled', 'claiming')) return false;
  let sent;
  try {
    sent = await ctx.client.call('sendMessage', {
      chat_id: target, text: questionText(ctx, row), parse_mode: 'HTML', reply_markup: keyboard(row)
    });
  } catch (error) {
    ctx.logger.error('Quiz post failed: ' + error.message);
    if (error.name === 'TelegramError') await setState(ctx, row, 'scheduled', { claimed_at: null }).catch(function () {});
    return false;
  }
  await setState(ctx, row, 'posted', { message_id: sent && sent.message_id })
    .catch(function (error) { ctx.logger.error('Quiz posted but not recorded: ' + error.message); });
  return true;
}

async function revealQuiz(ctx, row) {
  const target = ctx.env.QUIZ_CHAT_ID || ctx.groupChatId;
  if (!await claim(ctx, row, 'posted', 'revealing')) return false;
  const answers = (await ctx.store.admin('quiz_answers?select=is_correct&quiz_id=eq.' + encodeURIComponent(row.id))) || [];
  const right = answers.filter(function (a) { return a.is_correct; }).length;
  const text = '<b>إجابة سؤال اليوم</b>\n' + ctx.escape(row.question) +
    '\n\n<b>الإجابة الصحيحة:</b> ' + LETTERS[row.correct_index] + '. ' + ctx.escape(row.options[row.correct_index]) +
    '\n<b>الشرح:</b> ' + ctx.escape(row.explanation) +
    '\n\nأجاب ' + answers.length + ' وأصاب ' + right + '. لعرض الترتيب: /top';
  try {
    const params = { chat_id: target, text: text, parse_mode: 'HTML' };
    if (row.message_id) params.reply_to_message_id = row.message_id;
    await ctx.client.call('sendMessage', params);
  } catch (error) {
    ctx.logger.error('Quiz reveal failed: ' + error.message);
    if (error.name === 'TelegramError') await setState(ctx, row, 'posted', { claimed_at: null }).catch(function () {});
    return false;
  }
  await setState(ctx, row, 'revealed').catch(function (error) { ctx.logger.error('Quiz revealed but not recorded: ' + error.message); });
  if (row.message_id) {
    // Remove the answer buttons so late taps cannot change the board.
    await ctx.client.call('editMessageReplyMarkup', {
      chat_id: target, message_id: row.message_id, reply_markup: { inline_keyboard: [] }
    }).catch(function () {});
  }
  return true;
}

// At-least-once, like the other schedulers: a claim abandoned by a crash is retried after CLAIM_TIMEOUT_MS.
async function runQuizCycle(ctx) {
  if (!ctx.store.adminConfigured()) return { posted: 0, revealed: 0 };
  const now = ctx.now();
  const nowIso = encodeURIComponent(new Date(now).toISOString());
  const stale = encodeURIComponent(new Date(now - CLAIM_TIMEOUT_MS).toISOString());
  const result = { posted: 0, revealed: 0 };

  for (const row of ((await ctx.store.admin('quizzes?select=*&state=eq.claiming&claimed_at=lte.' + stale)) || [])) {
    await setState(ctx, row, 'scheduled', { claimed_at: null });
  }
  for (const row of ((await ctx.store.admin('quizzes?select=*&state=eq.revealing&claimed_at=lte.' + stale)) || [])) {
    await setState(ctx, row, 'posted', { claimed_at: null });
  }
  const due = ((await ctx.store.admin('quizzes?select=*&state=eq.scheduled&publish_at=lte.' + nowIso +
    '&order=publish_at.asc&limit=1')) || []);
  // Only the latest-due quiz per cycle; a day with several overdue quizzes posts them on successive cycles.
  if (due[0] && await postQuiz(ctx, due[0])) result.posted += 1;
  const ready = (await ctx.store.admin('quizzes?select=*&state=eq.posted&reveal_at=lte.' + nowIso +
    '&order=reveal_at.asc&limit=5')) || [];
  for (const row of ready) {
    if (await revealQuiz(ctx, row)) result.revealed += 1;
  }
  return result;
}

async function onAnswer(ctx, callback) {
  const answer = function (text) {
    return ctx.client.call('answerCallbackQuery', { callback_query_id: callback.id, text: text });
  };
  const match = /^qz:([0-9a-f-]{36}):([0-3])$/.exec(callback.data || '');
  if (!match || !ctx.store.adminConfigured()) { await answer('تعذر تسجيل الإجابة.'); return; }
  const quiz = ((await ctx.store.admin('quizzes?select=id,state,correct_index,options&id=eq.' + match[1])) || [])[0];
  const index = Number(match[2]);
  if (!quiz || index >= quiz.options.length) { await answer('تعذر تسجيل الإجابة.'); return; }
  if (quiz.state !== 'posted') { await answer('انتهى وقت الإجابة على هذا السؤال.'); return; }
  const user = callback.from;
  const inserted = await ctx.store.admin('quiz_answers', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      quiz_id: quiz.id, telegram_user_id: user.id, choice_index: index,
      display_name: [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 64) || user.username || String(user.id),
      is_correct: index === quiz.correct_index, answered_at: new Date(ctx.now()).toISOString()
    })
  });
  // The correct answer is not revealed here, only after the delay.
  await answer(Array.isArray(inserted) && inserted.length ? 'سُجلت إجابتك. تُنشر الإجابة لاحقًا.' : 'أجبت على هذا السؤال من قبل.');
}

function weekStart(ctx) {
  // Weeks start on Saturday in Cairo.
  const today = cairoParts(ctx.now()).date;
  const day = new Date(today + 'T00:00:00Z').getUTCDay();
  const back = (day + 1) % 7;
  return cairoInstant(addDays(today, -back), '00:00');
}

async function showTop(ctx, message) {
  if (!ctx.store.adminConfigured()) { await ctx.reply(message, 'الترتيب غير متاح الآن.'); return; }
  const since = encodeURIComponent(new Date(weekStart(ctx)).toISOString());
  const rows = (await ctx.store.admin('quiz_answers?select=telegram_user_id,display_name&is_correct=eq.true&answered_at=gte.' +
    since + '&limit=5000')) || [];
  const points = new Map();
  rows.forEach(function (row) {
    const entry = points.get(row.telegram_user_id) || { name: row.display_name || String(row.telegram_user_id), score: 0 };
    entry.score += 1;
    points.set(row.telegram_user_id, entry);
  });
  const board = Array.from(points.values()).sort(function (a, b) { return b.score - a.score; }).slice(0, 10);
  if (!board.length) { await ctx.reply(message, 'لا توجد نقاط هذا الأسبوع بعد.'); return; }
  await ctx.reply(message, '<b>ترتيب هذا الأسبوع</b> (نقطة لكل إجابة صحيحة)\n' + board.map(function (entry, index) {
    return (index + 1) + '. ' + ctx.escape(entry.name) + ': ' + entry.score;
  }).join('\n'));
}

function register(bot) {
  bot.registerCommand('addquiz', { description: 'إضافة سؤال (للمشرفين)', adminOnly: true, hidden: true, handler: addQuiz });
  bot.registerCommand('top', { description: 'ترتيب الأسبوع في المسابقة', handler: showTop });
  bot.registerCallback('qz', onAnswer);

  let timer = null;
  let running = false;
  bot.onStart(async function () {
    if (!quizEnabled(bot.ctx.env) || timer) return;
    const tick = async function () {
      if (running) return;
      running = true;
      try { await runQuizCycle(bot.ctx); } catch (error) {
        bot.ctx.logger.error('Quiz cycle failed: ' + error.message);
      } finally { running = false; }
    };
    timer = setInterval(tick, 60 * 1000);
    if (timer.unref) timer.unref();
    await tick();
  });
  bot.onStop(function () { if (timer) clearInterval(timer); timer = null; });
}

module.exports = { register, runQuizCycle, parseAddQuiz, validateQuiz, weekStart };
