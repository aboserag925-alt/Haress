'use strict';

const WARN_RESET_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RULES = [
  'احترم الجميع والتزم بالأدب في الحديث.',
  'لا تنشر روابط أو إعلانات.',
  'لا تفتِ في مسائل الدين. أرسل سؤالك بالأمر /ask ليراجعه المشرفون.',
  'التزم بموضوع المجلس.'
];

function enabled(env, name) {
  return env[name] !== 'false';
}

function intEnv(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function rulesList(env) {
  const custom = (env.BOT_RULES || '').split('|').map(function (rule) { return rule.trim(); }).filter(Boolean);
  return custom.length ? custom : DEFAULT_RULES;
}

function rulesText(ctx) {
  return '<b>قواعد المجموعة</b>\n' + rulesList(ctx.env).map(function (rule, index) {
    return (index + 1) + '. ' + ctx.escape(rule);
  }).join('\n');
}

function allowedDomains(ctx) {
  const list = (ctx.env.BOT_ALLOWED_LINK_DOMAINS || '').split(',')
    .map(function (value) { return value.trim().toLowerCase(); }).filter(Boolean);
  try { list.push(new URL(ctx.siteUrl).hostname.toLowerCase()); } catch { /* no site host */ }
  return list;
}

const URL_PATTERN = /(?:https?:\/\/|www\.|\bt\.me\/|\b[a-z0-9-]+\.(?:com|net|org|io|me|ly|xyz|info|ru|app|link|cc|co)\b)\S*/i;

function hostOf(text) {
  const match = /(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i.exec(text);
  return match ? match[1].toLowerCase() : '';
}

function containsLink(ctx, message) {
  const text = message.text || message.caption || '';
  const entities = (message.entities || []).concat(message.caption_entities || []);
  const found = [];
  entities.forEach(function (entity) {
    if (entity.type === 'url') found.push(text.substr(entity.offset, entity.length));
    if (entity.type === 'text_link' && entity.url) found.push(entity.url);
  });
  if (!found.length) {
    const match = URL_PATTERN.exec(text);
    if (match) found.push(match[0]);
  }
  if (!found.length) return false;
  const allowed = allowedDomains(ctx);
  return found.some(function (link) {
    const host = hostOf(link);
    return !allowed.some(function (domain) { return host === domain || host.endsWith('.' + domain); });
  });
}

// Warning counts live in Supabase when configured (survive restarts), else in memory.
function createWarningStore(ctx) {
  const memory = new Map();
  return {
    async increment(chatId, userId) {
      const now = ctx.now();
      if (!ctx.store.adminConfigured()) {
        const key = chatId + ':' + userId;
        const entry = memory.get(key);
        const count = entry && now - entry.at < WARN_RESET_MS ? entry.count + 1 : 1;
        memory.set(key, { count: count, at: now });
        return count;
      }
      const filter = 'member_warnings?chat_id=eq.' + encodeURIComponent(chatId) +
        '&telegram_user_id=eq.' + encodeURIComponent(userId);
      const row = ((await ctx.store.admin(filter + '&select=warnings,updated_at')) || [])[0];
      const count = row && now - Date.parse(row.updated_at) < WARN_RESET_MS ? row.warnings + 1 : 1;
      await ctx.store.admin('member_warnings', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          chat_id: chatId, telegram_user_id: userId, warnings: count, updated_at: new Date(now).toISOString()
        })
      });
      return count;
    },
    async reset(chatId, userId) {
      if (!ctx.store.adminConfigured()) { memory.delete(chatId + ':' + userId); return; }
      await ctx.store.admin('member_warnings?chat_id=eq.' + encodeURIComponent(chatId) +
        '&telegram_user_id=eq.' + encodeURIComponent(userId), { method: 'DELETE' });
    }
  };
}

function userLabel(ctx, user) {
  return user.username ? '@' + ctx.escape(user.username) : ctx.escape(user.first_name || String(user.id));
}

