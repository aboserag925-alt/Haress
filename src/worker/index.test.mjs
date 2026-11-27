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
    assert.equal(isSecureBackendUrl('https://user:pass@backend.example.com'), false);
    assert.equal(isSecureBackendUrl('https://backend.example.com/internal'), false);
    assert.equal(isSecureBackendUrl('https://backend.example.com/?token=x'), false);
    assert.equal(isSecureBackendUrl('https://backend.example.com/#fragment'), false);
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
    const req = makeRequest('https://worker.example/other.html');
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

describe('Haress Worker: Supabase Edge Function preview routing', () => {
  const env = {
    DEPLOYMENT_ENV: 'preview',
    SUPABASE_URL: 'https://bevyztwoijjzfngutnys.supabase.co'
  };

  it('routes public lecture reads to the test Supabase Function and injects only the publishable key', async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url: String(url), headers: Object.fromEntries(init.headers.entries()), method: init.method };
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const req = makeRequest('https://preview.example/api/lectures?limit=10', { headers: { origin: 'https://preview.example', apikey: 'sb_publishable_test_only' } });
    const res = await handleRequest(req, env, fetchImpl);
    assert.equal(res.status, 200);
    assert.equal(captured.url, 'https://bevyztwoijjzfngutnys.supabase.co/functions/v1/lectures-admin/lectures?limit=10');
    assert.equal(captured.headers.apikey, 'sb_publishable_test_only');
    assert.equal(captured.headers.authorization, undefined);
    assert.equal(captured.method, 'GET');
  });

  it("forwards the signed-in user JWT for administrator lecture writes", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url: String(url), headers: Object.fromEntries(init.headers.entries()), method: init.method, body: await new Response(init.body).text() };
      return new Response(JSON.stringify({ item: { id: '00000000-0000-4000-8000-000000000001' } }), { status: 201 });
    };
    const req = makeRequest('https://preview.example/api/lectures', {
      method: 'POST',
      headers: { origin: 'https://preview.example', apikey: 'sb_publishable_test_only', authorization: 'Bearer signed-user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'اختبار' })
    });
    const res = await handleRequest(req, env, fetchImpl);
    assert.equal(res.status, 201);
    assert.equal(captured.url, 'https://bevyztwoijjzfngutnys.supabase.co/functions/v1/lectures-admin/lectures');
    assert.equal(captured.headers.authorization, 'Bearer signed-user-jwt');
    assert.equal(captured.headers.apikey, 'sb_publishable_test_only');
    assert.match(captured.body, /اختبار/);
  });

  it('routes public suggestion submissions to the Turnstile-protected test Function', async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = {
        url: String(url),
        method: init.method,
        headers: Object.fromEntries(init.headers.entries()),
        body: await new Response(init.body).text()
      };
      return new Response(JSON.stringify({ item: { id: 'suggestion-test' } }), { status: 201 });
    };
    const payload = { category: 'bug', title: 'مشكلة في البحث', description: 'البحث لا يعرض النتائج المطلوبة', turnstileToken: 'one-time-turnstile-token' };
    const req = makeRequest('https://preview.example/api/suggestions', {
      method: 'POST',
      headers: { origin: 'https://preview.example', apikey: 'sb_publishable_test_only', 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const res = await handleRequest(req, env, fetchImpl);
    assert.equal(res.status, 201);
    assert.equal(captured.url, 'https://bevyztwoijjzfngutnys.supabase.co/functions/v1/submit-suggestion');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.headers.apikey, 'sb_publishable_test_only');
    assert.equal(captured.headers.origin, 'https://preview.example');
    assert.deepEqual(JSON.parse(captured.body), payload);
  });

  it('routes administrator suggestion reads to the admin-operations Function', async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url: String(url), headers: Object.fromEntries(init.headers.entries()), method: init.method };
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    const req = makeRequest('https://preview.example/api/admin/suggestions', {
      headers: { origin: 'https://preview.example', apikey: 'sb_publishable_test_only', authorization: 'Bearer signed-user-jwt' }
    });
    const res = await handleRequest(req, env, fetchImpl);
    assert.equal(res.status, 200);
    assert.equal(captured.url, 'https://bevyztwoijjzfngutnys.supabase.co/functions/v1/admin-operations/admin/suggestions');
    assert.equal(captured.headers.authorization, 'Bearer signed-user-jwt');
    assert.equal(captured.headers.apikey, 'sb_publishable_test_only');
  });

  it('routes AI approval requests to admin-operations without changing the signed JWT', async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url: String(url), headers: Object.fromEntries(init.headers.entries()), method: init.method };
      return new Response(JSON.stringify({ approvalId: 'approval-test' }), { status: 200 });
    };
    const req = makeRequest('https://preview.example/api/admin/ai/tasks/123e4567-e89b-42d3-a456-426614174000/approval', {
      method: 'POST',
      headers: { origin: 'https://preview.example', apikey: 'sb_publishable_test_only', authorization: 'Bearer signed-user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'IMPLEMENT', decision: 'APPROVED' })
    });
    const res = await handleRequest(req, env, fetchImpl);
    assert.equal(res.status, 200);
    assert.equal(captured.url, 'https://bevyztwoijjzfngutnys.supabase.co/functions/v1/admin-operations/admin/ai/tasks/123e4567-e89b-42d3-a456-426614174000/approval');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.headers.authorization, 'Bearer signed-user-jwt');
  });

  it('fails closed when preview Supabase configuration is incomplete', async () => {
    const req = makeRequest('https://preview.example/api/admin/session');
    const res = await handleRequest(req, { DEPLOYMENT_ENV: 'preview' }, async () => {
      throw new Error('network should not be called');
    });
    assert.equal(res.status, 503);
  });

  it('keeps production Supabase routing fail-closed until production Functions and migrations are deployed', async () => {
    const productionEnv = {
      DEPLOYMENT_ENV: 'production',
      SUPABASE_URL: 'https://uzepglfimareggswjzlf.supabase.co'
    };
    const req = makeRequest('https://hares.aboserag925.workers.dev/api/lectures', {
      headers: { apikey: 'sb_publishable_test_only' }
    });
    const res = await handleRequest(req, productionEnv, async () => {
      throw new Error('production Supabase must not be contacted before its dependencies are deployed');
    });
    assert.equal(res.status, 503);
  });

  it('rejects a preview Supabase URL in production without making a network request', async () => {
    const unsafeEnv = {
      DEPLOYMENT_ENV: 'production',
      SUPABASE_URL: 'https://bevyztwoijjzfngutnys.supabase.co'
    };
    const req = makeRequest('https://hares.aboserag925.workers.dev/api/lectures', {
      headers: { apikey: 'sb_publishable_test_only' }
    });
    const res = await handleRequest(req, unsafeEnv, async () => {
      throw new Error('preview project must never be contacted from production');
    });
    assert.equal(res.status, 503);
  });

  it('rejects a production Supabase URL in preview without making a network request', async () => {
    const unsafeEnv = { ...env, SUPABASE_URL: 'https://uzepglfimareggswjzlf.supabase.co' };
    const req = makeRequest('https://preview.example/api/lectures', { headers: { apikey: 'sb_publishable_test_only' } });
    const res = await handleRequest(req, unsafeEnv, async () => {
      throw new Error('production project must never be contacted from preview');
    });
    assert.equal(res.status, 503);
  });

  it('does not route unrelated APIs to the lectures Function', async () => {
    const req = makeRequest('https://preview.example/api/library');
    const res = await handleRequest(req, env, async () => new Response('unused'));
    assert.equal(res.status, 503);
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
