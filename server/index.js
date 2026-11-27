const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { createMediaLibrary } = require('./media-library');
const { createAdminApi } = require('./lecture-api');
const { createSuggestionsApi } = require('./suggestions/suggestion-api');
const { createSuggestionService } = require('./suggestions/suggestion-service');
const { createApprovalApi } = require('./ai/approval-api');
const { createTaskService } = require('./ai/task-service');
const { normalizeSupabaseEnv } = require('./supabase-env');
const { staticSecurityHeaders } = require('./security-headers');

const PUBLIC_ROOT = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUESTION_LENGTH = 1600;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const DEFAULT_QUESTIONS_DAILY_CAP = 200;
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function loadEnvFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  contents.split(/\r?\n/).forEach(function (line, index) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) return;

    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      if (value.length < 2 || value[value.length - 1] !== quote) {
        throw new Error('Unclosed quote in .env line ' + (index + 1));
      }
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    process.env[match[1]] = value;
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.origin;
  if (!origin || !request.headers.host) return false;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') return false;

  const configuredOrigins = [env.ALLOWED_ORIGINS, env.ALLOWED_ORIGINS_EXTRA]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(function (value) { return value.trim(); })
    .filter(Boolean);
  if (configuredOrigins.length > 0) return configuredOrigins.includes(parsedOrigin.origin);
  return parsedOrigin.host.toLowerCase() === request.headers.host.toLowerCase();
}

function applyCorsHeaders(request, response, env) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!isAllowedOrigin(request, env)) return false;

  response.setHeader('Access-Control-Allow-Origin', new URL(origin).origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
  response.setHeader('Access-Control-Expose-Headers',
    'Accept-Ranges, Content-Range, Content-Length, Content-Disposition');
  return true;
}

function readJsonBody(request, response) {
  return new Promise(function (resolve, reject) {
    const declaredLength = Number(request.headers['content-length'] || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      request.resume();
      sendJson(response, 413, { error: 'حجم الطلب أكبر من المسموح.' });
      resolve(null);
      return;
    }

    const chunks = [];
    let bytes = 0;
    let exceededLimit = false;
    request.on('data', function (chunk) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        exceededLimit = true;
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', function () {
      if (exceededLimit) {
        sendJson(response, 413, { error: 'حجم الطلب أكبر من المسموح.' });
        resolve(null);
        return;
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text));
      } catch {
        sendJson(response, 400, { error: 'صيغة الطلب غير صالحة.' });
        resolve(null);
      }
    });
  });
}

async function readUtf8Json(response) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer());
  return JSON.parse(text);
}

// Compare secrets in constant time. Hashing first gives both buffers the same length,
// which timingSafeEqual requires, without leaking the secret's length.
function secretsMatch(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function clientAddress(request, env) {
  const remoteAddress = request.socket.remoteAddress || 'unknown';
  // Preferred: the Cloudflare Worker sends the real visitor IP in x-client-ip together with
  // a shared secret. Trust the IP only when the secret matches; otherwise use the socket
  // address, so a visitor can never choose their own rate-limit identity.
  const sharedSecret = env && typeof env.PROXY_SHARED_SECRET === 'string'
    ? env.PROXY_SHARED_SECRET.trim()
    : '';
  if (sharedSecret) {
    const providedSecret = request.headers['x-proxy-secret'];
    const forwardedIp = request.headers['x-client-ip'];
    if (typeof providedSecret === 'string' && typeof forwardedIp === 'string' &&
        secretsMatch(providedSecret, sharedSecret)) {
      const candidate = forwardedIp.trim();
      if (net.isIP(candidate)) return candidate;
    }
    return remoteAddress;
  }
  // Legacy: only trust Cloudflare's client-IP header when the origin is explicitly configured behind Cloudflare.
  if (!env || env.TRUST_PROXY !== 'true') return remoteAddress;
  const forwardedAddress = request.headers['cf-connecting-ip'];
  if (typeof forwardedAddress !== 'string') return remoteAddress;
  const candidate = forwardedAddress.trim();
  return net.isIP(candidate) ? candidate : remoteAddress;
}

function consumeRateLimit(limits, address, now) {
  if (limits.size > 10000) {
    limits.forEach(function (entry, key) {
      if (entry.resetAt <= now) limits.delete(key);
    });
  }

  let entry = limits.get(address);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    limits.set(address, entry);
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

// Global (all visitors) daily budget for the questions form, so a botnet that rotates IP
// addresses still cannot flood the Telegram group.
function questionsDailyCap(env) {
  const parsed = Number.parseInt(env && env.QUESTIONS_DAILY_CAP, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_QUESTIONS_DAILY_CAP;
}

function consumeDailyCap(state, cap, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.count = 0;
  }
  if (state.count >= cap) return false;
  state.count += 1;
  return true;
}

async function consumeSharedDailyCap(env, cap, now, fetchImpl) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Shared daily question budget storage is not configured');
  }
  // Pasted env values can carry an invisible BOM or whitespace, which fetch rejects in headers.
  const clean = (value) => String(value).replace(/[\uFEFF\u200B\s]/g, '');
  const serviceKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  const base = clean(env.SUPABASE_URL).replace(/\/$/, '');
  const response = await fetchImpl(base + '/rest/v1/rpc/consume_question_daily_cap', {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_day: new Date(now).toISOString().slice(0, 10),
      p_cap: cap
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 120); } catch { detail = ''; }
    throw new Error('Shared daily question budget request failed: HTTP ' + response.status + ' ' + detail);
  }
  return await response.json() === true;
}

