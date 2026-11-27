import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.js';

const ORIGIN = 'https://haress-production.up.railway.app';
const UUID = '123e4567-e89b-12d3-a456-426614174000';
const SECRET = 'worker-only-test-secret';
const env = { DEPLOYMENT_ENV: 'production', LIBRARY_BACKEND_URL: ORIGIN, API_BACKEND_URL: ORIGIN, PROXY_SHARED_SECRET: SECRET };

function recorder() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers), method: init.method });
    return new Response('{}', { status: 200 });
  };
  return { calls, fetchImpl };
}

test('library GET injects the Worker secret and trusted visitor IP, while stripping client credentials', async () => {
  const r = recorder();
  const req = new Request('https://x.test/api/library', { headers: {
    authorization: 'client-auth',
    cookie: 'session=client',
    apikey: 'client-key',
    'cf-connecting-ip': '1.2.3.4',
    'x-client-ip': '203.0.113.99',
    'x-proxy-secret': 'attacker-controlled'
  } });
  const res = await handleRequest(req, env, r.fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(r.calls[0].url, ORIGIN + '/api/library');
  for (const h of ['authorization', 'cookie', 'apikey']) assert.equal(r.calls[0].headers.get(h), null);
  assert.equal(r.calls[0].headers.get('x-proxy-secret'), SECRET);
  assert.equal(r.calls[0].headers.get('x-client-ip'), '1.2.3.4');
});

test('library file route accepts only a UUID path and GET/HEAD', async () => {
  const r = recorder();
  const file = await handleRequest(new Request('https://x.test/api/library/files/' + UUID, {
    headers: { 'cf-connecting-ip': '1.2.3.4' }
  }), env, r.fetchImpl);
  assert.equal(file.status, 200);
  assert.equal(r.calls[0].headers.get('x-proxy-secret'), SECRET);
  assert.equal((await handleRequest(new Request('https://x.test/api/library', { method: 'POST' }), env, r.fetchImpl)).status, 405);
  assert.equal(r.calls.length, 1);
});

test('questions accepts only POST and forwards the Worker secret without browser credentials', async () => {
  const r = recorder();
  assert.equal((await handleRequest(new Request('https://x.test/api/questions'), env, r.fetchImpl)).status, 405);
  const ok = await handleRequest(new Request('https://x.test/api/questions', {
    method: 'POST',
    body: '{}',
    headers: { cookie: 'session=client', authorization: 'client-auth', 'cf-connecting-ip': '1.2.3.4' }
  }), env, r.fetchImpl);
  assert.equal(ok.status, 200);
  assert.equal(r.calls[0].headers.get('cookie'), null);
  assert.equal(r.calls[0].headers.get('authorization'), null);
  assert.equal(r.calls[0].headers.get('x-proxy-secret'), SECRET);
  assert.equal(r.calls[0].headers.get('x-client-ip'), '1.2.3.4');
});

test('public Railway routes fail closed when the Worker proxy secret is missing', async () => {
  const r = recorder();
  const missingSecret = { ...env };
  delete missingSecret.PROXY_SHARED_SECRET;
  const library = await handleRequest(new Request('https://x.test/api/library'), missingSecret, r.fetchImpl);
  const questions = await handleRequest(new Request('https://x.test/api/questions', {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' }
  }), missingSecret, r.fetchImpl);
  assert.equal(library.status, 503);
  assert.equal(questions.status, 503);
  assert.equal(r.calls.length, 0);
});

test('a library backend other than the recovered origin is refused', async () => {
  const r = recorder();
  const bad = { ...env, LIBRARY_BACKEND_URL: 'https://evil.example' };
  assert.equal((await handleRequest(new Request('https://x.test/api/library'), bad, r.fetchImpl)).status, 503);
  assert.equal(r.calls.length, 0);
});

test('without the production library setting, /api/library uses the normal backend route', async () => {
  const r = recorder();
  await handleRequest(new Request('https://x.test/api/library', {
    headers: { 'cf-connecting-ip': '1.2.3.4' }
  }), { DEPLOYMENT_ENV: 'production', API_BACKEND_URL: ORIGIN, PROXY_SHARED_SECRET: SECRET }, r.fetchImpl);
  assert.equal(r.calls[0].headers.get('x-proxy-secret'), SECRET);
  assert.equal(r.calls[0].headers.get('x-client-ip'), '1.2.3.4');
});
