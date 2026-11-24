'use strict';

/**
 * Haress Cloudflare Worker.
 *
 * المسارات:
 * - مسارات المحاضرات وإدارة الاقتراحات وموافقات الذكاء الاصطناعي المحددة: تُوجّه
 *   إلى Supabase Edge Functions في Preview مع تمرير مفتاح publishable القادم من العميل فقط.
 *   يُفرض نطاق مشروع الاختبار المعتمد ولا يُقبل عنوان الإنتاج.
 * - بقية /api/*: تُوجّه إلى API_BACKEND_URL؛ وعند غيابه تُرفض بأمان (503).
 * - المسارات الأخرى: تُخدم من الأصول الثابتة (دليل ./app) عبر ربط ASSETS.
 *
 * لا يحقن العامل مفاتيح خدمة ولا يسجل مفاتيح publishable أو رموز الجلسات.
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
  'cf-worker',
  'x-client-ip',
  'x-proxy-secret'
]);

// Keep this policy identical to server/security-headers.js (a parity test enforces it).
// 'unsafe-inline' for scripts is a temporary concession: app/index.html, index.html and
// app/admin.html still use inline <script> blocks and onclick="" handlers. Remove it after
// moving them to external files, then switch script-src to 'self' only.
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()'
};

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

function supabaseFunctionRoute(pathname) {
  if (pathname === '/api/lectures') return { name: 'lectures-admin', path: '/lectures' };
  if (/^\/api\/lectures\/[0-9a-f-]{36}$/i.test(pathname)) return { name: 'lectures-admin', path: pathname.slice(4) };
  if (pathname === '/api/admin/session') return { name: 'lectures-admin', path: '/admin/session' };
  if (pathname === '/api/admin/lectures') return { name: 'lectures-admin', path: '/admin/lectures' };
  if (pathname === '/api/suggestions') return { name: 'submit-suggestion', path: '' };
  if (pathname === '/api/admin/suggestions') return { name: 'admin-operations', path: '/admin/suggestions' };
  if (/^\/api\/admin\/suggestions\/[0-9a-f-]{36}$/i.test(pathname)) return { name: 'admin-operations', path: pathname.slice(4) };
  if (/^\/api\/admin\/ai\/tasks\/[0-9a-f-]{36}\/approval$/i.test(pathname)) return { name: 'admin-operations', path: pathname.slice(4) };
  return null;
}

async function proxyToSupabaseFunction(request, env, fetchImpl) {
  if (!env || env.DEPLOYMENT_ENV !== 'preview') return null;
  const requestUrl = new URL(request.url);
  const functionRoute = supabaseFunctionRoute(requestUrl.pathname);
  if (!functionRoute) return null;

  const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const publishableKey = (request.headers.get('apikey') || '').trim();
  const approvedProjects = {
    preview: 'bevyztwoijjzfngutnys.supabase.co',
    production: 'uzepglfimareggswjzlf.supabase.co'
  };
  let approvedProject = false;
  try {
    const expectedHost = approvedProjects[env.DEPLOYMENT_ENV];
    approvedProject = Boolean(expectedHost) && new URL(supabaseUrl).hostname === expectedHost;
  } catch {
    approvedProject = false;
  }
  if (!isSecureBackendUrl(supabaseUrl) || !publishableKey || !approvedProject) {
    return new Response(JSON.stringify({ error: 'إعداد خدمة Supabase غير مكتمل أو لا يطابق مشروع البيئة المعتمد.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }

  const targetUrl = new URL('/functions/v1/' + functionRoute.name + functionRoute.path, supabaseUrl);
  targetUrl.search = requestUrl.search;
  const headers = copyHeaders(request.headers);

  try {
    const response = await fetchImpl(targetUrl.href, {
      method: request.method,
      headers,
      body: request.body,
      signal: request.signal
    });
    const outHeaders = {};
    for (const [key, value] of response.headers.entries()) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
      outHeaders[key] = value;
    }
    outHeaders['Cache-Control'] = 'no-store';
    outHeaders['X-Content-Type-Options'] = 'nosniff';
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outHeaders });
  } catch {
    return new Response(JSON.stringify({ error: 'تعذر الاتصال بخدمة Supabase.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }
}

async function proxyToBackend(request, backendUrl, fetchImpl, env) {
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

  // Remove any client-supplied x-client-ip, then inject real IP + proxy secret
  const headers = copyHeaders(request.headers);
  const realIp = request.headers.get('cf-connecting-ip') || '';
  if (realIp) {
    headers.set('x-client-ip', realIp);
  }
  if (env && env.PROXY_SHARED_SECRET) {
    headers.set('x-proxy-secret', env.PROXY_SHARED_SECRET);
  }

  const init = {
    method: request.method,
    headers: headers,
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
    // Add security headers to API responses too
    outHeaders['X-Content-Type-Options'] = 'nosniff';
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

// Only explicitly public, static representations participate in negotiation.
function prefersMarkdown(accept) {
  const qualities = new Map();
  for (const part of (accept || '').toLowerCase().split(',')) {
    const [type, ...params] = part.trim().split(';');
    const qparam = params.map(p => p.trim()).find(p => p.startsWith('q='));
    const q = qparam ? Number(qparam.slice(2)) : 1;
    if (type && Number.isFinite(q) && q >= 0 && q <= 1) qualities.set(type, q);
  }
  const markdown = qualities.get('text/markdown') || 0;
  const html = qualities.get('text/html') ?? qualities.get('text/*') ?? qualities.get('*/*') ?? 0;
  return markdown > 0 && markdown >= html;
}