// In production the questions form must be protected by Turnstile.
function assertProductionConfig(env) {
  const questionsConfigured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  if (env.NODE_ENV === 'production' && questionsConfigured && !env.TURNSTILE_SECRET_KEY) {
    throw new Error('TURNSTILE_SECRET_KEY is required in production when the questions form is enabled.');
  }
  if (env.NODE_ENV === 'production' && questionsConfigured &&
      (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the shared daily question budget.');
  }
}

async function verifyTurnstile(token, request, env, fetchImpl) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: false, unavailable: true };
  if (typeof token !== 'string' || token.length < 1 || token.length > 2048) {
    return { ok: false, unavailable: false };
  }

  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  const remoteAddress = clientAddress(request, env);
  if (remoteAddress !== 'unknown' && net.isIP(remoteAddress)) form.set('remoteip', remoteAddress);

  try {
    const result = await fetchImpl(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!result.ok) return { ok: false, unavailable: true };
    const payload = await readUtf8Json(result);
    let expectedHostname = '';
    try {
      expectedHostname = new URL(request.headers.origin).hostname.toLowerCase();
    } catch {
      return { ok: false, unavailable: false };
    }
    const hostname = typeof payload.hostname === 'string' ? payload.hostname.toLowerCase() : '';
    return {
      ok: payload.success === true &&
        payload.action === 'submit_question' &&
        hostname === expectedHostname,
      unavailable: false
    };
  } catch {
    return { ok: false, unavailable: true };
  }
}

function staticFilePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\\') || pathname.includes('\0')) return null;
  let segments = pathname.split('/').filter(Boolean);
  if (segments.length === 1 && (segments[0] === 'app' || segments[0] === 'screens')) {
    segments.push('index.html');
  }
  if (segments.some(function (segment) { return segment === '.' || segment === '..' || segment.startsWith('.'); })) {
    return null;
  }
  if (segments.length === 0) segments = ['index.html'];
  if (segments[0] !== 'index.html' &&
      segments[0] !== 'app' && segments[0] !== 'assets' && segments[0] !== 'screens') {
    return null;
  }
  if (segments[0] === 'index.html' && segments.length !== 1) return null;

  const filePath = path.resolve(PUBLIC_ROOT, ...segments);
  return filePath.startsWith(PUBLIC_ROOT + path.sep) || filePath === path.join(PUBLIC_ROOT, 'index.html')
    ? filePath
    : null;
}

