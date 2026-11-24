'use strict';

const { cairoParts, cairoInstant, addDays } = require('../cairo-time');

const TYPES = ['ذكر', 'حديث', 'فائدة'];
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_TEXT = 3000;
const GRADE_OR_NUMBER = /\d|[٠-٩]|صحيح|حسن|ضعيف|درجة/;

function dailyTime(env) {
  const value = env.DAILY_CONTENT_TIME || '07:00';
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(value) ? value : '07:00';
}

function dailyEnabled(env) {
  return env.BOT_DAILY_ENABLED !== 'false';
}

function validateEntry(entry) {
  if (!TYPES.includes(entry.type)) return 'النوع يجب أن يكون: ذكر أو حديث أو فائدة.';
  if (!entry.text || entry.text.length > MAX_TEXT) return 'النص مطلوب وبحد أقصى 3000 حرف.';
  if (!entry.source || !entry.source.trim()) return 'لا يُقبل محتوى بلا مصدر. اذكر المصدر.';
  if (entry.type === 'حديث' && !GRADE_OR_NUMBER.test(entry.source)) {
    return 'مصدر الحديث يجب أن يتضمن الكتاب والرقم أو درجة الحديث.';
  }
  if (entry.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return 'صيغة التاريخ: YYYY-MM-DD.';
  return null;
}

function parseAddContent(argument) {
  const parts = argument.split('|').map(function (part) { return part.trim(); });
  if (parts.length < 3) return null;
  return { type: parts[0], text: parts[1], source: parts[2], date: parts[3] || undefined };
}

function formatPost(ctx, row) {
  return '<b>' + ctx.escape(row.type) + ' اليوم</b>\n' + ctx.escape(row.text) +
    '\n\n<b>المصدر:</b> ' + ctx.escape(row.source);
}

async function nextPublishInstant(ctx, entry) {
  const time = dailyTime(ctx.env);
  if (entry.date) return cairoInstant(entry.date, time);
  const today = cairoParts(ctx.now());
  const [hour, minute] = time.split(':').map(Number);
  const passed = today.hour * 60 + today.minute >= hour * 60 + minute;
  let date = passed ? addDays(today.date, 1) : today.date;
  const latest = ((await ctx.store.admin('daily_content?select=publish_at&order=publish_at.desc&limit=1')) || [])[0];
  if (latest) {
    const latestDate = cairoParts(Date.parse(latest.publish_at)).date;
    if (latestDate >= date) date = addDays(latestDate, 1);
  }
  return cairoInstant(date, time);
}

async function addContent(ctx, message, argument) {
  const entry = parseAddContent(argument);
  if (!entry) {
    await ctx.reply(message, [
      '<b>إضافة محتوى يومي</b>',
      'الصيغة: /addcontent النوع | النص | المصدر | التاريخ (اختياري)',
      'النوع: ذكر أو حديث أو فائدة. المصدر مطلوب دائمًا: الكتاب والرقم أو درجة الحديث.',
      'مثال: /addcontent حديث | إنما الأعمال بالنيات | صحيح البخاري 1 | 2026-12-05'
    ].join('\n'));
    return;
  }
  const problem = validateEntry(entry);
  if (problem) {
    await ctx.reply(message, ctx.escape(problem));
    return;
  }
  if (!ctx.store.adminConfigured()) {
    await ctx.reply(message, 'الجدول غير متاح الآن.');
    return;
  }
  const instant = await nextPublishInstant(ctx, entry);
  if (!instant) {
    await ctx.reply(message, 'تعذر تحديد موعد النشر. تحقق من التاريخ.');
    return;
  }
  await ctx.store.admin('daily_content', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      type: entry.type, text: entry.text, source: entry.source,
      reviewed_by: message.from.id, publish_at: new Date(instant).toISOString()
    })
  });
  await ctx.reply(message, 'أُضيف المحتوى وسيُنشر ' + ctx.escape(cairoParts(instant).date) +
    ' الساعة ' + ctx.escape(dailyTime(ctx.env)) + ' بتوقيت القاهرة.');
}

