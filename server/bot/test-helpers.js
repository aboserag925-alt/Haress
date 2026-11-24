'use strict';

// Fake Telegram + Supabase transport for bot tests. No network is used.
function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    arrayBuffer: async function () { return Buffer.from(JSON.stringify(body), 'utf8'); },
    text: async function () { return JSON.stringify(body); },
    json: async function () { return body; }
  };
}

function createFakeNetwork(options) {
  options = options || {};
  const calls = [];
  const telegram = [];
  const handlers = options.telegram || {};
  const supabase = options.supabase || function () { return json(200, []); };
  let messageId = 1000;

  async function fetchImpl(url, init) {
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    const tg = String(url).match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
    if (tg) {
      const entry = { method: tg[1], payload: body };
      telegram.push(entry);
      calls.push({ url: String(url), init: init });
      if (handlers[tg[1]]) {
        const out = await handlers[tg[1]](body, entry);
        if (out) return out;
      }
      if (tg[1] === 'sendMessage') messageId += 1;
      return json(200, { ok: true, result: tg[1] === 'sendMessage' ? { message_id: messageId } : true });
    }
    calls.push({ url: String(url), init: init });
    return supabase(String(url), init, body);
  }
  return { fetch: fetchImpl, calls: calls, telegram: telegram, json: json };
}

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_CHAT_ID: '-100500',
  SUPABASE_URL: 'https://example.supabase.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key'
};

function textMessage(text, extra) {
  return Object.assign({
    update_id: 1,
    message: {
      message_id: 10,
      date: 1700000000,
      chat: { id: 77, type: 'private' },
      from: { id: 5, is_bot: false, first_name: 'Ali' },
      text: text
    }
  }, extra || {});
}

module.exports = { baseEnv, createFakeNetwork, json, textMessage };
