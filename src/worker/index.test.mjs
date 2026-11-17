import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, isSecureBackendUrl } from './index.js';

function makeRequest(url, options = {}) {
  return new Request(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body !== undefined ? options.body : null
  });
}

async function jsonBody(response) {
  const text = await response.text();
  return JSON.parse(text);
}

describe('isSecureBackendUrl', () => {
  it('يقبل عناوين https', () => {
    assert.equal(isSecureBackendUrl('https://backend.example.com'), true);
  });
  it('يرفض القيم الفارغة أو غير النصية', () => {
    assert.equal(isSecureBackendUrl(''), false);
    assert.equal(isSecureBackendUrl(null), false);
    assert.equal(isSecureBackendUrl(undefined), false);
  });
  it('يرفض عناوين http باستثناء localhost', () => {
    assert.equal(isSecureBackendUrl('http://evil.com'), false);
    assert.equal(isSecureBackendUrl('http://localhost:8080'), true);
  });
  it('يرضح عناوين النطاقات غير الصالحة', () => {
    assert.equal(isSecureBackendUrl('not-a-url'), false);
  });
});

describe('Haress Worker: توجيه /api/*', () => {
  const env = { API_BACKEND_URL: 'https://backend.example.com' };

  it('يوجّه GET /api/health إلى الخادم الخلفي', async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = {
        url: String(url),
        method: init.method,
        headers: Object.fromEntries(init.headers.entries()),
        body: init.body
      };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const req = makeRequest('https://worker.example/api/health', { method: 'GET' });
    const res = await handleRequest(req, env, fetchImpl);

    assert.equal(res.status, 200);
    assert.equal(captured.url, 'https://backend.example.com/api/health');
    assert.equal(captured.method, 'GET');
    const body = await jsonBody(res);
    assert.equal(body.ok, true);
  });

  it('يحافظ على معاملات الاستعلام عند توجيه طلبات API', async () => {
    let capturedUrl = null;
    const fetchImpl = async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const req = makeRequest('https://worker.example/api/library?category=lectures&page=2');
    const res = await handleRequest(req, env, fetchImpl);

    assert.equal(res.status, 200);
    assert.equal(capturedUrl, 'https://backend.example.com/api/library?category=lectures&page=2');
  });

  it('يحيل رأس Authorization وجسم الطلب POST كما هما', async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = {
        url: String(url),
        method: init.method,
        headers: Object.fromEntries(init.headers.entries()),
        body: init.body ? await new Response(init.body).text() : null
      };
      return new Response(JSON.stringify({ received: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      });
    };

    const req = makeRequest('https://worker.example/api/questions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: 'Bearer test-token-123',
        origin: 'https://worker.example'
      },
      body: JSON.stringify({ question: 'سؤال اختبار', consent: true })
    });
    const res = await handleRequest(req, env, fetchImpl);

    assert.equal(res.status, 201);
    assert.equal(captured.headers.authorization, 'Bearer test-token-123');
    assert.equal(captured.method, 'POST');
    assert.match(captured.body, /سؤال اختبار/);
  });

  it('يرد 503 عند غياب API_BACKEND_URL (عزل Preview / fail-closed)', async () => {
    const req = makeRequest('https://preview-worker.example/api/health');
    const res = await handleRequest(req, {}, globalThis.fetch);
    assert.equal(res.status, 503);
    const body = await jsonBody(res);
    assert.match(body.error, /غير مضبط بشكل آمن|غير آمن/);
  });

  it('يرد 503 عندما يكون API_BACKEND_URL رابط http غير محلي', async () => {
    const unsafeEnv = { API_BACKEND_URL: 'http://evil-production.com' };
    const req = makeRequest('https://worker.example/api/health');
    const res = await handleRequest(req, unsafeEnv, globalThis.fetch);
    assert.equal(res.status, 503);
  });

  it('يسمح بـ http://localhost في التطوير المحلي', async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = String(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const localEnv = { API_BACKEND_URL: 'http://localhost:8080' };
    const req = makeRequest('https://worker.example/api/health');
    const res = await handleRequest(req, localEnv, fetchImpl);
    assert.equal(res.status, 200);
    assert.equal(captured, 'http://localhost:8080/api/health');
  });

  it('لا يوجّه المسارات غير /api/* (يعود 404 عند غياب الأصول)', async () => {
    const req = makeRequest('https://worker.example/index.html');
    const res = await handleRequest(req, env, globalThis.fetch);
    assert.equal(res.status, 404);
  });

  it('لا يتسرب API_BACKEND_URL في رؤوس أو corpo الاستجابة', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });
    const secretEnv = { API_BACKEND_URL: 'https://secret-backend.example.com' };
    const req = makeRequest('https://worker.example/api/health');
    const res = await handleRequest(req, secretEnv, fetchImpl);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes('secret-backend'), false);
    for (const [key, value] of res.headers.entries()) {
      assert.equal(String(value).includes('secret-backend'), false);
    }
  });
});

describe('Haress Worker: فشل الشبكة', () => {
  it('يرد 502 عندما يفشل استدعاء الخادم الخلفي', async () => {
    const fetchImpl = async () => {
      throw new Error('network down');
    };
    const env = { API_BACKEND_URL: 'https://backend.example.com' };
    const req = makeRequest('https://worker.example/api/health');
    const res = await handleRequest(req, env, fetchImpl);
    assert.equal(res.status, 502);
  });
});
