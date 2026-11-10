import assert from 'node:assert/strict';
import test from 'node:test';
import { getLiveStatus, isValidVideoId, __resetCacheForTests } from './live.mjs';

function fakeFetch(payload, ok = true) {
  return async function () {
    return { ok, json: async () => payload };
  };
}

test('isValidVideoId accepts 11-char YouTube ids only', () => {
  assert.equal(isValidVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isValidVideoId('abc'), false);
  assert.equal(isValidVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(isValidVideoId(null), false);
});

test('returns offline when unconfigured', async () => {
  __resetCacheForTests();
  const r = await getLiveStatus({}, fakeFetch({ items: [] }));
  assert.equal(r.live, false);
  assert.equal(r.videoId, null);
  __resetCacheForTests();
  const r2 = await getLiveStatus({ YOUTUBE_API_KEY: 'k' }, fakeFetch({ items: [] }));
  assert.equal(r2.live, false);
});

test('returns live videoId when upstream returns a valid id', async () => {
  __resetCacheForTests();
  const r = await getLiveStatus(
    { YOUTUBE_API_KEY: 'k', YOUTUBE_CHANNEL_ID: 'UCxxxx' },
    fakeFetch({ items: [{ id: { videoId: 'dQw4w9WgXcQ' } }] })
  );
  assert.deepEqual(r, { live: true, videoId: 'dQw4w9WgXcQ' });
  __resetCacheForTests();
});

test('returns offline for invalid video ids and upstream errors', async () => {
  __resetCacheForTests();
  const bad = await getLiveStatus(
    { YOUTUBE_API_KEY: 'k', YOUTUBE_CHANNEL_ID: 'UCxxxx' },
    fakeFetch({ items: [{ id: { videoId: 'bad id!' } }] })
  );
  assert.equal(bad.live, false);

  __resetCacheForTests();
  const err = await getLiveStatus(
    { YOUTUBE_API_KEY: 'k', YOUTUBE_CHANNEL_ID: 'UCxxxx' },
    fakeFetch({}, false)
  );
  assert.equal(err.live, false);

  __resetCacheForTests();
  const offlineEmpty = await getLiveStatus(
    { YOUTUBE_API_KEY: 'k', YOUTUBE_CHANNEL_ID: 'UCxxxx' },
    fakeFetch({ items: [] })
  );
  assert.equal(offlineEmpty.live, false);
  __resetCacheForTests();
});
