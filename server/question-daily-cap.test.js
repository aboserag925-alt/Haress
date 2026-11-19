'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeSharedDailyCap } = require('./index');

test('consumes the shared daily question budget through the atomic RPC', async function () {
  let captured;
  const allowed = await consumeSharedDailyCap({
    SUPABASE_URL: 'https://project.example/',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
  }, 200, Date.parse('2026-11-18T12:00:00.000Z'), async function (url, options) {
    captured = { url, options };
    return { ok: true, json: async function () { return true; } };
  });

  assert.equal(allowed, true);
  assert.equal(captured.url, 'https://project.example/rest/v1/rpc/consume_question_daily_cap');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.apikey, 'server-only-test-key');
  assert.deepEqual(JSON.parse(captured.options.body), {
    p_day: '2026-11-18',
    p_cap: 200
  });
});

test('returns false when the shared daily budget is exhausted', async function () {
  const allowed = await consumeSharedDailyCap({
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
  }, 200, Date.parse('2026-11-18T12:00:00.000Z'), async function () {
    return { ok: true, json: async function () { return false; } };
  });
  assert.equal(allowed, false);
});

test('fails closed when shared daily budget storage is not configured', async function () {
  await assert.rejects(
    consumeSharedDailyCap({}, 200, Date.now(), async function () {
      assert.fail('fetch must not be called without server-side Supabase credentials');
    }),
    /not configured/
  );
});

test('fails closed when the shared daily budget RPC is unavailable', async function () {
  await assert.rejects(
    consumeSharedDailyCap({
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
    }, 200, Date.now(), async function () {
      return { ok: false, status: 500 };
    }),
    /request failed/
  );
});
