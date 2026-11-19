import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const ALLOWED_ORIGINS = new Set([
  "https://hares-preview.aboserag925.workers.dev",
  "https://feat-visual-identity-v2-mainline-20261119-hares.aboserag925.workers.dev",
  "https://hares.aboserag925.workers.dev",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);
const MAX_BODY_BYTES = 8 * 1024;
const MAX_QUESTION_LENGTH = 1600;
const MAX_DRAFT_LENGTH = 5000;
const DAILY_CAP = 200;

function json(data: unknown, status = 200, origin: string | null = null) {
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
  return new Response(JSON.stringify(data), { status, headers });
}

function secret(name: string): string {
  const raw = Deno.env.get(name) || "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.default === "string") return parsed.default;
  } catch { /* plain environment value */ }
  return raw;
}

async function readInput(req: Request) {
  if (!/^application\\/json(?:\\s*;|$)/i.test(req.headers.get("content-type") || "")) {
    throw new Error("CONTENT_TYPE");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("INVALID_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["question", "turnstileToken"].includes(key))) throw new Error("INVALID_FIELDS");
  const question = typeof input.question === "string" ? input.question.trim() : "";
  const token = typeof input.turnstileToken === "string" ? input.turnstileToken : "";
  if (question.length < 5 || question.length > MAX_QUESTION_LENGTH) throw new Error("QUESTION");
  if (!token || token.length > 2048) throw new Error("TURNSTILE");
  return { question, token };
}

async function verifyTurnstile(token: string, hostname: string, key: string) {
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: key, response: token }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("TURNSTILE_UNAVAILABLE");
  const result = await response.json();
  return result?.success === true &&
    typeof result.hostname === "string" &&
    result.hostname.toLowerCase() === hostname.toLowerCase() &&
    result.action === "submit_question";
}

async function createDraft(question: string, apiKey: string) {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw new Error("MODEL_CONFIG");
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: question }] }],
        systemInstruction: { parts: [{
          text: "أنت مساعد يصوغ مسودة أولية باللغة العربية لعرضها على عالم شرعي للمراجعة. لا تقدّم المسودة كفتوى أو حكم معتمد، ولا تدّع أنك عالم. إذا احتاج السؤال إلى فتوى خاصة أو كان الدليل غير متحقق، فصرّح بذلك وأحل السائل إلى الدكتور خالد للمراجعة. لا تختلق آيات أو أحاديث أو مراجع. اجعل الرد موجزًا ومحترمًا، واختم بالتنبيه أن المسودة غير معتمدة حتى يراجعها الدكتور خالد."
        }] },
        generationConfig: { maxOutputTokens: 700, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error("GEMINI_FAILED");
  const payload = await response.json();
  const draft = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => typeof part.text === "string" ? part.text : "")
    .join("").trim() || "";
  if (!draft) throw new Error("EMPTY_DRAFT");
  return draft.length > MAX_DRAFT_LENGTH ? draft.slice(0, MAX_DRAFT_LENGTH).trimEnd() + "\\n[اختُصر الرد لطوله.]" : draft;
}

async function sendToTelegram(question: string, draft: string, botToken: string, chatId: string) {
  const response = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "سؤال للمراجعة من التطبيق:\\n\\n" + question +
        "\\n\\nمسودة Gemini غير معتمدة:\\n" + draft,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("TELEGRAM_FAILED");
  const payload = await response.json();
  if (payload?.ok !== true) throw new Error("TELEGRAM_FAILED");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "المصدر غير مسموح." }, 403);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "apikey,content-type,x-client-info",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    } : {} });
  }
  if (req.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة." }, 405, origin);

  let input: { question: string; token: string };
  try { input = await readInput(req); }
  catch (error) {
    const code = (error as Error).message;
    const status = code === "TOO_LARGE" ? 413 : code === "CONTENT_TYPE" ? 415 : 400;
    const message = code === "QUESTION" ? "يجب أن يكون السؤال بين 5 و1600 حرف."
      : code === "TURNSTILE" ? "أكمل التحقق الأمني أولًا."
      : "بيانات الطلب غير صالحة.";
    return json({ error: message }, status, origin);
  }

  const turnstileKey = secret("TURNSTILE_SECRET_KEY");
  const geminiKey = secret("GEMINI_API_KEY");
  const telegramToken = secret("TELEGRAM_BOT_TOKEN");
  const chatId = secret("TELEGRAM_CHAT_ID");
  const supabaseUrl = secret("SUPABASE_URL");
  const serviceKey = secret("SUPABASE_SECRET_KEYS") || secret("SUPABASE_SERVICE_ROLE_KEY");
  if (!turnstileKey || !geminiKey || !telegramToken || !chatId || !supabaseUrl || !serviceKey) {
    return json({ error: "خدمة الأسئلة غير مهيأة على الخادم." }, 503, origin);
  }
  let hostname = "";
  try { hostname = new URL(origin || "").hostname; }
  catch { return json({ error: "المصدر غير صالح." }, 403, origin); }

  try {
    const verified = await verifyTurnstile(input.token, hostname, turnstileKey);
    if (!verified) return json({ error: "فشل التحقق الأمني. أعد المحاولة." }, 403, origin);
  } catch {
    return json({ error: "تعذر التحقق الأمني الآن. حاول لاحقًا." }, 503, origin);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const day = get("year") + "-" + get("month") + "-" + get("day");
  const cap = Number.parseInt(Deno.env.get("QUESTIONS_DAILY_CAP") || String(DAILY_CAP), 10);
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 1000000) {
    return json({ error: "إعداد الحد اليومي غير صالح." }, 503, origin);
  }
  const { data: allowed, error: budgetError } = await supabase.rpc("consume_question_daily_cap", {
    p_day: day, p_cap: cap,
  });
  if (budgetError) return json({ error: "تعذر التحقق من الحد اليومي للأسئلة الآن." }, 503, origin);
  if (allowed !== true) return json({ error: "بلغ الموقع حد الأسئلة اليومي. حاول غدًا." }, 429, origin);

  let draft = "";
  try { draft = await createDraft(input.question, geminiKey); }
  catch {
    return json({ error: "تعذر إنشاء مسودة الآن. حاول لاحقًا." }, 502, origin);
  }
  try { await sendToTelegram(input.question, draft, telegramToken, chatId); }
  catch {
    return json({ error: "تعذر تأكيد إرسال السؤال إلى Telegram.", draft, telegramSent: false }, 502, origin);
  }
  return json({ draft, telegramSent: true }, 200, origin);
});
