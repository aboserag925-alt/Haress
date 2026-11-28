import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, parseLiveStatus } from './index.js';

describe('live status', () => {
  it('detects a live stream', () => {
    const html = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcDEF12345">"isLiveNow":true';
    assert.deepEqual(parseLiveStatus(html), { state: 'live', videoId: 'abcDEF12345' });
  });
  it('offline when not live', () => {
    const html = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcDEF12345">"isLiveNow":false';
    assert.deepEqual(parseLiveStatus(html), { state: 'offline' });
  });
  it('unknown on consent or empty pages', () => {
    assert.deepEqual(parseLiveStatus('<html>consent</html>'), { state: 'unknown' });
  });
  it('route returns unknown when YouTube fails, and rejects POST', async () => {
    const bad = async () => { throw new Error('x'); };
    const res = await handleRequest(new Request('https://x.test/api/live-status'), {}, bad);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).state, 'unknown');
    const post = await handleRequest(new Request('https://x.test/api/live-status', { method: 'POST' }), {}, bad);
    assert.equal(post.status, 405);
  });
});
