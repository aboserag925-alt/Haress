'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createServer,
  clientAddress,
  consumeDailyCap,
  assertProductionConfig
} = require('./index');
const { staticSecurityHeaders } = require('./security-headers');

const questionsEnv = {
  TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  TELEGRAM_CHAT_ID: '-1002660217755'
};

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  try {
    await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise(function (resolve, reject) {
      server.close(function (error) { if (error) reject(error); else resolve(); });
    });
  }
}

function okFetch() {
  return async function () {
    return {
      ok: true,
      status: 200,
      arrayBuffer: async function () { return Buffer.from(JSON.stringify({ ok: true }), 'utf8'); }
    };
  };
}

async function readMockJson(response) {
  return JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
}

function fakeRequest(headers, remoteAddress) {
  return { headers: headers || {}, socket: { remoteAddress: remoteAddress || '10.0.0.9' } };
}

// --- client IP behind the Cloudflare Worker -------------------------------------------

test('uses x-client-ip only when the shared secret matches', function () {
  const env = { PROXY_SHARED_SECRET: 's3cret-value' };
  const trusted = fakeRequest({ 'x-proxy-secret': 's3cret-value', 'x-client-ip': '203.0.113.7' });
  assert.equal(clientAddress(trusted, env), '203.0.113.7');
});

test('ignores x-client-ip when the secret is wrong or missing', function () {
  const env = { PROXY_SHARED_SECRET: 's3cret-value' };
  const wrong = fakeRequest({ 'x-proxy-secret': 'guess', 'x-client-ip': '203.0.113.7' });
  assert.equal(clientAddress(wrong, env), '10.0.0.9');
  const missing = fakeRequest({ 'x-client-ip': '203.0.113.7' });
  assert.equal(clientAddress(missing, env), '10.0.0.9');
});

test('ignores a forged cf-connecting-ip when a shared secret is configured', function () {
  const env = { PROXY_SHARED_SECRET: 's3cret-value', TRUST_PROXY: 'true' };
  const forged = fakeRequest({ 'cf-connecting-ip': '198.51.100.1' });
  assert.equal(clientAddress(forged, env), '10.0.0.9');
});

test('rejects a non-IP value even with the correct secret', function () {
  const env = { PROXY_SHARED_SECRET: 's3cret-value' };
  const request = fakeRequest({ 'x-proxy-secret': 's3cret-value', 'x-client-ip': 'not-an-ip' });
  assert.equal(clientAddress(request, env), '10.0.0.9');
});

test('keeps the legacy TRUST_PROXY behaviour when no shared secret is set', function () {
  const request = fakeRequest({ 'cf-connecting-ip': '198.51.100.1' });
  assert.equal(clientAddress(request, { TRUST_PROXY: 'true' }), '198.51.100.1');
  assert.equal(clientAddress(request, { TRUST_PROXY: 'false' }), '10.0.0.9');
});

// --- global daily cap -----------------------------------------------------------------

test('consumeDailyCap stops at the cap and resets on a new day', function () {
  const state = { day: '', count: 0 };
  const day1 = Date.parse('2026-11-18T10:00:00Z');
  assert.equal(consumeDailyCap(state, 2, day1), true);
  assert.equal(consumeDailyCap(state, 2, day1), true);
  assert.equal(consumeDailyCap(state, 2, day1), false);
  assert.equal(consumeDailyCap(state, 2, Date.parse('2026-11-19T00:00:01Z')), true);
});

test('the questions endpoint returns 429 after QUESTIONS_DAILY_CAP', async function () {
  const env = Object.assign({ QUESTIONS_DAILY_CAP: '1' }, questionsEnv);
  await withServer({ env: env, fetch: okFetch() }, async function (baseUrl) {
    async function ask() {
      return fetch(baseUrl + '/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ question: 'ما حكم صلاة الجماعة؟' })
      });
    }
    assert.equal((await ask()).status, 200);
    assert.equal((await ask()).status, 429);
  });
});

// --- Turnstile in production ----------------------------------------------------------

test('production refuses to start the questions form without a Turnstile secret', function () {
  assert.throws(
    function () { assertProductionConfig(Object.assign({ NODE_ENV: 'production' }, questionsEnv)); },
    /TURNSTILE_SECRET_KEY/
  );
  assert.throws(
    function () {
      assertProductionConfig(Object.assign({
        NODE_ENV: 'production',
        TURNSTILE_SECRET_KEY: 'x'
      }, questionsEnv));
    },
    /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/
  );
  assert.doesNotThrow(function () {
    assertProductionConfig(Object.assign({
      NODE_ENV: 'production',
      TURNSTILE_SECRET_KEY: 'x',
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
    }, questionsEnv));
  });
  assert.doesNotThrow(function () { assertProductionConfig({ NODE_ENV: 'production' }); });
  assert.doesNotThrow(function () { assertProductionConfig(questionsEnv); });
});

test('in production the questions endpoint fails closed without a Turnstile secret', async function () {
  const env = Object.assign({ NODE_ENV: 'production' }, questionsEnv);
  await withServer({ env: env, fetch: okFetch() }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ question: 'ما حكم صلاة الجماعة؟' })
    });
    assert.equal(response.status, 503);
  });
});

// --- static security headers ----------------------------------------------------------

test('static pages carry a CSP and Permissions-Policy, and HSTS only when enabled', async function () {
  await withServer({ env: questionsEnv, fetch: okFetch() }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/app/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
    assert.equal(response.headers.get('strict-transport-security'), null);
  });
  await withServer({ env: Object.assign({ ENABLE_HSTS: 'true' }, questionsEnv), fetch: okFetch() },
    async function (baseUrl) {
      const response = await fetch(baseUrl + '/app/');
      assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
    });
});

test('the CSP still allows what the pages need', function () {
  const policy = staticSecurityHeaders({})['Content-Security-Policy'];
  assert.match(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(policy, /challenges\.cloudflare\.com/);
  assert.match(policy, /fonts\.googleapis\.com/);
  assert.match(policy, /\*\.supabase\.co/);
});

test('allows an explicitly configured extra preview origin without replacing the primary allowlist', async function () {
  const env = {
    ALLOWED_ORIGINS: 'https://app.example',
    ALLOWED_ORIGINS_EXTRA: 'https://preview.example'
  };
  await withServer({ env: env, fetch: okFetch() }, async function (baseUrl) {
    const allowed = await fetch(baseUrl + '/api/health', {
      headers: { Origin: 'https://preview.example' }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://preview.example');

    const blocked = await fetch(baseUrl + '/api/health', {
      headers: { Origin: 'https://unknown.example' }
    });
    assert.equal(blocked.status, 403);
  });
});
