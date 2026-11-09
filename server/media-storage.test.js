'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MemoryStore } = require('./media-storage');

test('MemoryStore: put/head/get/delete roundtrip', async function () {
  const s = new MemoryStore();
  await s.put('media/test.mp3', Buffer.from('audio bytes'), 'audio/mpeg');
  assert.deepEqual(await s.head('media/test.mp3'), { contentType: 'audio/mpeg', size: 11 });
  const got = await s.get('media/test.mp3');
  assert.equal(got.body.toString('utf8'), 'audio bytes');
  assert.equal(got.contentType, 'audio/mpeg');
  assert.equal(await s.exists('media/test.mp3'), true);
  await s.delete('media/test.mp3');
  assert.equal(await s.get('media/test.mp3'), null);
  assert.equal(await s.exists('media/test.mp3'), false);
});

test('MemoryStore: listKeys with prefix', async function () {
  const s = new MemoryStore();
  await s.put('a/1', Buffer.from('x'), 'text/plain');
  await s.put('a/2', Buffer.from('yy'), 'text/plain');
  await s.put('b/1', Buffer.from('z'), 'text/plain');
  assert.deepEqual((await s.listKeys('a/')).sort(), ['a/1', 'a/2']);
  assert.deepEqual((await s.listKeys('')).sort(), ['a/1', 'a/2', 'b/1']);
});

test('MemoryStore: missing key returns null', async function () {
  const s = new MemoryStore();
  assert.equal(await s.get('nope'), null);
  assert.equal(await s.head('nope'), null);
});
