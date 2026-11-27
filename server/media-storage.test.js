'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MemoryStore, SupabaseMediaStorage, buildKey } = require('./media-storage');

test('MemoryStore: put/head/get/delete roundtrip', async function () {
  const s = new MemoryStore();
  await s.put('library/audio/1/lesson.mp3', Buffer.from('audio bytes'), 'audio/mpeg');
  assert.deepEqual(await s.head('library/audio/1/lesson.mp3'), { contentType: 'audio/mpeg', size: 11 });
  const got = await s.get('library/audio/1/lesson.mp3');
  assert.equal(got.body.toString('utf8'), 'audio bytes');
  assert.equal(got.contentType, 'audio/mpeg');
  await s.delete('library/audio/1/lesson.mp3');
  assert.equal(await s.get('library/audio/1/lesson.mp3'), null);
});

test('MemoryStore: no silent overwrite', async function () {
  const s = new MemoryStore();
  await s.put('library/audio/1/a.mp3', Buffer.from('one'), 'audio/mpeg');
  await assert.rejects(s.put('library/audio/1/a.mp3', Buffer.from('two'), 'audio/mpeg'), /OBJECT_EXISTS/);
  const got = await s.get('library/audio/1/a.mp3');
  assert.equal(got.body.toString('utf8'), 'one');
});


test('MemoryStore: explicit upsert replaces an existing object', async function () {
  const s = new MemoryStore();
  await s.put('library/media-index.json', Buffer.from('first'), 'application/json');
  await s.put('library/media-index.json', Buffer.from('second'), 'application/json', { upsert: true });
  const got = await s.get('library/media-index.json');
  assert.equal(got.body.toString('utf8'), 'second');
  assert.equal(got.contentType, 'application/json');
});

test('SupabaseMediaStorage: only explicit upserts enable overwrite', async function () {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async function (url, options) {
    requests.push({ url: url, options: options });
    return { ok: true, status: 200, statusText: 'OK', text: async function () { return ''; } };
  };
  try {
    const storage = new SupabaseMediaStorage({
      bucket: 'haress-media',
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'test-service-role-key'
    });
    await storage.put('library/audio/1/file.mp3', Buffer.from('media'), 'audio/mpeg');
    await storage.put('library/media-index.json', Buffer.from('{}'), 'application/json', { upsert: true });
    assert.equal(requests[0].options.headers['x-upsert'], 'false');
    assert.equal(requests[1].options.headers['x-upsert'], 'true');
  } finally {
    global.fetch = originalFetch;
  }
});

test('SupabaseMediaStorage: missing objects handle current and legacy not-found responses only', async function () {
  const originalFetch = global.fetch;
  const storage = new SupabaseMediaStorage({
    bucket: 'haress-media',
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-key'
  });
  try {
    global.fetch = async function () {
      return new Response(JSON.stringify({ code: 'NoSuchKey', message: 'Object not found' }), { status: 404 });
    };
    assert.equal(await storage.get('library/media-index.json'), null);

    global.fetch = async function () {
      return new Response(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }), { status: 400 });
    };
    assert.equal(await storage.get('library/media-index.json'), null);

    global.fetch = async function () {
      return new Response(JSON.stringify({ code: 'InvalidRequest', message: 'Malformed path' }), { status: 400 });
    };
    await assert.rejects(storage.get('library/media-index.json'), /Supabase storage 400/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('buildKey: object key shape', async function () {
  assert.equal(buildKey('audio', 'abc', 'lesson.mp3'), 'library/audio/abc/lesson.mp3');
  assert.equal(buildKey('video', 'abc', 'v.mp4'), 'library/video/abc/v.mp4');
  assert.equal(buildKey('books', 'abc', 'b.pdf'), 'library/books/abc/b.pdf');
  assert.equal(buildKey('document', 'abc', 'b.pdf'), 'library/books/abc/b.pdf');
  assert.equal(buildKey('images', 'abc', 'i.jpg'), 'library/images/abc/i.jpg');
  assert.equal(buildKey('image', 'abc', 'i.jpg'), 'library/images/abc/i.jpg');
  assert.equal(buildKey('unknown', 'abc', 'x.bin'), 'library/other/abc/x.bin');
});

test('buildKey: dot-only file names never become path segments', async function () {
  assert.equal(buildKey('audio', 'abc', '..'), 'library/audio/abc/file');
  assert.equal(buildKey('audio', 'abc', '.'), 'library/audio/abc/file');
  assert.equal(buildKey('audio', 'abc', 'x/..'), 'library/audio/abc/file');
  assert.equal(buildKey('audio', 'abc', '../y.mp3'), 'library/audio/abc/y.mp3');
});