function register(bot) {
  const ctx = bot.ctx;
  const warnings = createWarningStore(ctx);
  const limit = intEnv(ctx.env.BOT_WARN_LIMIT, 2, 1, 10);
  const muteMinutes = intEnv(ctx.env.BOT_MUTE_MINUTES, 60, 1, 7 * 24 * 60);
  const welcomeSeconds = intEnv(ctx.env.BOT_WELCOME_DELETE_SECONDS, 60, 5, 3600);
  const timers = new Set();
  const warnedAboutRights = { value: false };

  async function mute(chatId, userId, minutes) {
    const until = Math.floor(ctx.now() / 1000) + minutes * 60;
    await ctx.client.call('restrictChatMember', {
      chat_id: chatId, user_id: userId, until_date: until,
      permissions: { can_send_messages: false }
    });
  }

  async function safeModerate(action) {
    try {
      return await action();
    } catch (error) {
      // 400/403 here usually means the bot lacks delete or restrict rights in the group.
      if (!warnedAboutRights.value) {
        warnedAboutRights.value = true;
        ctx.logger.error('Moderation action failed (check the bot admin rights): ' + error.message);
      }
      return null;
    }
  }

  // Applies one warning. At the limit the member is muted temporarily and the counter restarts.
  async function applyWarning(chatId, user, reason) {
    const count = await warnings.increment(chatId, user.id);
    if (count >= limit) {
      const ok = await safeModerate(function () { return mute(chatId, user.id, muteMinutes); });
      await warnings.reset(chatId, user.id);
      await ctx.client.sendMessage(chatId, userLabel(ctx, user) + ' كُتم لمدة ' + muteMinutes +
        ' دقيقة بسبب تكرار المخالفة: ' + ctx.escape(reason) + (ok === null ? '\n(لا أملك صلاحية التقييد.)' : ''));
      return 'muted';
    }
    await ctx.client.sendMessage(chatId, 'تنبيه إلى ' + userLabel(ctx, user) + ': ' + ctx.escape(reason) +
      '. التحذير ' + count + ' من ' + limit + '، وعند التكرار يُكتم مؤقتًا.');
    return 'warned';
  }

  bot.registerMessageHandler(async function (c, message) {
    if (!ctx.groupChatId || String(message.chat.id) !== String(ctx.groupChatId)) return false;

    if (Array.isArray(message.new_chat_members) && message.new_chat_members.length) {
      if (!enabled(ctx.env, 'BOT_WELCOME_ENABLED')) return false;
      const humans = message.new_chat_members.filter(function (member) { return !member.is_bot; });
      if (!humans.length) return true;
      const names = humans.map(function (member) { return userLabel(ctx, member); }).join('، ');
      const sent = await ctx.client.sendMessage(message.chat.id,
        'مرحبًا بك ' + names + ' في استراحة أهل الأثر.\n\n' + rulesText(ctx) +
        '\n\nتُحذف هذه الرسالة تلقائيًا بعد قليل.');
      const timer = setTimeout(function () {
        timers.delete(timer);
        ctx.client.call('deleteMessage', { chat_id: message.chat.id, message_id: sent.message_id })
          .catch(function () {});
      }, welcomeSeconds * 1000);
      if (timer.unref) timer.unref();
      timers.add(timer);
      return true;
    }

    if (!enabled(ctx.env, 'BOT_LINK_FILTER_ENABLED')) return false;
    if (!message.from || message.from.is_bot || message.sender_chat) return false;
    if (!containsLink(ctx, message)) return false;
    if (await ctx.isAdmin(message.from.id)) return false;
    await safeModerate(function () {
      return ctx.client.call('deleteMessage', { chat_id: message.chat.id, message_id: message.message_id });
    });
    await applyWarning(message.chat.id, message.from, 'الروابط والإعلانات غير مسموحة');
    return true;
  });

  bot.registerCommand('rules', {
    description: 'قواعد المجموعة',
    handler: async function (c, message) { await c.reply(message, rulesText(c)); }
  });

  async function targetOf(c, message) {
    const replied = message.reply_to_message;
    if (!replied || !replied.from || replied.from.is_bot) {
      await c.reply(message, 'استخدم الأمر كردّ (Reply) على رسالة العضو.');
      return null;
    }
    if (await c.isAdmin(replied.from.id)) {
      await c.reply(message, 'لا يمكن تطبيق هذا الأمر على مشرف.');
      return null;
    }
    return replied.from;
  }

  if (enabled(ctx.env, 'BOT_MOD_COMMANDS_ENABLED')) {
    bot.registerCommand('warn', {
      description: 'تحذير عضو (للمشرفين)', adminOnly: true, hidden: true,
      handler: async function (c, message, argument) {
        const target = await targetOf(c, message);
        if (target) await applyWarning(message.chat.id, target, argument || 'مخالفة قواعد المجموعة');
      }
    });
    bot.registerCommand('mute', {
      description: 'كتم عضو مؤقتًا (للمشرفين)', adminOnly: true, hidden: true,
      handler: async function (c, message, argument) {
        const target = await targetOf(c, message);
        if (!target) return;
        const minutes = intEnv(argument.split(/\s+/)[0], muteMinutes, 1, 7 * 24 * 60);
        const ok = await safeModerate(function () { return mute(message.chat.id, target.id, minutes); });
        await c.reply(message, ok === null
          ? 'تعذر الكتم. تأكد أن البوت مشرف ولديه صلاحية تقييد الأعضاء.'
          : userLabel(c, target) + ' كُتم لمدة ' + minutes + ' دقيقة.');
      }
    });
  }

  bot.onStop(function () {
    timers.forEach(function (timer) { clearTimeout(timer); });
    timers.clear();
  });
}

module.exports = { register, containsLink, rulesText };
