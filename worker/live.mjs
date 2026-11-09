/**
 * إستراحة أهل الأثر — منطق البث المباشر (Cloudflare Worker).
 * يقرأ المفاتيح من بيئة Worker فقط ولا يعرّضها في الواجهة أبدًا.
 * الإرجاع: { live: boolean, videoId: string | null }
 */

const CACHE_TTL_MS = 300 * 1000; // 5 دقائق
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// ذاكرة مؤقتة بسيطة داخل بيئة Worker (تُكمّل ترويسة Cache-Control).
let memCache = { at: 0, value: null };

export function isValidVideoId(value) {
  return typeof value === 'string' && VIDEO_ID_RE.test(value);
}

function offline(reason) {
  return { live: false, videoId: null, ...(reason ? { reason } : {}) };
}

/**
 * يجلب حالة البث من YouTube Data API v3.
 * env: { YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID } (من إعدادات Worker)
 * fetchImpl: قابل للحقن للاختبار.
 */
export async function getLiveStatus(env, fetchImpl) {
  const apiKey = (env?.YOUTUBE_API_KEY || '').trim();
  const channelId = (env?.YOUTUBE_CHANNEL_ID || '').trim();

  if (!apiKey || !channelId) {
    return offline('unconfigured');
  }

  if (memCache.value && Date.now() - memCache.at < CACHE_TTL_MS) {
    return memCache.value;
  }

  const fetcher = fetchImpl || fetch;
  const url =
    'https://www.googleapis.com/youtube/v3/search?' +
    new URLSearchParams({
      part: 'snippet',
      channelId,
      eventType: 'live',
      type: 'video',
      maxResults: '1',
      key: apiKey
    }).toString();

  let data;
  try {
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return offline('upstream-error');
    data = await res.json();
  } catch {
    return offline('upstream-error');
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  const first = items[0];
  const videoId = first?.id?.videoId;
  const result = isValidVideoId(videoId)
    ? { live: true, videoId }
    : offline();

  memCache = { at: Date.now(), value: result };
  return result;
}

export function jsonResponse(payload, extraHeaders) {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Accept');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export function __resetCacheForTests() {
  memCache = { at: 0, value: null };
}
