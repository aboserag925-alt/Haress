const test = require('node:test');
const assert = require('node:assert/strict');
const media = require('./library-media.js');

const items = [
  { id: '1', title: 'شرح صحيح مسلم', sheikh: 'الشيخ أحمد', description: 'حديث', category: 'audio', uploadedAt: '2026-11-01T10:00:00Z', kind: 'audio', mimeType: 'audio/mpeg' },
  { id: '2', title: 'أصول التفسير', lecturer: 'الشيخ خالد', description: 'قرآن', category: 'video', uploadedAt: '2026-11-03T10:00:00Z', kind: 'video', mimeType: 'video/mp4' },
  { id: '3', title: 'كتاب العقيدة', author: 'الشيخ أحمد', description: 'متن علمي', category: 'books', uploadedAt: '2026-11-02T10:00:00Z', kind: 'document' }
];

test('search matches title, sheikh, description and category, ignoring Arabic diacritics', () => {
  assert.deepEqual(media.search(items, 'صحيح').map(x => x.id), ['1']);
  assert.deepEqual(media.search(items, 'خالد').map(x => x.id), ['2']);
  assert.deepEqual(media.search(items, 'قُرآن').map(x => x.id), ['2']);
  assert.deepEqual(media.search(items, 'كتب').map(x => x.id), []);
  assert.deepEqual(media.search(items, 'books').map(x => x.id), ['3']);
  assert.deepEqual(media.search(items, 'video').map(x => x.id), ['2']);
});

test('category and sheikh filters combine without losing API categories', () => {
  assert.deepEqual(media.filterSort(items, { category: 'audio', sheikh: 'الشيخ أحمد' }).map(x => x.id), ['1']);
  assert.deepEqual(media.unique(items.map(x => x.category)), ['audio', 'video', 'books']);
  assert.deepEqual(media.filterSort(items, { category: 'all', sheikh: 'all' }).length, 3);
});

test('sorts newest first by default and alphabetically by name on request', () => {
  assert.deepEqual(media.filterSort(items, {}).map(x => x.id), ['2', '3', '1']);
  assert.deepEqual(media.filterSort(items, { sort: 'name' }).map(x => x.id), ['2', '1', '3']);
});

test('detects audio and video from type, MIME or URL without loading a source', () => {
  assert.equal(media.mediaType({ kind: 'audio' }), 'audio');
  assert.equal(media.mediaType({ mimeType: 'video/webm' }), 'video');
  assert.equal(media.mediaType({ url: 'https://cdn.example/lesson.mp3' }), 'audio');
  assert.equal(media.mediaType({ recording_url: 'https://cdn.example/lesson.mp4' }), 'video');
  assert.equal(media.mediaType({ url: 'https://youtu.be/abc123' }), 'video');
  assert.equal(media.mediaType({ url: 'https://cdn.example/book.pdf' }), 'document');
});

test('formats duration and isolates saved playback position by item id', () => {
  assert.equal(media.durationLabel({ durationSeconds: 125 }), '2:05');
  assert.equal(media.durationLabel({}), 'غير محددة');
  assert.equal(media.progressKey('lecture-1'), 'haress-media-progress-v1:lecture-1');
  assert.notEqual(media.progressKey('lecture-1'), media.progressKey('lecture-2'));
});

test('public GET list accepts an empty list and rejects API failures or invalid payloads', async () => {
  const empty = await media.fetchList(async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }, '/api/library');
  assert.deepEqual(empty, []);
  await assert.rejects(() => media.fetchList(async () => new Response('{}', { status: 503 }), '/api/lectures'));
  await assert.rejects(() => media.fetchList(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }), '/api/library'));
});
