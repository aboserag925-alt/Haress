import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const ALLOWED_ORIGINS = new Set([
  "https://hares.aboserag925.workers.dev",
]);
const CATEGORIES = new Set(["feature", "bug", "design", "content", "performance", "usability", "other"]);
const MAX_BODY_BYTES = 8 * 1024;
const DEFAULT_DAILY_CAP = 100;

function json(data: unknown, status = 200, origin: string | null = null, extra: HeadersInit = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "apikey,content-type,x-client-info");
    headers.set("Access-Control-Max-Age", "600");
    headers.set("Vary", "Origin");
  }
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(data), { status, headers });
}

function getKey(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) return "";
  try { return JSON.parse(raw).default || ""; } catch { return ""; }
}

function dailyCap(): number {
  const value = Number.parseInt(Deno.env.get("SUGGESTIONS_DAILY_CAP") || "", 10);
  return Number.isSafeInteger(value) && value > 0 && value <= 1000000 ? value : DEFAULT_DAILY_CAP;
}

async function readInput(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new Error("CONTENT_TYPE");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("INVALID_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
  return value as Record<string, unknown>;
}

function validateInput(input: Record<string, unknown>) {
  const allowed = new Set(["category", "title", "description", "turnstileToken"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return { error: "توجد حقول غير معروفة." };
  const category = typeof input.category === "string" ? input.category : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const token = typeof input.turnstileToken === "string" ? input.turnstileToken : "";
  if (!CATEGORIES.has(category)) return { error: "نوع الاقتراح غير صالح." };
  if (title.length < 4 || title.length > 120) return { error: "العنوان يجب أن يكون بين 4 و120 حرفًا." };
  if (description.length < 10 || description.length > 3000) return { error: "التفاصيل يجب أن تكون بين 10 و3000 حرف." };
  if (token.length < 1 || token.length > 2048) return { error: "أكمل التحقق الأمني أولًا." };
  return { value: { category, title, description, token } };
}

async function verifyTurnstile(token: string, hostname: string, secret: string): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("TURNSTILE_UNAVAILABLE");
  const result = await response.json();
  return result?.success === true &&
    typeof result.hostname === "string" &&
    result.hostname.toLowerCase() === hostname.toLowerCase() &&
    result.action === "suggestion";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "المصدر غير مسموح." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "apikey,content-type,x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  } : {} });
  if (req.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة." }, 405, origin, { Allow: "POST, OPTIONS" });

  let input: Record<string, unknown>;
  try { input = await readInput(req); }
  catch (error) {
    const code = (error as Error).message;
    const status = code === "TOO_LARGE" ? 413 : code === "CONTENT_TYPE" ? 415 : 400;
    return json({ error: code === "TOO_LARGE" ? "حجم الطلب أكبر من المسموح." : code === "CONTENT_TYPE" ? "أرسل الاقتراح بصيغة JSON." : "بيانات الطلب غير صالحة." }, status, origin);
  }
  const checked = validateInput(input);
  if (checked.error || !checked.value) return json({ error: checked.error }, 400, origin);

  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = getKey("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!turnstileSecret || !supabaseUrl || !secretKey) {
    return json({ error: "خدمة إرسال الاقتراحات غير مهيأة." }, 503, origin);
  }

  let hostname = "";
  try { hostname = new URL(origin || "").hostname; } catch { return json({ error: "المصدر غير صالح." }, 403, origin); }
  let verified = false;
  try { verified = await verifyTurnstile(checked.value.token, hostname, turnstileSecret); }
  catch { return json({ error: "تعذر التحقق الأمني الآن. حاول لاحقًا." }, 503, origin); }
  if (!verified) return json({ error: "فشل التحقق الأمني أو انتهت صلاحيته. أعد المحاولة." }, 403, origin);

  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value || "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const { data, error } = await admin.rpc("submit_suggestion_with_daily_cap", {
    p_day: day,
    p_cap: dailyCap(),
    p_category: checked.value.category,
    p_title: checked.value.title,
    p_description: checked.value.description,
  });
  if (error) return json({ error: "تعذر حفظ الاقتراح والتحقق من الحد اليومي." }, 503, origin);
  if (data?.allowed === false) {
    return json({ error: "وصلنا إلى الحد اليومي لاستقبال الاقتراحات. حاول غدًا." }, 429, origin, { "Retry-After": "3600" });
  }
  if (data?.allowed !== true || !data.item) return json({ error: "تعذر حفظ الاقتراح الآن." }, 502, origin);
  return json({ item: data.item }, 201, origin);
});
