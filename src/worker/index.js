'use strict';

/**
 * Haress Cloudflare Worker.
 *
 * المسارات:
 * - /api/* : يُوجّه إلى الخادم الخلفي عبر متغير الربط API_BACKEND_URL.
 *   إذا لم يكن API_BACKEND_URL مضبوطًا أو كان غير آمن (ليس https، باستثناء localhost
 *   للتطوير)، يرد العامل بخطأ 503 (fail-closed). وهذا يضمن ألا تستخدم معاينة Preview
 *   خادم إنتاج Production عن طريق الخطأ.
 * - المسارات الأخرى: تُخدم من الأصول الثابتة (دليل ./app) عبر ربط ASSETS.
 *
 * يحول العامل الطريقة والرؤوس والجسم كما هي، دون حقن أسرار أو تسجيلها.
 */

const API_PATH_PREFIX = '/api/';

// رؤوس يتم تجاوزها عند التحويل (hend-by-hop ورؤوس Cloudflare الخاصة)
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'cf-ipcountry',
  'cf-worker'
]);

function apiPathFrom(urlPathname) {
  if (typeof urlPathname !== 'string') return null;
  if (!urlPathname.startsWith(API_PATH_PREFIX)) return null;
  return urlPathname;
}

export function isSecureBackendUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    // http مسموح فقط لـ localhost في بيئة التطوير المحلية.
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') return true;
    return false;
  } catch {
    return false;
  }
}

function copyHeaders(source) {
  const headers = new Headers();
  for (const [key, value] of source.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    headers.set(key, value);
  }
  return headers;
}

async function proxyToBackend(request, backendUrl, fetchImpl) {
  const requestUrl = new URL(request.url);
  const apiPath = apiPathFrom(requestUrl.pathname);
  if (!apiPath) return null;

  if (!isSecureBackendUrl(backendUrl)) {
    return new Response(
      JSON.stringify({ error: 'خادم الواجهة الخلفية غير مضبط بشكل آمن.' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        }
      }
    );
  }

  const targetUrl = new URL(apiPath, backendUrl);
  // Preserve query parameters used by filtered, paginated, and searched API requests.
  targetUrl.search = requestUrl.search;
  const target = targetUrl.href;
  const init = {
    method: request.method,
    headers: copyHeaders(request.headers),
    body: request.body,
    signal: request.signal
  };

  try {
    const response = await fetchImpl(target, init);
    const outHeaders = {};
    for (const [key, value] of response.headers.entries()) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      outHeaders[key] = value;
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders
    });
  } catch {
    return new Response(
      JSON.stringify({ error: 'تعذر الاتصال بالخادم الخلفي.' }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        }
      }
    );
  }
}

export async function handleRequest(request, env, fetchImpl = globalThis.fetch) {
  const backendUrl = env && env.API_BACKEND_URL ? String(env.API_BACKEND_URL) : '';

  const proxied = await proxyToBackend(request, backendUrl, fetchImpl);
  if (proxied) return proxied;

  // خدمة الأصول الثابتة عبر ربط Cloudflare Assets (إن توفر).
  const assets = env && env.ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    return assets.fetch(request);
  }

  return new Response(JSON.stringify({ error: 'الصفحة غير موجودة.' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, globalThis.fetch);
  }
};
