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

test('buildKey: object key shape', async function () {
  assert.equal(buildKey('audio', 'abc', 'lesson.mp3'), 'library/audio/abc/lesson.mp3');
  assert.equal(buildKey('video', 'abc', 'v.mp4'), 'library/video/abc/v.mp4');
  assert.equal(buildKey('books', 'abc', 'b.pdf'), 'library/books/abc/b.pdf');
  assert.equal(buildKey('images', 'abc', 'i.jpg'), 'library/images/abc/i.jpg');
  assert.equal(buildKey('unknown', 'abc', 'x.bin'), 'library/other/abc/x.bin');
});
