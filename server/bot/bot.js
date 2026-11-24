'use strict';

const { TelegramError, createTelegramClient, escapeHtml } = require('./telegram-client');
const { createUserRateLimiter } = require('./rate-limit');
const { createStore } = require('./store');

const COMMAND_PATTERN = /^\/([A-Za-z][A-Za-z0-9_]{0,31})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/;
const ADMIN_CACHE_MS = 60 * 1000;
const DEFAULT_SITE_URL = 'https://aboserag925-alt.github.io/-hares/app/';

function intFromEnv(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function createBot(options) {
  options = options || {};
  const env = options.env || process.env;
  const fetchImpl = options.fetch || global.fetch;
  const now = options.now || function () { return Date.now(); };
  const logger = options.logger || console;
  const client = options.client || createTelegramClient({
    token: env.TELEGRAM_BOT_TOKEN,
    fetch: fetchImpl,
    sleep: options.sleep
  });
  const store = options.store || createStore({ env: env, fetch: fetchImpl });
  const groupChatId = env.TELEGRAM_MEDIA_GROUP_ID || env.TELEGRAM_CHAT_ID || '';
  const rateLimiter = createUserRateLimiter({
    limit: intFromEnv(env.BOT_RATE_LIMIT, 6, 1, 100),
    windowMs: intFromEnv(env.BOT_RATE_WINDOW_SECONDS, 30, 1, 3600) * 1000
  });

  const commands = new Map();
  const callbacks = new Map();
  const messageHandlers = [];
  const adminCache = new Map();
  const blockedUsers = new Set();
  const stoppers = [];
  const starters = [];
  let username = options.username || '';

  const ctx = {
    env: env,
    client: client,
    store: store,
    now: now,
    logger: logger,
    groupChatId: groupChatId,
    siteUrl: env.BOT_SITE_URL || DEFAULT_SITE_URL,
    escape: escapeHtml,
    mediaLibrary: options.mediaLibrary || null,
    submitQuestion: options.submitQuestion || null,
    blockedUsers: blockedUsers,
    onUserBlocked: function () {}
  };

  ctx.isAdmin = async function isAdmin(userId) {
    if (!userId || !groupChatId) return false;
    const key = String(userId);
    const cached = adminCache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    let value = false;
    try {
      const member = await client.call('getChatMember', { chat_id: groupChatId, user_id: userId });
      value = Boolean(member && ['creator', 'administrator'].includes(member.status));
    } catch (error) {
      logger.error('Telegram admin check failed: ' + error.message);
      return false;
    }
    adminCache.set(key, { value: value, expiresAt: now() + ADMIN_CACHE_MS });
    return value;
  };

  ctx.reply = function reply(message, text, extra) {
    return client.sendMessage(message.chat.id, text, extra);
  };

  function registerCommand(name, definition) {
    commands.set(name.toLowerCase(), definition);
  }

  function registerCallback(prefix, handler) {
    callbacks.set(prefix, handler);
  }

  function registerMessageHandler(handler) {
    messageHandlers.push(handler);
  }

  async function handleFailure(error, update) {
    if (error instanceof TelegramError && error.blocked) {
      // 403: the user blocked the bot or never started a private chat. Stop messaging them.
      const user = (update.message && update.message.from) ||
        (update.callback_query && update.callback_query.from);
      if (user) {
        blockedUsers.add(String(user.id));
        try { await ctx.onUserBlocked(user.id); } catch (hookError) {
          logger.error('Blocked-user cleanup failed: ' + hookError.message);
        }
      }
      return;
    }
    logger.error('Bot update failed: ' + (error && error.message));
    const chat = (update.message && update.message.chat) ||
      (update.callback_query && update.callback_query.message && update.callback_query.message.chat);
    if (chat) {
      try {
        await client.sendMessage(chat.id, 'تعذر تنفيذ الطلب الآن. حاول لاحقًا.');
      } catch (replyError) {
        logger.error('Bot error reply failed: ' + replyError.message);
      }
    }
  }

  async function handleCommand(message, match) {
    const name = match[1].toLowerCase();
    const definition = commands.get(name);
    if (!definition) return false;
    if (match[2] && username && match[2].toLowerCase() !== username.toLowerCase()) return false;

    const sender = message.from;
    if (!sender || sender.is_bot) return true;
    const decision = rateLimiter(String(sender.id), now());
    if (!decision.allowed) {
      if (decision.first) {
        await client.sendMessage(message.chat.id,
          'أرسلت أوامر كثيرة. حاول بعد ' + decision.retryAfterSeconds + ' ثانية.');
      }
      return true;
    }
    if (definition.adminOnly && !await ctx.isAdmin(sender.id)) {
      await client.sendMessage(message.chat.id, 'هذا الأمر لمشرفي المجموعة فقط.');
      return true;
    }
    if (definition.privateOnly && message.chat.type !== 'private') {
      await client.sendMessage(message.chat.id, 'استخدم هذا الأمر في محادثة خاصة مع البوت.');
      return true;
    }
    await definition.handler(ctx, message, (match[3] || '').trim());
    return true;
  }

  async function handleUpdate(update) {
    try {
      if (update.callback_query) {
        const callback = update.callback_query;
        const prefix = typeof callback.data === 'string' ? callback.data.split(':')[0] : '';
        const handler = callbacks.get(prefix);
        if (!handler) return false;
        const decision = rateLimiter('cb:' + callback.from.id, now());
        if (!decision.allowed) {
          await client.call('answerCallbackQuery', {
            callback_query_id: callback.id,
            text: 'تمهّل قليلًا ثم حاول مرة أخرى.'
          });
          return true;
        }
        await handler(ctx, callback);
        return true;
      }
      const message = update.message;
      if (!message) return false;
      if (typeof message.text === 'string') {
        const match = message.text.match(COMMAND_PATTERN);
        if (match) return await handleCommand(message, match);
      }
      for (const handler of messageHandlers) {
        if (await handler(ctx, message)) return true;
      }
      return false;
    } catch (error) {
      await handleFailure(error, update);
      return true;
    }
  }

  async function start() {
    if (!username) {
      try {
        const me = await client.call('getMe', {});
        username = me && me.username ? me.username : '';
      } catch (error) {
        logger.error('Telegram getMe failed: ' + error.message);
      }
    }
    const publicCommands = [];
    commands.forEach(function (definition, name) {
      if (definition.description && !definition.hidden) {
        publicCommands.push({ command: name, description: definition.description });
      }
    });
    for (const starter of starters) await starter();
    try {
      await client.call('setMyCommands', { commands: publicCommands });
    } catch (error) {
      logger.error('Telegram setMyCommands failed: ' + error.message);
    }
  }

  async function stop() {
    for (const stopper of stoppers) await stopper();
  }

  const bot = {
    ctx: ctx,
    handleUpdate: handleUpdate,
    registerCommand: registerCommand,
    registerCallback: registerCallback,
    registerMessageHandler: registerMessageHandler,
    onStart: function (fn) { starters.push(fn); },
    onStop: function (fn) { stoppers.push(fn); },
    start: start,
    stop: stop,
    commands: commands
  };

  const features = options.features || require('./features').all;
  features.forEach(function (feature) { feature.register(bot); });
  return bot;
}

module.exports = { createBot };
