'use strict';

const MAX_RETRY_AFTER_SECONDS = 60;
const MAX_ATTEMPTS = 3;

class TelegramError extends Error {
  constructor(method, status, description, retryAfter) {
    super('Telegram API ' + method + ' failed with status ' + status);
    this.name = 'TelegramError';
    this.method = method;
    this.status = status;
    this.description = description || '';
    this.retryAfter = retryAfter || 0;
    // 403 means the user blocked the bot, never joined it, or the bot was removed from the chat.
    this.blocked = status === 403;
  }
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createTelegramClient(options) {
  const token = options.token;
  const fetchImpl = options.fetch || global.fetch;
  const sleep = options.sleep || function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };

  async function call(method, payload) {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchImpl('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json; charset=utf-8'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify(payload || {})
      });
      let body = null;
      try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer()));
      } catch {
        body = null;
      }
      if (response.ok && body && body.ok) return body.result;

      const status = response.status || (body && body.error_code) || 0;
      const retryAfter = body && body.parameters && Number(body.parameters.retry_after);
      if (status === 429 && attempt < MAX_ATTEMPTS && Number.isFinite(retryAfter) && retryAfter > 0) {
        await sleep(Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000);
        continue;
      }
      throw new TelegramError(method, status, body && body.description, retryAfter);
    }
  }

  function sendMessage(chatId, text, extra) {
    return call('sendMessage', Object.assign({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, extra || {}));
  }

  return { call: call, sendMessage: sendMessage };
}

module.exports = { TelegramError, createTelegramClient, escapeHtml };