// Publishes at most one reviewed, sourced item per Cairo day. At-least-once on crash: a claim whose outcome
// is unknown is retried after CLAIM_TIMEOUT_MS, which may repeat a post Telegram had delivered.
async function runDailyCycle(ctx) {
  if (!ctx.store.adminConfigured()) return { posted: false };
  const now = ctx.now();
  const today = cairoParts(now).date;
  const nowIso = new Date(now).toISOString();

  const done = (await ctx.store.admin('daily_content?select=id,state&post_date=eq.' + today)) || [];
  let row = null;
  let claimedRow = null;
  if (done.length) {
    claimedRow = done[0];
    if (claimedRow.state !== 'claiming') return { posted: false };
  }
  const candidates = (await ctx.store.admin(
    'daily_content?select=*&' + (claimedRow ? 'id=eq.' + encodeURIComponent(claimedRow.id)
      : 'state=eq.scheduled&publish_at=lte.' + encodeURIComponent(nowIso)) +
    '&order=publish_at.asc&limit=20')) || [];
  const usable = candidates.filter(function (item) {
    return item.reviewed_by && item.source && String(item.source).trim() && TYPES.includes(item.type) &&
      (claimedRow || (item.state === 'scheduled' && Date.parse(item.publish_at) <= now));
  }).sort(function (a, b) { return Date.parse(a.publish_at) - Date.parse(b.publish_at); });
  row = usable[0];
  if (!row) return { posted: false };

  if (claimedRow) {
    if (now - Date.parse(row.claimed_at) < CLAIM_TIMEOUT_MS) return { posted: false };
    const taken = await ctx.store.admin('daily_content?id=eq.' + encodeURIComponent(row.id) +
      '&state=eq.claiming&claimed_at=eq.' + encodeURIComponent(row.claimed_at), {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ claimed_at: nowIso })
    });
    if (!Array.isArray(taken) || taken.length !== 1) return { posted: false };
  } else {
    let taken;
    try {
      taken = await ctx.store.admin('daily_content?id=eq.' + encodeURIComponent(row.id) + '&state=eq.scheduled', {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ state: 'claiming', claimed_at: nowIso, post_date: today })
      });
    } catch (error) {
      // The unique index on post_date rejects a second claim for the same day.
      ctx.logger.error('Daily content claim rejected: ' + error.message);
      return { posted: false };
    }
    if (!Array.isArray(taken) || taken.length !== 1) return { posted: false };
  }

  const target = ctx.env.DAILY_CONTENT_CHAT_ID || ctx.groupChatId;
  const release = function () {
    return ctx.store.admin('daily_content?id=eq.' + encodeURIComponent(row.id), {
      method: 'PATCH', body: JSON.stringify({ state: 'scheduled', claimed_at: null, post_date: null })
    }).catch(function () {});
  };
  try {
    await ctx.client.sendMessage(target, formatPost(ctx, row));
  } catch (error) {
    ctx.logger.error('Daily content send failed: ' + error.message);
    // A Telegram error response is a definite failure and is retried. Anything else has an unknown outcome.
    if (error.name === 'TelegramError') await release();
    return { posted: false };
  }
  await ctx.store.admin('daily_content?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH', body: JSON.stringify({ state: 'sent', published_at: new Date(ctx.now()).toISOString() })
  }).catch(function (error) { ctx.logger.error('Daily content sent but not recorded: ' + error.message); });
  return { posted: true, id: row.id };
}

function register(bot) {
  bot.registerCommand('addcontent', {
    description: 'إضافة محتوى يومي (للمشرفين)',
    adminOnly: true,
    hidden: true,
    handler: addContent
  });

  let timer = null;
  let running = false;
  bot.onStart(async function () {
    if (!dailyEnabled(bot.ctx.env) || timer) return;
    const tick = async function () {
      if (running) return;
      running = true;
      try {
        await runDailyCycle(bot.ctx);
      } catch (error) {
        bot.ctx.logger.error('Daily content cycle failed: ' + error.message);
      } finally {
        running = false;
      }
    };
    timer = setInterval(tick, 60 * 1000);
    if (timer.unref) timer.unref();
    await tick();
  });
  bot.onStop(function () {
    if (timer) clearInterval(timer);
    timer = null;
  });
}

module.exports = { register, runDailyCycle, validateEntry, parseAddContent, dailyTime };
