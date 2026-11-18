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
const { staticSecurityHeaders } = require('./security-headers');

const PUBLIC_ROOT = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUESTION_LENGTH = 1600;
const MAX_DRAFT_LENGTH = 1800;
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

  const configuredOrigins = (env.ALLOWED_ORIGINS || '')
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
  return net.isIP(candidate) ? candidate : remoteAddress;}
