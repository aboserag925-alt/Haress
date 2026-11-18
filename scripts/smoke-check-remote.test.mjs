import assert from 'node:assert/strict';
import test from 'node:test';
import { runRemoteSmokeCheck } from './smoke-check.mjs';

const ORIGIN = 'https://site.example';

function response(status, body, headers) {
  return {
    status: status,
    headers: new Headers(headers || {}),
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    }
  };
}

function healthyBackend(overrides) {
  const handlers = Object.assign({
    health: () => response(200, { ok: true }),
    lectures: () => response(200, { items: [] }),
    allowed: () => response(204, undefined, { 'access-control-allow-origin': ORIGIN }),
    blocked: () => response(403, { error: 'blocked' })
  }, overrides || {});
  return async (url, init) => {
    if (url.endsWith('/api/health')) return handlers.health();
    if (init.method === 'OPTIONS') {
      return init.headers.Origin === ORIGIN ? handlers.allowed() : handlers.blocked();
    }
    return handlers.lectures();
  };
}

test('remote smoke check passes against a healthy backend', async () => {
  const passed = await runRemoteSmokeCheck({
    backendUrl: 'https://api.example/',
    origin: ORIGIN,
    fetchImpl: healthyBackend()
  });
  assert.equal(passed.length, 4);
});

test('remote smoke check fails when health is not ok', async () => {
  await assert.rejects(
    runRemoteSmokeCheck({
      backendUrl: 'https://api.example',
      origin: ORIGIN,
      fetchImpl: healthyBackend({ health: () => response(503, { ok: false }) })
    }),
    /api\/health/
  );
});

test('remote smoke check fails when lectures are not returned', async () => {
  await assert.rejects(
    runRemoteSmokeCheck({
      backendUrl: 'https://api.example',
      origin: ORIGIN,
      fetchImpl: healthyBackend({ lectures: () => response(503, { error: 'not configured' }) })
    }),
    /api\/lectures/
  );
});

test('remote smoke check fails when CORS does not allow the frontend origin', async () => {
  await assert.rejects(
    runRemoteSmokeCheck({
      backendUrl: 'https://api.example',
      origin: ORIGIN,
      fetchImpl: healthyBackend({ allowed: () => response(403, { error: 'blocked' }) })
    }),
    /ALLOWED_ORIGINS/
  );
});

test('remote smoke check fails when CORS accepts an unknown origin', async () => {
  await assert.rejects(
    runRemoteSmokeCheck({
      backendUrl: 'https://api.example',
      origin: ORIGIN,
      fetchImpl: healthyBackend({ blocked: () => response(204, undefined, { 'access-control-allow-origin': '*' }) })
    }),
    /unknown origin/
  );
});

test('remote smoke check rejects a non-https backend and a missing origin', async () => {
  await assert.rejects(
    runRemoteSmokeCheck({ backendUrl: 'http://api.example', origin: ORIGIN, fetchImpl: healthyBackend() }),
    /https/
  );
  await assert.rejects(
    runRemoteSmokeCheck({ backendUrl: 'https://api.example', fetchImpl: healthyBackend() }),
    /origin/
  );
});
