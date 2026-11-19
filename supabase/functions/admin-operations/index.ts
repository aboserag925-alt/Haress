import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const ALLOWED_ORIGINS = new Set([
  "https://hares-preview.aboserag925.workers.dev",
  "https://hares.aboserag925.workers.dev",
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
    return json({ approvalId }, 200, cors);
  }


  // AI task creation and immutable analysis artifacts are handled here rather than
  // in the Node server, so Cloudflare can route them directly to this Supabase Function.
  const taskRoute = route === "/admin/ai/tasks";
  const artifactMatch = route.match(/^\/admin\/ai\/tasks\/([0-9a-f-]{36})\/artifact$/i);
  if (taskRoute && req.method === "POST") {
    let input: Record<string, unknown>;
    try { input = await readJson(req); }
    catch (error) {
      const code = (error as Error).message;
      return json({ error: code === "CONTENT_TYPE" ? "أرسل البيانات بصيغة JSON." : code === "TOO_LARGE" ? "حجم الطلب أكبر من المسموح." : "بيانات الطلب غير صالحة." }, code === "TOO_LARGE" ? 413 : 400, cors);
    }

    const allowed = new Set(["type", "title", "description", "affectedAreas"]);
    const types = ["suggestion", "security", "implementation", "ux", "content", "performance", "product"];
    const areas = input.affectedAreas;
    if (Object.keys(input).some((key) => !allowed.has(key)) ||
        !types.includes(String(input.type)) ||
        typeof input.title !== "string" || input.title.trim().length < 4 || input.title.length > 120 ||
        typeof input.description !== "string" || input.description.trim().length < 10 || input.description.length > 3000 ||
        (areas !== undefined && (!Array.isArray(areas) || areas.length > 30 ||
          areas.some((value) => typeof value !== "string" || value.length > 80)))) {
      return json({ error: "بيانات المهمة غير صالحة." }, 400, cors);
    }

    const taskType = String(input.type);
    const title = (input.title as string).trim();
    const description = (input.description as string).trim();
    const affectedAreas = (Array.isArray(areas) ? areas : []) as string[];
    const normalizedAreas = affectedAreas.map((value) => value.trim().toLowerCase());
    const criticalAreas = new Set(["secrets", "deployment", "production_database"]);
    const highAreas = new Set(["authentication", "authorization", "supabase_rls", "admin_users", "secrets", "deployment", "github_workflows", "telegram_permissions", "production_database"]);
    const risk = normalizedAreas.some((value) => criticalAreas.has(value)) ? "critical"
      : normalizedAreas.some((value) => highAreas.has(value)) ? "high"
      : normalizedAreas.length ? "medium" : "low";
    const requiresApproval = risk === "high" || risk === "critical";

    const { data: created, error: createError } = await adminClient.rpc("create_ai_task_with_audit", {
      p_suggestion_id: null,
      p_actor_user_id: user.id,
      p_source: "suggestion",
      p_task_type: taskType,
      p_title: title,
      p_description: description,
      p_risk: risk,
      p_requires_approval: requiresApproval,
      p_affected_areas: affectedAreas.slice(0, 30),
    });
    const task = Array.isArray(created) ? created[0] : created;
    if (createError || !task?.id) return json({ error: "تعذر إنشاء المهمة الآن." }, 502, cors);

    const text = [title, description].join("\n").slice(0, 6000);
    const injectionPatterns = [
      /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+instructions\b/i,
      /\b(reveal|print|expose|exfiltrate)\s+(the\s+)?(system prompt|secret|api key|token)\b/i,
      /\b(disable|turn off)\s+(rls|row level security|authentication|authorization)\b/i,
      /\b(bypass|override)\s+(auth|authorization|approval|rls)\b/i,
      /تجاهل\s+(كل\s+)?(التعليمات|التوجيهات)\s+(السابقة|أعلاه)/u,
      /اكشف\s+(عن\s+)?(المفتاح|الرمز|التعليمات\s+النظامية)/u,
      /تجاوز\s+(الموافقة|الصلاحيات|الحماية)/u,
    ];
    const promptInjection = injectionPatterns.some((pattern) => pattern.test(text));
    const secretExposure = /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/.test(text);
    const prohibitedAreas = new Set(["secrets_exposure", "rls_disabled", "auth_bypass", "prompt_injection", "data_exfiltration"]);
    const blocked = normalizedAreas.some((value) => prohibitedAreas.has(value)) || promptInjection || secretExposure;
    const securityReport = {
      agent: "security",
      status: blocked ? "BLOCKED" : "PASS",
      data: { blocked, reviewRequired: true, areas: normalizedAreas, flags: { promptInjection, secretExposure }, tainted: true },
      issues: blocked ? ["Untrusted or prohibited input detected"] : [],
    };
    const routeAgents: Record<string, string[]> = {
      product: ["product"],
      suggestion: ["suggestion", "security"],
      security: ["security"],
      implementation: ["security", "verifier"],
      ux: ["ux", "security"],
      content: ["content", "security"],
      performance: ["performance", "security"],
    };
    const reports = (routeAgents[taskType] || []).map((agent) => {
      if (agent === "security") return securityReport;
      return {
        agent,
        status: "PASS",
        data: { taskId: task.id, summary: "Analysis only; no direct repository writes.", inputType: taskType },
        issues: [],
      };
    });
    const status = blocked ? "FAILED" : "ANALYZED";
    const artifact = {
      schemaVersion: 1,
      taskId: task.id,
      createdBy: user.id,
      status,
      source: { type: taskType, title, description, affectedAreas: affectedAreas.slice(0, 30) },
      plan: reports.map((report) => report.data || {}),
      reports,
    };
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === "object") {
        const source = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
      }
      return value;
    };
    const canonical = JSON.stringify(canonicalize(artifact));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const normalizedReports = reports.map((report) => ({
      agent: report.agent,
      status: report.status,
      data: report.data,
      warnings: report.issues.slice(0, 10).map((issue) => String(issue).slice(0, 240)),
    }));
    const storedArtifact = { ...artifact, reports: normalizedReports };
    const storedCanonical = JSON.stringify(canonicalize(storedArtifact));
    const storedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(storedCanonical));
    const storedSha256 = Array.from(new Uint8Array(storedDigest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data: persisted, error: persistError } = await adminClient.rpc("record_ai_task_analysis", {
      p_task_id: task.id,
      p_actor_user_id: user.id,
      p_status: status,
      p_artifact: storedArtifact,
      p_artifact_sha256: storedSha256,
    });
    const result = Array.isArray(persisted) ? persisted[0] : persisted;
    if (persistError || !result?.artifact_id || result.artifact_sha256 !== storedSha256 || result.task_status !== status) {
      return json({ error: "تعذر حفظ تحليل المهمة والتحقق من سلامته." }, 502, cors);
    }
    return json({
      task: { ...task, status: result.task_status },
      reports,
      plan: artifact.plan,
      artifact: { id: result.artifact_id, sha256: result.artifact_sha256 },
      createdBy: user.id,
    }, 201, cors);
  }

  if (taskRoute) return json({ error: "طريقة الطلب غير مدعومة." }, 405, cors, { "Allow": "POST, OPTIONS" });

  if (artifactMatch && UUID_RE.test(artifactMatch[1]) && req.method === "GET") {
    const { data: artifact, error } = await adminClient.from("ai_task_artifacts")
      .select("id,task_id,version,schema_version,artifact,sha256,created_by,created_at")
      .eq("task_id", artifactMatch[1]).eq("artifact_type", "maestro_analysis_plan")
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (error) return json({ error: "تعذر قراءة خطة المهمة." }, 502, cors);
    if (!artifact) return json({ error: "لم يتم العثور على خطة محفوظة لهذه المهمة." }, 404, cors);
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === "object") {
        const source = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
      }
      return value;
    };
    const canonical = JSON.stringify(canonicalize(artifact.artifact));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const actual = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== artifact.sha256) return json({ error: "فشل التحقق من سلامة خطة الذكاء الاصطناعي." }, 503, cors);
    return json({ artifact }, 200, cors);
  }
  if (artifactMatch) return json({ error: "طريقة الطلب غير مدعومة." }, 405, cors, { "Allow": "GET, OPTIONS" });

  return json({ error: "المسار غير موجود." }, 404, cors);
});
