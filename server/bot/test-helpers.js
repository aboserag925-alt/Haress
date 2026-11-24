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

// Tiny in-memory PostgREST stand-in: enough for the tables the bot uses.
function createFakeSupabase(seed, keys) {
  const tables = {};
  Object.keys(seed || {}).forEach(function (name) { tables[name] = JSON.parse(JSON.stringify(seed[name])); });
  keys = keys || {};
  const log = [];

  function handler(url, init, body) {
    const match = String(url).match(/\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/);
    const table = match[1];
    const query = new URLSearchParams(match[2] || '');
    tables[table] = tables[table] || [];
    const method = (init && init.method) || 'GET';
    log.push({ table: table, method: method, query: match[2] || '', body: body });
    if (method === 'GET') {
      let rows = filterRows(tables[table], query);
      if (query.get('offset')) rows = rows.slice(Number(query.get('offset')));
      if (query.get('limit')) rows = rows.slice(0, Number(query.get('limit')));
      return json(200, rows);
    }
    if (method === 'POST') {
      const prefer = (init.headers && init.headers.Prefer) || '';
      const row = Object.assign({}, keys[table + ':defaults'] || {}, body);
      const key = keys[table] || [];
      const existing = key.length
        ? tables[table].find(function (r) { return key.every(function (k) { return String(r[k]) === String(row[k]); }); })
        : null;
      if (existing) {
        if (prefer.includes('merge-duplicates')) Object.assign(existing, row);
        return json(prefer.includes('return=representation') ? 200 : 201,
          prefer.includes('ignore-duplicates') ? [] : [existing]);
      }
      if (!row.id && keys[table + ':autoid']) row.id = '00000000-0000-4000-8000-' + String(tables[table].length + 1).padStart(12, '0');
      tables[table].push(row);
      return json(201, [row]);
    }
    if (method === 'PATCH') {
      const rows = filterRows(tables[table], query);
      rows.forEach(function (r) { Object.assign(r, body); });
      return json(200, rows);
    }
    if (method === 'DELETE') {
      const rows = filterRows(tables[table], query);
      tables[table] = tables[table].filter(function (r) { return !rows.includes(r); });
      return json(204, null);
    }
    return json(400, {});
  }

  function filterRows(rows, query) {
    return rows.filter(function (row) {
      for (const [field, expression] of query.entries()) {
        if (['select', 'order', 'limit', 'offset'].includes(field)) continue;
        const dot = expression.indexOf('.');
        const op = expression.slice(0, dot);
        const value = expression.slice(dot + 1);
        const actual = row[field];
        if (op === 'eq' && String(actual) !== value) return false;
        if (op === 'neq' && String(actual) === value) return false;
        if (op === 'gte' && !(Date.parse(actual) >= Date.parse(value) || Number(actual) >= Number(value))) return false;
        if (op === 'lte' && !(Date.parse(actual) <= Date.parse(value) || Number(actual) <= Number(value))) return false;
        if (op === 'is' && String(actual === null ? 'null' : actual) !== value) return false;
        if (op === 'in') {
          const list = value.replace(/^\(|\)$/g, '').split(',');
          if (!list.includes(String(actual))) return false;
        }
      }
      return true;
    });
  }

  return { handler: handler, tables: tables, log: log };
}

module.exports.createFakeSupabase = createFakeSupabase;
