import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://hares-preview.aboserag925.workers.dev",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);
const LECTURE_FIELDS = "id,title,description,starts_at,category,stream_url,recording_url,status,created_at,updated_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function keysFromEnv(name: string): Record<string, string> {
  const raw = Deno.env.get(name);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function validHttpsUrl(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function validateLecture(input: unknown, partial = false): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "بيانات المحاضرة غير صالحة.";
  const body = input as Record<string, unknown>;
  const allowed = new Set(["title", "description", "starts_at", "category", "stream_url", "recording_url", "status"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return "توجد حقول غير معروفة.";
  if ((!partial || Object.hasOwn(body, "title")) &&
      (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 180)) return "عنوان المحاضرة مطلوب وبحد أقصى 180 حرفًا.";
  if (Object.hasOwn(body, "description") &&
      (typeof body.description !== "string" || body.description.length > 4000)) return "الوصف أطول من المسموح.";
  if (Object.hasOwn(body, "starts_at") && body.starts_at !== null &&
      (typeof body.starts_at !== "string" || !Number.isFinite(Date.parse(body.starts_at)))) return "موعد المحاضرة غير صالح.";
  if (Object.hasOwn(body, "category") &&
      (typeof body.category !== "string" || body.category.length > 80)) return "تصنيف المحاضرة غير صالح.";
  if (Object.hasOwn(body, "stream_url") && !validHttpsUrl(body.stream_url)) return "رابط البث يجب أن يكون HTTPS صحيحًا.";
  if (Object.hasOwn(body, "recording_url") && !validHttpsUrl(body.recording_url)) return "رابط التسجيل يجب أن يكون HTTPS صحيحًا.";
  if (Object.hasOwn(body, "status") && !["draft", "published", "archived"].includes(String(body.status))) return "حالة النشر غير صالحة.";
  if (partial && Object.keys(body).length === 0) return "لا توجد تغييرات لحفظها.";
  return null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const type = req.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(type)) throw new Error("CONTENT_TYPE");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
    return value as Record<string, unknown>;
  } catch { throw new Error("INVALID_JSON"); }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "المصدر غير مسموح." }, 403);
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const marker = "/lectures-admin";
  const markerIndex = url.pathname.indexOf(marker);
  const route = markerIndex >= 0 ? (url.pathname.slice(markerIndex + marker.length) || "/") : "/";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = keysFromEnv("SUPABASE_PUBLISHABLE_KEYS").default || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = keysFromEnv("SUPABASE_SECRET_KEYS").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !publishableKey) return json({ error: "الخدمة غير مهيأة." }, 503, cors);

  const publicClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Public reads are limited by the database's published-only RLS policy.
  if (route === "/lectures" && req.method === "GET") {
    const { data, error } = await publicClient.from("lectures").select(LECTURE_FIELDS)
      .eq("status", "published").order("starts_at", { ascending: true, nullsFirst: false });
    if (error) return json({ error: "تعذر تحميل المحاضرات الآن." }, 502, cors);
    return json({ items: data || [] }, 200, cors);
  }

  if (!["/admin/session", "/admin/lectures"].includes(route) &&
      !(route === "/lectures" && req.method === "POST") &&
      !/^\/lectures\/[0-9a-f-]{36}$/i.test(route)) return json({ error: "المسار غير موجود." }, 404, cors);

  const authHeader = req.headers.get("authorization") || "";
  const tokenMatch = authHeader.match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  if (!tokenMatch) return json({ error: "يلزم تسجيل الدخول." }, 401, cors);
  const { data: authData, error: authError } = await publicClient.auth.getUser(tokenMatch[1]);
  const user = authData?.user;
  if (authError || !user?.id) return json({ error: "جلسة الدخول غير صالحة." }, 401, cors);
  if (!secretKey) return json({ error: "خدمة الإدارة غير مهيأة." }, 503, cors);

  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminRow, error: adminError } = await adminClient.from("admin_users")
    .select("user_id").eq("user_id", user.id).maybeSingle();
  if (adminError || !adminRow) return json({ error: "هذه العملية متاحة للمشرفين المصرح لهم فقط." }, 403, cors);

  if (route === "/admin/session" && req.method === "GET") {
    return json({ user: { id: user.id, email: user.email || null } }, 200, cors);
  }
  if (route === "/admin/lectures" && req.method === "GET") {
    const { data, error } = await adminClient.from("lectures").select(LECTURE_FIELDS)
      .order("starts_at", { ascending: true, nullsFirst: false });
    if (error) return json({ error: "تعذر تحميل المحاضرات الآن." }, 502, cors);
    return json({ items: data || [] }, 200, cors);
  }

  if (route === "/lectures" && req.method === "POST") {
    let body: Record<string, unknown>;
    try { body = (await readJson(req)) || {}; }
    catch (error) {
      const code = (error as Error).message;
      return json({ error: code === "CONTENT_TYPE" ? "يجب إرسال البيانات بصيغة JSON." : code === "TOO_LARGE" ? "حجم الطلب أكبر من المسموح." : "بيانات الطلب غير صالحة." }, code === "TOO_LARGE" ? 413 : 400, cors);
    }
    const invalid = validateLecture(body);
    if (invalid) return json({ error: invalid }, 400, cors);
    const { data, error } = await adminClient.from("lectures").insert({
      title: String(body.title).trim(), description: body.description || "", starts_at: body.starts_at || null,
      category: body.category || "محاضرة", stream_url: body.stream_url || null,
      recording_url: body.recording_url || null, status: body.status || "draft", created_by: user.id,
    }).select(LECTURE_FIELDS).single();
    if (error) return json({ error: "تعذر حفظ المحاضرة الآن." }, 502, cors);
    return json({ item: data }, 201, cors);
  }

  const idMatch = route.match(/^\/lectures\/([0-9a-f-]{36})$/i);
  if (!idMatch || !UUID_RE.test(idMatch[1])) return json({ error: "معرّف المحاضرة غير صالح." }, 400, cors);
  if (req.method === "PATCH") {
    let body: Record<string, unknown>;
    try { body = (await readJson(req)) || {}; }
    catch (error) {
      const code = (error as Error).message;
      return json({ error: code === "CONTENT_TYPE" ? "يجب إرسال البيانات بصيغة JSON." : code === "TOO_LARGE" ? "حجم الطلب أكبر من المسموح." : "بيانات الطلب غير صالحة." }, code === "TOO_LARGE" ? 413 : 400, cors);
    }
    const invalid = validateLecture(body, true);
    if (invalid) return json({ error: invalid }, 400, cors);
    const { data, error } = await adminClient.from("lectures").update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", idMatch[1]).select(LECTURE_FIELDS).maybeSingle();
    if (error) return json({ error: "تعذر تحديث المحاضرة الآن." }, 502, cors);
    if (!data) return json({ error: "المحاضرة غير موجودة." }, 404, cors);
    return json({ item: data }, 200, cors);
  }
  if (req.method === "DELETE") {
    const { data, error } = await adminClient.from("lectures").delete().eq("id", idMatch[1]).select("id").maybeSingle();
    if (error) return json({ error: "تعذر حذف المحاضرة الآن." }, 502, cors);
    if (!data) return json({ error: "المحاضرة غير موجودة." }, 404, cors);
    return json({ ok: true }, 200, cors);
  }
  return json({ error: "طريقة الطلب غير مدعومة." }, 405, cors, { "Allow": "GET,POST,PATCH,DELETE,OPTIONS" });
});