async function sendToTelegram(question, env, fetchImpl) {
  const message = 'سؤال جديد من الموقع:\n\n' + question;
  let result;
  try {
    result = await fetchImpl(
      'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json; charset=utf-8'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
      }
    );
  } catch {
    console.error('Telegram request could not be completed');
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
  if (!result.ok) {
    console.error('Telegram request failed with status ' + result.status);
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
  let payload;
  try {
    payload = await readUtf8Json(result);
  } catch {
    console.error('Telegram returned an invalid response');
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
  if (!payload.ok) {
    console.error('Telegram rejected a question message');
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
}

function createServer(options) {
  options = options || {};
  const env = normalizeSupabaseEnv(options.env || process.env);
  const fetchImpl = options.fetch || global.fetch;
  const limits = new Map();
  const dailyCapState = { day: '', count: 0 };
  const adminApi = createAdminApi({ env: env, fetch: fetchImpl });
  const rateLimit = function (request) {
    return consumeRateLimit(limits, clientAddress(request, env), Date.now());
  };
  const suggestionService = options.suggestionService || createSuggestionService({ env: env, fetch: fetchImpl });
  const taskService = options.taskService || createTaskService({ env: env, fetch: fetchImpl });
  const suggestionsApi = createSuggestionsApi({
    env: env,
    fetch: fetchImpl,
    service: suggestionService,
    rateLimit: rateLimit
  });
  const approvalApi = createApprovalApi({
    env: env,
    fetch: fetchImpl,
    taskService: taskService,
    rateLimit: rateLimit
  });
  const mediaLibrary = options.mediaLibrary || createMediaLibrary({
    env: env,
    fetch: fetchImpl,
    storageDirectory: options.storageDirectory
  });

  return http.createServer(async function (request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');

    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname.startsWith('/api/')) {
      if (!applyCorsHeaders(request, response, env)) {
        sendJson(response, 403, { error: 'مصدر الطلب غير مسموح.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'Allow': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS' });
        response.end();
        return;
      }
    }
    if (await suggestionsApi(request, response, requestUrl.pathname)) return;
    if (await approvalApi(request, response, requestUrl.pathname)) return;
    if (await adminApi(request, response, requestUrl.pathname)) return;
    if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname === '/api/library' && request.method === 'GET') {
      try {
        sendJson(response, 200, { items: await mediaLibrary.listApproved() });
      } catch {
        console.error('Media library could not be loaded');
        sendJson(response, 500, { error: 'تعذر تحميل المكتبة الآن.' });
      }
      return;
    }
    const mediaFileMatch = requestUrl.pathname.match(/^\/api\/library\/files\/([0-9a-f-]{36})$/i);
    if (mediaFileMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      try {
        const file = await mediaLibrary.getApprovedFile(mediaFileMatch[1]);
        if (!file) {
          sendJson(response, 404, { error: 'الملف غير موجود.' });
          return;
        }
        const inline = file.item.kind === 'audio' || file.item.kind === 'video' || file.item.kind === 'image';
        let content = file.data;
        let statusCode = 200;
        let contentRange;
        const rangeHeader = request.headers.range;
        if (rangeHeader && (file.item.kind === 'audio' || file.item.kind === 'video')) {
          const range = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
          if (!range || (!range[1] && !range[2])) {
            response.writeHead(416, { 'Content-Range': 'bytes */' + file.data.length });
            response.end();
            return;
          }
          const start = range[1] ? Number(range[1]) : Math.max(0, file.data.length - Number(range[2]));
          const end = range[2] && range[1]
            ? Math.min(Number(range[2]), file.data.length - 1)
            : file.data.length - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
              start > end || start >= file.data.length) {
            response.writeHead(416, { 'Content-Range': 'bytes */' + file.data.length });
            response.end();
            return;
          }
          content = file.data.subarray(start, end + 1);
          contentRange = 'bytes ' + start + '-' + end + '/' + file.data.length;
          statusCode = 206;
        }
        const encodedFileName = encodeURIComponent(file.item.fileName)
          .replace(/[!'()*]/g, function (character) {
            return '%' + character.charCodeAt(0).toString(16).toUpperCase();
          });
        const headers = {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'Content-Disposition': (inline ? 'inline' : 'attachment') +
            "; filename*=UTF-8''" + encodedFileName,
          'Content-Length': content.length,
          'Content-Type': file.item.mimeType,
          'X-Content-Type-Options': 'nosniff'
        };
        if (contentRange) headers['Content-Range'] = contentRange;
        response.writeHead(statusCode, headers);
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch {
        console.error('Media library file could not be loaded');
        sendJson(response, 500, { error: 'تعذر تحميل الملف الآن.' });
      }
      return;
    }
    if (requestUrl.pathname === '/api/questions') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'طريقة الطلب غير مدعومة.' });
        return;
      }
      if (!isAllowedOrigin(request, env)) {
        sendJson(response, 403, { error: 'مصدر الطلب غير مسموح.' });
        return;
      }
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        sendJson(response, 503, { error: 'إعدادات Telegram غير مكتملة على الخادم.' });
        return;
      }
      if (!consumeRateLimit(limits, clientAddress(request, env), Date.now())) {
        sendJson(response, 429, { error: 'وصلت إلى حد الإرسال المؤقت. حاول لاحقًا.' });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
        request.resume();
        sendJson(response, 415, { error: 'يجب إرسال السؤال بصيغة JSON.' });
        return;
      }

      const body = await readJsonBody(request, response);
      if (body === null) return;
      if (!body || typeof body.question !== 'string') {
        sendJson(response, 400, { error: 'اكتب السؤال بصيغة صحيحة.' });
        return;
      }
      const question = body.question.trim();
      if (question.length < 5 || question.length > MAX_QUESTION_LENGTH) {
        sendJson(response, 400, { error: 'يجب أن يكون السؤال بين 5 و1600 حرف.' });
        return;
      }


      const turnstileEnabled = env.NODE_ENV === 'production' ||
        env.TURNSTILE_ENABLED === 'true' || Boolean(env.TURNSTILE_SECRET_KEY);
      if (turnstileEnabled) {
        if (!env.TURNSTILE_SECRET_KEY) {
          sendJson(response, 503, { error: 'التحقق الأمني غير متاح حاليًا. حاول لاحقًا.' });
          return;
        }
        const verification = await verifyTurnstile(body.turnstileToken, request, env, fetchImpl);
        if (!verification.ok) {
          sendJson(response, verification.unavailable ? 503 : 403, {
            error: verification.unavailable
              ? 'تعذر التحقق الأمني الآن. حاول لاحقًا.'
              : 'فشل التحقق الأمني. أعد المحاولة.'
          });
          return;
        }
      }

      // Counted only after Turnstile passes. Production uses an atomic shared Supabase RPC;
      // local memory is retained only for non-production development and tests.
      let withinDailyBudget = false;
      if (env.NODE_ENV === 'production') {
        try {
          withinDailyBudget = await consumeSharedDailyCap(env, questionsDailyCap(env), Date.now(), fetchImpl);
        } catch (error) {
          console.error('Shared daily question budget is unavailable:', String((error && error.message) || error).slice(0, 300));
          sendJson(response, 503, { error: 'تعذر التحقق من الحد اليومي للأسئلة الآن. حاول لاحقًا.' });
          return;
        }
      } else {
        withinDailyBudget = consumeDailyCap(dailyCapState, questionsDailyCap(env), Date.now());
      }
      if (!withinDailyBudget) {
        sendJson(response, 429, { error: 'بلغ الموقع حد الأسئلة اليومي. حاول غدًا.' });
        return;
      }

      try {
        await sendToTelegram(question, env, fetchImpl);
        sendJson(response, 200, { telegramSent: true });
      } catch (error) {
        if (error.message === 'تعذر تأكيد إرسال السؤال إلى Telegram.') {
          sendJson(response, 502, { error: error.message, telegramSent: false });
          return;
        }
        console.error('Question processing failed');
        sendJson(response, 502, { error: 'تعذر معالجة السؤال الآن. حاول لاحقًا.' });
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'طريقة الطلب غير مدعومة.' });
      return;
    }
    const filePath = staticFilePath(request.url);
    if (!filePath) {
      sendJson(response, 404, { error: 'الصفحة غير موجودة.' });
      return;
    }
    try {
      const file = await fs.promises.readFile(filePath);
      response.writeHead(200, Object.assign({
        'Cache-Control': 'no-cache',
        'Content-Length': file.length,
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
      }, staticSecurityHeaders(env)));
      response.end(request.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        sendJson(response, 404, { error: 'الصفحة غير موجودة.' });
        return;
      }
      console.error('Static file request failed');
      sendJson(response, 500, { error: 'تعذر تحميل الصفحة.' });
    }
  });
}