async function publicDiscovery(request, env) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method) || !env?.ASSETS?.fetch) return null;
  const representations = {
    '/robots.txt': 'text/plain; charset=utf-8',
    '/sitemap.xml': 'application/xml; charset=utf-8',
    '/.well-known/api-catalog': 'application/linkset+json; charset=utf-8',
    '/openapi.json': 'application/vnd.oai.openapi+json; charset=utf-8',
    '/docs/api.md': 'text/markdown; charset=utf-8',
    '/index.md': 'text/markdown; charset=utf-8'
  };
  const home = url.pathname === '/' || url.pathname === '/index.html';
  const privateRequest = request.headers.has('authorization') || request.headers.has('cookie') || Boolean(url.search);
  const markdown = home && !privateRequest && prefersMarkdown(request.headers.get('accept'));
  const type = markdown ? 'text/markdown; charset=utf-8' : representations[url.pathname];
  if (!type) return null;
  const assetUrl = new URL(markdown ? '/index.md' : url.pathname, url.origin);
  const response = await env.ASSETS.fetch(new Request(assetUrl, {method: request.method}));
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (response.ok) headers.set('Content-Type', type);
  headers.set('Vary', 'Accept, Authorization, Cookie');
  headers.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : response.body, {status:response.status, headers});
}

export async function handleRequest(request, env, fetchImpl = globalThis.fetch) {
  const discovery = await publicDiscovery(request, env);
  if (discovery) return discovery;
  // Keep V3 assets and service-worker scope isolated, with a reversible entry redirect.
  const entryUrl = new URL(request.url);
  if (['GET', 'HEAD'].includes(request.method) &&
      ['/', '/index.html'].includes(entryUrl.pathname)) {
    entryUrl.pathname = '/v3/';
    return new Response(null, { status: 307, headers: {
      ...SECURITY_HEADERS, Location: entryUrl.href, 'Cache-Control': 'no-store',
      Vary: 'Accept, Authorization, Cookie',
      Link: '</.well-known/api-catalog>; rel="api-catalog", </docs/api.md>; rel="service-doc"; type="text/markdown", </index.md>; rel="alternate"; type="text/markdown"'
    }});
  }
  const supabaseProxied = await proxyToSupabaseFunction(request, env, fetchImpl);
  if (supabaseProxied) return supabaseProxied;

  const backendUrl = env && env.API_BACKEND_URL ? String(env.API_BACKEND_URL) : '';
  const proxied = await proxyToBackend(request, backendUrl, fetchImpl, env);
  if (proxied) return proxied;

  // خدمة الأصول الثابتة عبر ربط Cloudflare Assets (إن توفر).
  const assets = env && env.ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    const response = await assets.fetch(request);
    // Add security headers to static responses
    const newHeaders = new Headers(response.headers);
    const url = new URL(request.url);
    if (response.ok && ['/', '/index.html'].includes(url.pathname)) {
      newHeaders.append('Vary', 'Accept, Authorization, Cookie');
      newHeaders.append('Link', '</.well-known/api-catalog>; rel="api-catalog", </docs/api.md>; rel="service-doc"; type="text/markdown", </index.md>; rel="alternate"; type="text/markdown"');
    }
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      newHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }

  return new Response(JSON.stringify({ error: 'الصفحة غير موجودة.' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, globalThis.fetch);
  }
};
