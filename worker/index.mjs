/**
 * إستراحة أهل الأثر — Cloudflare Worker.
 * - /api/live : حالة البث المباشر (آمن، مفتاح YouTube على الخادم فقط)
 * - كل طلب آخر: يُمرَّر إلى الأصول الثابتة (ASSETS) إن توفرت.
 */
import { getLiveStatus, jsonResponse } from './live.mjs';

async function handleLive(request, env) {
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