if (require.main === module) {
  loadEnvFile(path.join(PUBLIC_ROOT, '.env'));
  assertProductionConfig(process.env);
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  const host = process.env.HOST || '127.0.0.1';
  const mediaLibrary = createMediaLibrary({ env: normalizeSupabaseEnv(process.env) });
  const server = createServer({ mediaLibrary: mediaLibrary });
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down Ahl Athar server after ' + signal + '.');
    if (server.listening) server.close();
    try {
      await mediaLibrary.stop();
    } catch {
      console.error('Telegram media intake did not stop cleanly.');
      process.exitCode = 1;
    }
  }

  process.once('SIGTERM', function () { shutdown('SIGTERM'); });
  process.once('SIGINT', function () { shutdown('SIGINT'); });

  server.listen(port, host, function () {
    if (shuttingDown) {
      server.close();
      return;
    }
    console.log('Ahl Athar server listening on port ' + port);
    mediaLibrary.start().catch(function () {
      console.error('Telegram media intake could not be started.');
      server.close(function () {});
    });
  });
}

module.exports = {
  createServer: createServer,
  loadEnvFile: loadEnvFile,
  clientAddress: clientAddress,
  consumeDailyCap: consumeDailyCap,
  consumeSharedDailyCap: consumeSharedDailyCap,
  assertProductionConfig: assertProductionConfig
};
