import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const ALLOWED_ORIGINS = new Set([
  "https://hares-preview.aboserag925.workers.dev",
  "https://feat-visual-identity-v2-mainline-20261119-hares.aboserag925.workers.dev",
  "https://hares.aboserag925.workers.dev",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);
const CATEGORY_NAMES: Record<string, string> = {
  audio: "صوتيات", video: "فيديو", books: "كتب", images: "صور", other: "مواد أخرى",
};

function secret(name: string): string {
  const raw = Deno.env.get(name) || "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.default === "string") return parsed.default;
  } catch { /* plain environment value */ }
  return raw;
}

function json(data: unknown, status = 200, origin: string | null = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "apikey,content-type,x-client-info");
    headers.set("Access-Control-Max-Age", "600");
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(data), { status, headers });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "المصدر غير مسموح." }, 403, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "apikey,content-type,x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  } : {} });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: "طريقة الطلب غير مدعومة." }, 405, origin);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = secret("SUPABASE_SECRET_KEYS") || secret("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "خدمة المكتبة غير مهيأة." }, 503, origin);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const pathname = new URL(req.url).pathname;
  const pathSegments = pathname.split("/").filter(Boolean);
  const functionIndex = pathSegments.lastIndexOf("media-library");
  const route = functionIndex >= 0
    ? "/" + pathSegments.slice(functionIndex + 1).join("/")
    : pathname;

  if (route === "" || route === "/" || route === "/library") {
    const { data, error } = await client.from("media_library_items")
      .select("id,title,category,kind,file_name,uploaded_at")
      .eq("status", "approved")
      .order("uploaded_at", { ascending: false })
      .limit(500);
    if (error) return json({ error: "تعذر تحميل المكتبة الآن." }, 503, origin);
    const items = (data || []).map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      categoryName: CATEGORY_NAMES[item.category] || CATEGORY_NAMES.other,
      kind: item.kind,
      fileName: item.file_name,
      uploadedAt: item.uploaded_at,
      url: "/api/library/files/" + item.id,
    }));
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    return json({ items }, 200, origin);
  }

  const match = route.match(/^\/files\/([0-9a-f-]{36})$/i);
  if (!match) return json({ error: "المسار غير موجود." }, 404, origin);
  const { data: item, error } = await client.from("media_library_items")
    .select("object_key,mime_type,file_name,kind")
    .eq("id", match[1])
    .eq("status", "approved")
    .maybeSingle();
  if (error) return json({ error: "تعذر تحميل الملف الآن." }, 503, origin);
  if (!item) return json({ error: "الملف غير موجود." }, 404, origin);
  const { data: signed, error: signError } = await client.storage
    .from(Deno.env.get("SUPABASE_STORAGE_BUCKET") || "haress-media")
    .createSignedUrl(item.object_key, 60, { download: item.kind !== "audio" && item.kind !== "video" && item.kind !== "image" });
  if (signError || !signed?.signedUrl) return json({ error: "تعذر تجهيز رابط الملف الآمن." }, 503, origin);
  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
