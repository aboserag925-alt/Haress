import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const ALLOWED_ORIGINS = new Set([
  "https://hares-preview.aboserag925.workers.dev",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 1024;

function json(data: unknown, status = 200, headers: HeadersInit = {}, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
      ...extraHeaders,
    },
  });
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,PATCH,POST,OPTIONS",
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

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || "")) {
    throw new Error("CONTENT_TYPE");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
    return value as Record<string, unknown>;
  } catch { throw new Error("INVALID_JSON"); }
}

function parseAdminPatch(input: Record<string, unknown>): { value?: Record<string, unknown>; error?: string } {
  const allowed = new Set(["status", "priority"]);
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !allowed.has(key))) return { error: "حقول التعديل غير مسموحة." };
  if (input.status !== undefined && input.status !== "REJECTED") return { error: "الحالة غير صالحة." };
  if (input.priority !== undefined && !["low", "normal", "high", "urgent"].includes(String(input.priority))) {
    return { error: "الأولوية غير صالحة." };
  }
  return { value: input };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "المصدر غير مسموح." }, 403);
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const marker = "/admin-operations";
  const markerIndex = url.pathname.indexOf(marker);
  const route = markerIndex >= 0 ? (url.pathname.slice(markerIndex + marker.length) || "/") : "/";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = keysFromEnv("SUPABASE_PUBLISHABLE_KEYS").default || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = keysFromEnv("SUPABASE_SECRET_KEYS").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: "الخدمة غير مهيأة." }, 503, cors);

  const publicClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const authHeader = req.headers.get("authorization") || "";
  const tokenMatch = authHeader.match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  if (!tokenMatch) return json({ error: "يلزم تسجيل الدخول." }, 401, cors);
  const { data: authData, error: authError } = await publicClient.auth.getUser(tokenMatch[1]);
  const user = authData?.user;
  if (authError || !user?.id) return json({ error: "جلسة الدخول غير صالحة." }, 401, cors);

  const { data: adminRow, error: adminError } = await adminClient.from("admin_users")
    .select("user_id").eq("user_id", user.id).maybeSingle();
  if (adminError || !adminRow) return json({ error: "هذه العملية متاحة للمشرفين المصرح لهم فقط." }, 403, cors);

  if (route === "/admin/suggestions" && req.method === "GET") {
    const { data, error } = await adminClient.from("suggestions").select("*")
      .order("created_at", { ascending: false }).limit(200);
    if (error) return json({ error: "تعذر تحميل الاقتراحات الآن." }, 502, cors);
    return json({ items: data || [] }, 200, cors);
  }

  const suggestionMatch = route.match(/^\/admin\/suggestions\/([0-9a-f-]{36})$/i);
  if (suggestionMatch && UUID_RE.test(suggestionMatch[1])) {
    if (req.method === "GET") {
      const { data, error } = await adminClient.from("suggestions").select("*")
        .eq("id", suggestionMatch[1]).maybeSingle();
      if (error) return json({ error: "تعذر تحميل الاقتراح الآن." }, 502, cors);
      return data ? json({ item: data }, 200, cors) : json({ error: "الاقتراح غير موجود." }, 404, cors);
    }
    if (req.method === "PATCH") {
      let input: Record<string, unknown>;
      try { input = await readJson(req); }
      catch (error) {
        const code = (error as Error).message;
        return json({ error: code === "CONTENT_TYPE" ? "أرسل التعديل بصيغة JSON." : code === "TOO_LARGE" ? "حجم الطلب أكبر من المسموح." : "بيانات الطلب غير صالحة." }, code === "TOO_LARGE" ? 413 : 400, cors);
      }
      const checked = parseAdminPatch(input);
      if (checked.error) return json({ error: checked.error }, 400, cors);
      const patch = checked.value || {};
      const { data, error } = await adminClient.from("suggestions").update(patch)
        .eq("id", suggestionMatch[1]).select("*").maybeSingle();
      if (error) return json({ error: "تعذر تحديث الاقتراح الآن." }, 502, cors);
      if (!data) return json({ error: "الاقتراح غير موجود." }, 404, cors);
      try {
        await adminClient.from("ai_audit_events").insert({
          event_type: data.status === "REJECTED" ? "suggestion.rejected" : "suggestion.updated",
          suggestion_id: data.id,
          actor_user_id: user.id,
          metadata: { status: data.status, priority: data.priority },
        });
      } catch { /* Audit failure must not undo a committed moderation action. */ }
      return json({ item: data }, 200, cors);
    }
    return json({ error: "طريقة الطلب غير مدعومة." }, 405, cors, { "Allow": "GET, PATCH, OPTIONS" });
  }

  const approvalMatch = route.match(/^\/admin\/ai\/tasks\/([0-9a-f-]{36})\/approval$/i);
  if (approvalMatch && UUID_RE.test(approvalMatch[1])) {
    if (req.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة." }, 405, cors, { "Allow": "POST, OPTIONS" });
    let input: Record<string, unknown>;
    try { input = await readJson(req); }
    catch (error) {
      const code = (error as Error).message;
      return json({ error: code === "CONTENT_TYPE" ? "أرسل القرار بصيغة JSON." : code === "TOO_LARGE" ? "حجم الطلب أكبر من المسموح." : "بيانات الطلب غير صالحة." }, code === "TOO_LARGE" ? 413 : 400, cors);
    }
    const allowed = new Set(["action", "decision", "reason"]);
    if (Object.keys(input).some((key) => !allowed.has(key)) ||
        !["IMPLEMENT", "MERGE"].includes(String(input.action)) ||
        !["APPROVED", "REJECTED"].includes(String(input.decision)) ||
        (input.reason !== undefined && typeof input.reason !== "string") ||
        (input.decision === "REJECTED" && (!String(input.reason || "").trim()))) {
      return json({ error: "بيانات الموافقة غير صالحة." }, 400, cors);
    }
    const reason = String(input.reason || "").slice(0, 1000);
    const { data: approvalId, error } = await adminClient.rpc("record_ai_approval", {
      p_task_id: approvalMatch[1],
      p_actor_user_id: user.id,
      p_action: input.action,
      p_decision: input.decision,
      p_reason: reason,
    });
    if (error || !approvalId) return json({ error: "تعذر تسجيل القرار. تحقق من حالة المهمة وصلاحيات المشرف." }, 409, cors);
    try {
      await adminClient.from("ai_audit_events").insert({
        event_type: "ai.approval.recorded",
        actor_user_id: user.id,
        metadata: { task_id: approvalMatch[1], approval_id: approvalId, action: input.action, decision: input.decision },
      });
    } catch { /* Keep the approval result even if the audit insert is temporarily unavailable. */ }
    return json({ approvalId }, 200, cors);
  }

  return json({ error: "المسار غير موجود." }, 404, cors);
});
