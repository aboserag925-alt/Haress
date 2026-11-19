import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_URLS_PER_MESSAGE = 20;
const MAX_WEBSITE_LECTURES_PER_SYNC = 20;
const MAX_TELEGRAM_TEXT = 3900;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function csvIds(value: string): Set<string> {
  return new Set(value.split(",").map((part) => part.trim()).filter((part) => /^-?\d+$/.test(part)));
}

function extractUrls(text: string, entities: Array<Record<string, unknown>> = []): string[] {
  const found = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw !== "string" || raw.length > 2048) return;
    let value = raw.trim().replace(/[)\]}>،,.!?؛:]+$/u, "");
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        found.add(url.href);
      }
    } catch { /* Ignore non-URL text. */ }
  };
  for (const entity of entities) {
    if (entity.type === "url" && Number.isInteger(entity.offset) && Number.isInteger(entity.length)) {
      const start = Number(entity.offset);
      const length = Number(entity.length);
      add(text.slice(start, start + length));
    } else if (entity.type === "text_link") {
      add(entity.url);
    }
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/giu)) add(match[0]);
  const selected: string[] = [];
  let total = 0;
  for (const link of found) {
    const next = link.length + (selected.length ? 4 : 0);
    if (selected.length >= MAX_URLS_PER_MESSAGE || total + next > MAX_TELEGRAM_TEXT - 120) break;
    selected.push(link);
    total += next;
  }
  return selected;
}

function safeText(value: unknown, max = 180): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || "")) throw new Error("CONTENT_TYPE");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
  return value as Record<string, unknown>;
}

async function telegramSend(token: string, chatId: string, text: string): Promise<void> {
  if (text.length > MAX_TELEGRAM_TEXT) throw new Error("TELEGRAM_MESSAGE_TOO_LONG");
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    signal: AbortSignal.timeout(15000),
  });
  let payload: Record<string, unknown>;
  try { payload = await response.json(); } catch { throw new Error("TELEGRAM_INVALID_RESPONSE"); }
  if (!response.ok || payload.ok !== true) throw new Error("TELEGRAM_SEND_FAILED");
}

