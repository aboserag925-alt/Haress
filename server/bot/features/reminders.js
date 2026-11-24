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

// Delivery guarantee: at-least-once per recipient with a small chance of a duplicate, never exactly-once.
// Every recipient (the group, and each private subscriber) has its own durable row:
// 1. A 'claiming' row is written first, so concurrent cycles and restarts do not double-send.
// 2. After Telegram accepts the message the row becomes 'sent' and is never sent again.
// 3. If Telegram answers with an error, the send definitely failed: the claim is released and retried.
// 4. If the process dies or the response is lost (timeout, crash after send), the outcome is unknown.
//    The claim is kept and taken over after CLAIM_TIMEOUT_MS, which may duplicate a reminder that
//    Telegram had in fact delivered. A missed reminder is judged worse than a repeated one.
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

function rowFilter(lecture, kind, target) {
  return 'sent_reminders?lecture_id=eq.' + encodeURIComponent(lecture.id) +
    '&kind=eq.' + kind + '&starts_at=eq.' + encodeURIComponent(lecture.starts_at) +
    '&target=eq.' + encodeURIComponent(target);
}

async function claim(ctx, lecture, kind, target) {
  const nowIso = new Date(ctx.now()).toISOString();
  const rows = await ctx.store.admin('sent_reminders', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      lecture_id: lecture.id, kind: kind, starts_at: lecture.starts_at, target: target,
      state: 'claiming', claimed_at: nowIso
    })
  });
  if (Array.isArray(rows) && rows.length > 0) return true;

  const existing = ((await ctx.store.admin(rowFilter(lecture, kind, target) + '&select=state,claimed_at')) || [])[0];
  if (!existing || existing.state !== 'claiming') return false;
  if (ctx.now() - Date.parse(existing.claimed_at) < CLAIM_TIMEOUT_MS) return false;
  const taken = await ctx.store.admin(rowFilter(lecture, kind, target) + '&state=eq.claiming&claimed_at=eq.' +
    encodeURIComponent(existing.claimed_at), {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ claimed_at: nowIso })
  });
  return Array.isArray(taken) && taken.length === 1;
}

async function markSent(ctx, lecture, kind, target) {
  await ctx.store.admin(rowFilter(lecture, kind, target), {
    method: 'PATCH',
    body: JSON.stringify({ state: 'sent', sent_at: new Date(ctx.now()).toISOString() })
  });
}

async function release(ctx, lecture, kind, target) {
  await ctx.store.admin(rowFilter(lecture, kind, target), { method: 'DELETE' });
}

// Sends to one recipient under its own durable claim. Returns true when Telegram accepted the message.
async function deliverTo(ctx, lecture, kind, target, chatId, text, userId) {
  if (!await claim(ctx, lecture, kind, target)) return false;
  try {
    await ctx.client.sendMessage(chatId, text);
  } catch (error) {
    if (error.name !== 'TelegramError') {
      // Unknown outcome: keep the claim, retry after CLAIM_TIMEOUT_MS.
      ctx.logger.error('Reminder outcome unknown for ' + target + ': ' + error.message);
      return false;
    }
    if (error.blocked) {
      // 403: the recipient blocked the bot or the bot lost the chat. Retrying cannot help.
      ctx.logger.error('Reminder forbidden for ' + target + ': ' + error.message);
      if (userId) await markBlocked(ctx, userId).catch(function () {});
      await markSent(ctx, lecture, kind, target).catch(function () {});
      return false;
    }
    ctx.logger.error('Reminder failed for ' + target + ': ' + error.message);
    await release(ctx, lecture, kind, target).catch(function () {});
    return false;
  }
  try {
    await markSent(ctx, lecture, kind, target);
  } catch (error) {
    ctx.logger.error('Reminder sent but could not be recorded: ' + error.message);
  }
  return true;
}

function pending(rows, lecture, kind, target, now) {
  const row = rows.find(function (candidate) {
    return candidate.lecture_id === lecture.id && candidate.kind === kind &&
      Date.parse(candidate.starts_at) === Date.parse(lecture.starts_at) && candidate.target === target;
  });
  if (!row) return true;
  if (row.state === 'sent') return false;
  return now - Date.parse(row.claimed_at) >= CLAIM_TIMEOUT_MS;
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

  const earlier = (await ctx.store.admin(
    'sent_reminders?select=lecture_id,kind,starts_at,target,state,claimed_at&lecture_id=in.(' +
    active.map(function (lecture) { return lecture.id; }).join(',') + ')')) || [];
  let subscribers = [];
  try {
    subscribers = await listSubscribers(ctx);
  } catch (error) {
    ctx.logger.error('Reminder subscribers could not be loaded: ' + error.message);
  }
  const groupTarget = ctx.env.REMINDER_CHAT_ID || ctx.groupChatId;
  let sent = 0;
  for (const lecture of active) {
    const start = Date.parse(lecture.starts_at);
    const kind = start > now ? 'hour' : 'start';
    const rescheduled = earlier.some(function (row) {
      return row.lecture_id === lecture.id && Date.parse(row.starts_at) !== start;
    });
    const text = reminderText(ctx, lecture, kind, rescheduled && kind === 'hour');
    if (groupTarget && pending(earlier, lecture, kind, 'group', now) &&
        await deliverTo(ctx, lecture, kind, 'group', groupTarget, text)) {
      sent += 1;
    }
    for (const subscriber of subscribers) {
      const target = String(subscriber.telegram_user_id);
      if (!pending(earlier, lecture, kind, target, now)) continue;
      if (await deliverTo(ctx, lecture, kind, target, subscriber.chat_id, text, subscriber.telegram_user_id)) {
        sent += 1;
      }
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

module.exports = { register, runReminderCycle, reminderText, CLAIM_TIMEOUT_MS };
