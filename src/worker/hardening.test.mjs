import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { handleRequest, SECURITY_HEADERS } from './index.js';

const require = createRequire(import.meta.url);
const serverHeaders = require('../../server/security-headers.js');

function capturingFetch() {
  const captured = {};
  const fetchImpl = async (url, init) => {
    captured.url = url;
    captured.headers = init.headers;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  return { captured, fetchImpl };
}

const env = { API_BACKEND_URL: 'https://api.example.com', PROXY_SHARED_SECRET: 'worker-secret' };

describe('Worker: client IP forwarding', () => {
  it('forwards the real visitor IP and the shared secret', async () => {
    const { captured, fetchImpl } = capturingFetch();
    const request = new Request('https://site.example/api/health', {
      headers: { 'cf-connecting-ip': '203.0.113.7' }
    });
    await handleRequest(request, env, fetchImpl);
    assert.equal(captured.headers.get('x-client-ip'), '203.0.113.7');
    assert.equal(captured.headers.get('x-proxy-secret'), 'worker-secret');
  });

  it('drops a visitor-supplied x-client-ip and x-proxy-secret', async () => {
    const { captured, fetchImpl } = capturingFetch();
    const request = new Request('https://site.example/api/health', {
      headers: { 'x-client-ip': '1.2.3.4', 'x-proxy-secret': 'guess' }
    });
    await handleRequest(request, { API_BACKEND_URL: 'https://api.example.com' }, fetchImpl);
    assert.equal(captured.headers.get('x-client-ip'), null);
    assert.equal(captured.headers.get('x-proxy-secret'), null);
  });

  it('overwrites a forged x-client-ip with the real one', async () => {
    const { captured, fetchImpl } = capturingFetch();
    const request = new Request('https://site.example/api/health', {
      headers: { 'cf-connecting-ip': '203.0.113.7', 'x-client-ip': '1.2.3.4', 'x-proxy-secret': 'guess' }
    });
    await handleRequest(request, env, fetchImpl);
    assert.equal(captured.headers.get('x-client-ip'), '203.0.113.7');
    assert.equal(captured.headers.get('x-proxy-secret'), 'worker-secret');
  });
});

describe('Worker: security headers on static assets', () => {
  it('adds CSP, HSTS and the other headers to asset responses', async () => {
    const assets = { fetch: async () => new Response('<html></html>', { status: 200 }) };
    const response = await handleRequest(new Request('https://site.example/app/'), { ASSETS: assets });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(response.headers.get(name), value, name);
    }
    assert.equal(response.status, 200);
  });

  it('keeps the CSP identical to the Node server policy', () => {
    assert.equal(SECURITY_HEADERS['Content-Security-Policy'], serverHeaders.CONTENT_SECURITY_POLICY);
    assert.equal(SECURITY_HEADERS['Permissions-Policy'], serverHeaders.PERMISSIONS_POLICY);
  });
});