async function reserveDelivery(admin: ReturnType<typeof createClient>, sourceKey: string, sourceType: string, sourceRef: string, urlCount: number): Promise<boolean> {
  const { error } = await admin.from("telegram_link_deliveries").insert({
    source_key: sourceKey, source_type: sourceType, source_ref: sourceRef, url_count: urlCount,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error("DELIVERY_LEDGER_UNAVAILABLE");
}

async function rollbackDelivery(admin: ReturnType<typeof createClient>, sourceKey: string): Promise<void> {
  await admin.from("telegram_link_deliveries").delete().eq("source_key", sourceKey);
}

async function authenticateAdmin(req: Request, supabaseUrl: string, publishableKey: string, secretKey: string): Promise<boolean> {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  if (!match || !publishableKey) return false;
  const publicClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await publicClient.auth.getUser(match[1]);
  if (error || !data.user?.id) return false;
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: row, error: adminError } = await admin.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return !adminError && Boolean(row);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const marker = "/telegram-link-bot";
  const index = url.pathname.indexOf(marker);
  const route = index >= 0 ? (url.pathname.slice(index + marker.length) || "/") : "/";
  if (req.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const groupId = Deno.env.get("TELEGRAM_CHAT_ID") || "";
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  const doctorIds = csvIds(Deno.env.get("TELEGRAM_DOCTOR_USER_IDS") || "");
  const enabled = Deno.env.get("TELEGRAM_LINKS_ENABLED") === "true";
  if (!supabaseUrl || !secretKey || !token || !groupId || !webhookSecret) return json({ error: "خدمة روابط Telegram غير مهيأة." }, 503);
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (route === "/webhook") {
    const suppliedSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (!constantTimeEqual(suppliedSecret, webhookSecret)) return json({ error: "غير مصرح." }, 401);
    let update: Record<string, unknown>;
    try { update = await readJson(req); } catch { return json({ error: "تحديث Telegram غير صالح." }, 400); }
    const message = (update.message || update.edited_message || update.channel_post) as Record<string, unknown> | undefined;
    if (!message || !message.chat || typeof message.chat !== "object") return json({ ok: true, ignored: true });
    const chat = message.chat as Record<string, unknown>;
    if (String(chat.id) !== groupId) return json({ ok: true, ignored: true });
    const from = message.from && typeof message.from === "object" ? message.from as Record<string, unknown> : {};
    const text = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";
    const entities = (Array.isArray(message.entities) ? message.entities : Array.isArray(message.caption_entities) ? message.caption_entities : []) as Array<Record<string, unknown>>;
    if (/^\/myid(?:@\w+)?(?:\s|$)/i.test(text)) {
      const id = from.id;
      if (id !== undefined) await telegramSend(token, groupId, "معرّف حساب Telegram الخاص بك: " + String(id));
      return json({ ok: true, command: "myid" });
    }
    if (!enabled || !from.id || from.is_bot === true || !doctorIds.has(String(from.id))) return json({ ok: true, ignored: true });
    const links = extractUrls(text, entities);
    if (!links.length) return json({ ok: true, links: 0 });
    const updateId = Number(update.update_id);
    if (!Number.isSafeInteger(updateId) || updateId < 0) return json({ error: "معرّف تحديث Telegram غير صالح." }, 400);
    const sourceKey = "telegram-update:" + updateId;
    const reserved = await reserveDelivery(admin, sourceKey, "group_message", String(message.message_id || updateId), links.length);
    if (!reserved) return json({ ok: true, duplicate: true });
    const sender = safeText([from.first_name, from.last_name].filter(Boolean).join(" "), 80) || "الدكتور";
    const lines = ["روابط جديدة من الدكتور (" + sender + "):", ...links.map((link, i) => (i + 1) + ". " + link)];
    try {
      await telegramSend(token, groupId, lines.join("\n"));
    } catch {
      await rollbackDelivery(admin, sourceKey);
      return json({ error: "تعذر نشر الروابط في المجموعة." }, 502);
    }
    return json({ ok: true, links: links.length });
  }

  if (route === "/admin/publish-website-links") {
    if (!enabled) return json({ error: "نشر الروابط معطل حتى اكتمال إعداد البوت." }, 503);
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!await authenticateAdmin(req, supabaseUrl, publishableKey, secretKey)) return json({ error: "هذه العملية للمشرفين فقط." }, 403);
    const { data: lectures, error } = await admin.from("lectures")
      .select("id,title,starts_at,stream_url,recording_url,updated_at")
      .eq("status", "published").order("starts_at", { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) return json({ error: "تعذر قراءة روابط المحاضرات." }, 502);
    let duplicates = 0;
    const pending: Array<{ key: string; lines: string[] }> = [];
    for (const lecture of lectures || []) {
      const links = [
        { field: "stream", label: "رابط البث", value: lecture.stream_url },
        { field: "recording", label: "رابط التسجيل", value: lecture.recording_url },
      ].filter((item): item is { field: string; label: string; value: string } =>
        typeof item.value === "string" && /^https:\/\//i.test(item.value));
      if (!links.length) continue;
      const title = safeText(lecture.title, 180) || "محاضرة";
      for (const item of links) {
        const sourceKey = "website-lecture:" + lecture.id + ":" + String(lecture.updated_at || "") + ":" + item.field;
        const reserved = await reserveDelivery(admin, sourceKey, "website_lecture", String(lecture.id), 1);
        if (!reserved) { duplicates++; continue; }
        pending.push({ key: sourceKey, lines: ["• " + title, item.label + ": " + item.value] });
      }
    }

    let posted = 0;
    let batch: Array<{ key: string; lines: string[] }> = [];
    let batchText = "روابط المحاضرات المنشورة من موقع حارس:\n";
    const flush = async (): Promise<boolean> => {
      if (!batch.length) return true;
      try {
        await telegramSend(token, groupId, batchText);
        posted += batch.length;
        batch = [];
        batchText = "روابط المحاضرات المنشورة من موقع حارس:\n";
        return true;
      } catch {
        return false;
      }
    };

    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i];
      const section = entry.lines.join("\n") + "\n\n";
      if (batch.length && (batch.length >= 15 || batchText.length + section.length > 3500)) {
        if (!await flush()) {
          for (const unsent of [...batch, ...pending.slice(i)]) await rollbackDelivery(admin, unsent.key);
          return json({ error: "توقف النشر بعد " + posted + " مجموعة من الروابط؛ تعذر إرسال الدفعة التالية.", posted, duplicates }, 502);
        }
      }
      batch.push(entry);
      batchText += section;
    }
    if (!await flush()) {
      for (const unsent of batch) await rollbackDelivery(admin, unsent.key);
      return json({ error: "توقف النشر بعد " + posted + " مجموعة من الروابط؛ تعذر إرسال الدفعة الأخيرة.", posted, duplicates }, 502);
    }
    return json({ ok: true, posted, duplicates, checked: (lectures || []).length });
  }

  return json({ error: "المسار غير موجود." }, 404);
});
