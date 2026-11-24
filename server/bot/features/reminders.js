'use strict';

const { formatTime } = require('./basic');

const HOUR_MS = 60 * 60 * 1000;
const START_GRACE_MS = 10 * 60 * 1000;
const DEFAULT_POLL_SECONDS = 60;

function pollSeconds(env) {
  const value = Number(env.REMINDER_POLL_SECONDS);
  return Number.isInteger(value) && value >= 10 && value <= 3600 ? value : DEFAULT_POLL_SECONDS;
}

function remindersEnabled(env) {
  return env.BOT_REMINDERS_ENABLED !== 'false';
}

function reminderText(ctx, lecture, kind, rescheduled) {
  const minutes = Math.max(1, Math.round((Date.parse(lecture.starts_at) - ctx.now()) / 60000));
  const when = minutes >= 55 ? 'بعد ساعة' : 'بعد ' + minutes + ' دقيقة';
  const title = ctx.escape(lecture.title);
  const time = formatTime(new Date(lecture.starts_at));
  const lines = [];
  if (rescheduled) lines.push('<b>تحديث:</b> تغيّر موعد المحاضرة.');
  if (kind === 'hour') {
    lines.push('تذكير: تبدأ «' + title + '» ' + when + '، الساعة ' + time + ' بتوقيت القاهرة.');
  } else {
    lines.push('بدأت الآن «' + title + '».');
    if (lecture.stream_url && /^https:\/\//.test(lecture.stream_url)) {
      lines.push('<a href="' + ctx.escape(lecture.stream_url) + '">رابط البث</a>');
    }
  }
  return lines.join('\n');
}

async function listSubscribers(ctx) {
  const rows = await ctx.store.admin('subscribers?select=telegram_user_id,chat_id&blocked=eq.false');
  return rows || [];
}

async function markBlocked(ctx, userId) {
  if (!ctx.store.adminConfigured()) return;
  await ctx.store.admin('subscribers?telegram_user_id=eq.' + encodeURIComponent(userId), {
    method: 'PATCH',
    body: JSON.stringify({ blocked: true })
  });
}

async function deliver(ctx, text) {
  const target = ctx.env.REMINDER_CHAT_ID || ctx.groupChatId;
  if (target) {
    try {
      await ctx.client.sendMessage(target, text);
    } catch (error) {
      // 403 on the group means the bot was removed or lost rights; retrying every cycle would not help.
      if (!error.blocked) throw error;
      ctx.logger.error('Reminder group send forbidden: ' + error.message);
    }
  }
  let subscribers = [];
  try {
    subscribers = await listSubscribers(ctx);
  } catch (error) {
    ctx.logger.error('Reminder subscribers could not be loaded: ' + error.message);
  }
  for (const subscriber of subscribers) {
    try {
      await ctx.client.sendMessage(subscriber.chat_id, text);
    } catch (error) {
      if (error.blocked) {
        await markBlocked(ctx, subscriber.telegram_user_id).catch(function () {});
      } else {
        ctx.logger.error('Private reminder failed: ' + error.message);
      }
    }
  }
}

// Claims the (lecture, kind, start time) row first, then sends. A failed send releases the claim,
// so a crash or restart never duplicates a reminder and a failed send is retried on the next cycle.
async function claim(ctx, lecture, kind) {
  const rows = await ctx.store.admin('sent_reminders', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ lecture_id: lecture.id, kind: kind, starts_at: lecture.starts_at })
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function release(ctx, lecture, kind) {
  await ctx.store.admin('sent_reminders?lecture_id=eq.' + encodeURIComponent(lecture.id) +
    '&kind=eq.' + kind + '&starts_at=eq.' + encodeURIComponent(lecture.starts_at), { method: 'DELETE' });
}

