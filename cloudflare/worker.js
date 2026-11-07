const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function unavailable(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 503,
    headers: JSON_HEADERS
  });
}

function backendOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" ||
        url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function proxyApi(request, env, fetchImpl = fetch) {
  const incoming = new URL(request.url);
  const origin = backendOrigin(env && env.AHL_API_BASE_URL);
  if (!origin) {
    return unavailable("خدمة API غير مهيأة. اضبط AHL_API_BASE_URL على عنوان خادم HTTPS.");
  }

  const upstream = new URL(origin);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  try {
    const forwarded = new Request(upstream.toString(), request);
    return await fetchImpl(forwarded);
  } catch {
    return new Response(JSON.stringify({ error: "تعذر الاتصال بالخادم الخلفي." }), {
      status: 502,
      headers: JSON_HEADERS
    });
  }
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname.startsWith("/api/")) {
      return proxyApi(request, env);
    }

    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return new Response("Static assets binding is unavailable.", { status: 500 });
  }
};
