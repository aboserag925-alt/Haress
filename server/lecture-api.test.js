'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAdminApi, validateLecture } = require('./lecture-api');

const valid = {
  title: 'شرح صحيح الإمام مسلم',
  category: 'محاضرة',
  description: 'شرح علمي',
  starts_at: '2026-11-02T19:00:00.000Z',
  stream_url: 'https://example.com/live',
  recording_url: 'https://example.com/recording',
  status: 'published',
  sheikh: 'الشيخ أحمد',
  duration_seconds: 3600,
  content_type: 'video'
};

test('accepts a complete lecture with HTTPS media links and structured metadata', () => {
  assert.equal(validateLecture(valid, false), null);
});

test('validates sheikh, duration and content type without requiring them on legacy partial updates', () => {
  assert.equal(validateLecture({ status: 'archived' }, true), null);
  assert.match(validateLecture({ ...valid, sheikh: 'x'.repeat(121) }, false), /اسم الشيخ/);
  assert.match(validateLecture({ ...valid, duration_seconds: 86401 }, false), /مدة المحاضرة/);
  assert.match(validateLecture({ ...valid, duration_seconds: 1.5 }, false), /مدة المحاضرة/);
  assert.match(validateLecture({ ...valid, content_type: 'stream' }, false), /نوع المحتوى/);
});

test('rejects an empty or oversized title', () => {
  assert.match(validateLecture({ ...valid, title: ' ' }, false), /عنوان المحاضرة/);
  assert.match(validateLecture({ ...valid, title: 'x'.repeat(181) }, false), /عنوان المحاضرة/);
});

test('rejects insecure broadcast and recording URLs', () => {
  assert.match(validateLecture({ ...valid, stream_url: 'http://example.com/live' }, false), /HTTPS/);
  assert.match(validateLecture({ ...valid, recording_url: 'javascript:alert(1)' }, false), /HTTPS/);
});

test('rejects invalid publication states and unknown fields', () => {
  assert.match(validateLecture({ ...valid, status: 'public' }, false), /حالة النشر/);
  assert.match(validateLecture({ ...valid, is_admin: true }, false), /حقول غير معروفة/);
});

test('public lecture GET selects the structured media metadata through the anon key', async () => {
  let capturedUrl, capturedHeaders;
  const api = createAdminApi({
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
    fetch: async (url, options) => {
      capturedUrl = url; capturedHeaders = options.headers;
      return { ok: true, json: async () => [] };
    }
  });
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; this.headers = { ...this.headers, ...headers }; },
    end(body) { this.body = body; } };
  assert.equal(await api({ method: 'GET', headers: {} }, response, '/api/lectures'), true);
  assert.equal(response.status, 200);
  assert.match(capturedUrl, /sheikh,duration_seconds,content_type/);
  assert.equal(capturedHeaders.apikey, 'anon-key');
  assert.equal(capturedHeaders.Authorization, 'Bearer anon-key');
});

test('strips a leading UTF-8 BOM from the public Supabase key before sending headers', async () => {
  let capturedHeaders;
  const api = createAdminApi({
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: '\uFEFF anon-key-without-bom ' },
    fetch: async (url, options) => { capturedHeaders = options.headers; return { ok: true, json: async () => [] }; }
  });
  const response = { headers: {}, status: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; this.headers = { ...this.headers, ...headers }; },
    end(body) { this.body = body; } };
  assert.equal(await api({ method: 'GET', headers: {} }, response, '/api/lectures'), true);
  assert.equal(response.status, 200);
  assert.equal(capturedHeaders.apikey, 'anon-key-without-bom');
  assert.equal(capturedHeaders.Authorization, 'Bearer anon-key-without-bom');
});