async function runReminderCycle(ctx) {
  if (!ctx.store.adminConfigured()) return { sent: 0 };
  const now = ctx.now();
  const from = new Date(now - START_GRACE_MS).toISOString();
  const to = new Date(now + HOUR_MS).toISOString();
  const lectures = (await ctx.store.admin(
    'lectures?select=id,title,starts_at,stream_url,status&status=eq.published' +
    '&starts_at=gte.' + encodeURIComponent(from) + '&starts_at=lte.' + encodeURIComponent(to) +
    '&order=starts_at.asc')) || [];
  const active = lectures.filter(function (lecture) {
    const start = Date.parse(lecture.starts_at);
    return lecture.status === 'published' && Number.isFinite(start) &&
      start >= now - START_GRACE_MS && start <= now + HOUR_MS;
  });
  if (!active.length) return { sent: 0 };

  const earlier = (await ctx.store.admin('sent_reminders?select=lecture_id,kind,starts_at&lecture_id=in.(' +
    active.map(function (lecture) { return lecture.id; }).join(',') + ')')) || [];
  let sent = 0;
  for (const lecture of active) {
    const start = Date.parse(lecture.starts_at);
    const kind = start > now ? 'hour' : 'start';
    const rescheduled = earlier.some(function (row) {
      return row.lecture_id === lecture.id && Date.parse(row.starts_at) !== start;
    });
    if (!await claim(ctx, lecture, kind)) continue;
    try {
      await deliver(ctx, reminderText(ctx, lecture, kind, rescheduled && kind === 'hour'));
      sent += 1;
    } catch (error) {
      ctx.logger.error('Lecture reminder failed: ' + error.message);
      await release(ctx, lecture, kind).catch(function () {});
    }
  }
  return { sent: sent };
}

async function toggleSubscription(ctx, message, argument) {
  if (!ctx.store.adminConfigured()) {
    await ctx.reply(message, 'التذكير الخاص غير متاح الآن.');
    return;
  }
  const userId = message.from.id;
  const existing = (await ctx.store.admin('subscribers?select=telegram_user_id,blocked&telegram_user_id=eq.' +
    encodeURIComponent(userId))) || [];
  const active = existing.length > 0 && !existing[0].blocked;
  const wantsOff = /^(off|stop|إيقاف|ايقاف)$/i.test(argument);
  if (active && (wantsOff || argument === '')) {
    await ctx.store.admin('subscribers?telegram_user_id=eq.' + encodeURIComponent(userId), { method: 'DELETE' });
    await ctx.reply(message, 'أُلغي اشتراكك في التذكير الخاص.');
    return;
  }
  if (wantsOff) {
    await ctx.reply(message, 'أنت غير مشترك في التذكير الخاص.');
    return;
  }
  await ctx.store.admin('subscribers', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ telegram_user_id: userId, chat_id: message.chat.id, blocked: false })
  });
  await ctx.reply(message, 'فُعّل التذكير الخاص: سيصلك تنبيه قبل كل محاضرة بساعة وعند بدئها. أرسل /remind مرة أخرى لإلغائه.');
}

function register(bot) {
  bot.registerCommand('remind', {
    description: 'تذكير خاص بالمحاضرات',
    privateOnly: true,
    handler: toggleSubscription
  });
  const previous = bot.ctx.onUserBlocked;
  bot.ctx.onUserBlocked = async function (userId) {
    await previous(userId);
    await markBlocked(bot.ctx, userId);
  };

  let timer = null;
  let running = false;
  bot.onStart(async function () {
    if (!remindersEnabled(bot.ctx.env) || timer) return;
    const tick = async function () {
      if (running) return;
      running = true;
      try {
        await runReminderCycle(bot.ctx);
      } catch (error) {
        bot.ctx.logger.error('Reminder cycle failed: ' + error.message);
      } finally {
        running = false;
      }
    };
    timer = setInterval(tick, pollSeconds(bot.ctx.env) * 1000);
    if (timer.unref) timer.unref();
    await tick();
  });
  bot.onStop(function () {
    if (timer) clearInterval(timer);
    timer = null;
  });
}

module.exports = { register, runReminderCycle, reminderText };
