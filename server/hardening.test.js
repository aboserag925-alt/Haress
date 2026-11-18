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
  GEMINI_API_KEY: 'test-gemini-key',
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
  function jsonResponse(payload) {
    return {
      ok: true,
      status: 200,
      arrayBuffer: async function () { return Buffer.from(JSON.stringify(payload), 'utf8'); }
    };
  }
  return async function (url) {
    let hostname = '';
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      // Invalid URLs are not treated as requests to the Gemini API.
    }
    if (hostname === 'generativelanguage.googleapis.com') {
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'مسودة للمراجعة.' }] } }] });
    }
    return jsonResponse({ ok: true });
  };
}

test('mock fetch recognizes only the exact Gemini API hostname', async function () {
  const mockFetch = okFetch();
  const valid = await mockFetch('https://generativelanguage.googleapis.com/v1beta/models/test:generateContent');
  assert.equal((await readMockJson(valid)).candidates[0].content.parts[0].text, 'مسودة للمراجعة.');

  const lookalike = await mockFetch('https://generativelanguage.googleapis.com.attacker.example/v1');
  assert.deepEqual(await readMockJson(lookalike), { ok: true });

  const pathLookalike = await mockFetch('https://attacker.example/generativelanguage.googleapis.com');
  assert.deepEqual(await readMockJson(pathLookalike), { ok: true });
});

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
  assert.doesNotThrow(function () {
    assertProductionConfig(Object.assign({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'x' }, questionsEnv));
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
