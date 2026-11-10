'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminApi, isAllowedLiveUrl } = require('./lecture-api');

function responseRecorder() {
  return {
    status: 0, headers: {}, body: '',
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers || {}); },
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value || ''; }
  };
}
function request(method, pathname, body, headers = {}) {
  return {
    method, headers: {
      host: 'api.example.test',
      origin: 'https://app.example.test',
      authorization: 'Bearer valid-session-token',
      'content-type': 'application/json',
      ...headers
    },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); }
  };
}
function makeFetch({ admin = true, rows } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'user-1', email: 'admin@example.test' }) };
    }
    if (String(url).includes('/rest/v1/admin_users?')) {
      return { ok: true, json: async () => admin ? [{ user_id: 'user-1' }] : [] };
    }
    if (String(url).includes('/rest/v1/live_state')) {
      if (init.method === 'POST') {
        const row = JSON.parse(init.body);
        rows = [{ ...row, updated_at: '2026-11-11T00:00:00.000Z' }];
        return { ok: true, json: async () => rows };
      }
      return { ok: true, json: async () => rows || [{ id: 1, is_live: false, stream_url: null, stream_title: 'البث المباشر', provider: null }] };
    }
    if (String(url).includes('/rest/v1/audit_log')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fetch.calls = calls;
  fetch.getRows = () => rows;
  return fetch;
}
const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-service-role-value',
  ALLOWED_ORIGINS: 'https://app.example.test',
  LIVE_ALLOWED_HOSTS: 'tiktok.com,facebook.com,t.me'
};

test('rejects non-HTTPS, javascript/data and unlisted stream hosts', () => {
  assert.equal(isAllowedLiveUrl('javascript:alert(1)', env), false);
  assert.equal(isAllowedLiveUrl('data:text/html,hello', env), false);
  assert.equal(isAllowedLiveUrl('http://tiktok.com/@x/live', env), false);
  assert.equal(isAllowedLiveUrl('https://evil.example/live', env), false);
  assert.equal(isAllowedLiveUrl('https://sub.tiktok.com/@x/live', env), true);
});

test('rejects an authenticated but non-admin user', async () => {
  const fetch = makeFetch({ admin: false });
  const handler = createAdminApi({ env, fetch });
  const res = responseRecorder();
  await handler(request('POST', '/api/admin/live', {
    is_live: true, stream_url: 'https://www.tiktok.com/@x/live', stream_title: 'بث'
  }), res, '/api/admin/live');
  assert.equal(res.status, 403);
  assert.equal(fetch.calls.some(call => call.init.method === 'POST' && call.url.includes('/live_state')), false);
});

test('rejects invalid stream URL before any database write', async () => {
  const fetch = makeFetch();
  const handler = createAdminApi({ env, fetch });
  const res = responseRecorder();
  await handler(request('POST', '/api/admin/live', {
    is_live: true, stream_url: 'javascript:alert(1)', stream_title: 'بث'
  }), res, '/api/admin/live');
  assert.equal(res.status, 400);
  assert.equal(fetch.calls.some(call => call.init.method === 'POST' && call.url.includes('/live_state')), false);
});

test('upserts the singleton row and never deletes then inserts', async () => {
  const fetch = makeFetch();
  const handler = createAdminApi({ env, fetch });
  const res = responseRecorder();
  await handler(request('POST', '/api/admin/live', {
    is_live: true, stream_url: 'https://www.tiktok.com/@x/live', stream_title: 'درس مباشر'
  }), res, '/api/admin/live');
  assert.equal(res.status, 200);
  const write = fetch.calls.find(call => call.init.method === 'POST' && call.url.includes('/live_state'));
  assert.ok(write, 'upsert request exists');
  assert.match(write.url, /on_conflict=id/);
  assert.match(write.init.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(JSON.parse(write.init.body).id, 1);
  assert.equal(fetch.calls.some(call => call.init.method === 'DELETE'), false);
  assert.equal(JSON.parse(res.body).state.is_live, true);
  assert.equal(fetch.getRows().length, 1, 'the singleton row remains present after the upsert');
});

test('rejects cross-origin CSRF requests', async () => {
  const fetch = makeFetch();
  const handler = createAdminApi({ env, fetch });
  const res = responseRecorder();
  await handler(request('POST', '/api/admin/live', { is_live: false }, { origin: 'https://evil.example' }), res, '/api/admin/live');
  assert.equal(res.status, 403);
  assert.equal(fetch.calls.some(call => call.url.endsWith('/auth/v1/user')), false);
});

test('public live state is cached and legacy route keeps its exact response contract', async () => {
  const fetch = makeFetch();
  const handler = createAdminApi({ env, fetch });
  const res = responseRecorder();
  await handler(request('GET', '/api/live'), res, '/api/live');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { live: false, videoId: null });
  assert.match(res.headers['Cache-Control'], /max-age=30/);
  const stateRes = responseRecorder();
  await handler(request('GET', '/api/live/state'), stateRes, '/api/live/state');
  assert.equal(stateRes.status, 200);
  assert.match(stateRes.headers['Cache-Control'], /max-age=30/);
  assert.equal(JSON.parse(stateRes.body).is_live, false);
});

test('allows a cross-site browser request only when its exact origin is allowlisted', async () => {
  const fetch = makeFetch();
  const handler = createAdminApi({ env, fetch });
  const res = responseRecorder();
  await handler(request('POST', '/api/admin/live', {
    is_live: false, stream_title: 'البث المباشر'
  }, { origin: 'https://app.example.test', 'sec-fetch-site': 'cross-site' }), res, '/api/admin/live');
  assert.equal(res.status, 200);
  assert.equal(fetch.calls.some(call => call.init.method === 'POST' && call.url.includes('/live_state')), true);
});
