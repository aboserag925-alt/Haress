/**
 * إستراحة أهل الأثر — Cloudflare Worker.
 * - /api/live : حالة البث المباشر (آمن، مفتاح YouTube على الخادم فقط)
 * - كل طلب آخر: يُمرَّر إلى الأصول الثابتة (ASSETS) إن توفرت.
 */
import { getLiveStatus, jsonResponse } from './live.mjs';

// حد معدل بسيط ضد السبام في Cloudflare Function (60/دقيقة/IP) — ذاكرة Worker.
const buckets = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = buckets.get(ip);
  if (!entry || now - entry.start > 60000) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 60;
}

async function handleLive(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ live: false, videoId: null }, { 'Retry-After': '60' });
  }
  if (request.method === 'OPTIONS') {
    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Accept');
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ live: false, videoId: null, reason: 'method-not-allowed' }, {});
  }
  const status = await getLiveStatus(env, fetch);
  // لا نرجع سبب الإعداد للمتصفح إلا بحالة آمنة عامة؛ نرجع فقط live/videoId
  const publicPayload = { live: Boolean(status.live), videoId: status.videoId || null };
  return jsonResponse(publicPayload);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/live') {
      return handleLive(request, env);
    }

    // تمرير الباقي إلى أصول app/ الثابتة
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};
