import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const LIVE_REPLY = [
  "روابط البث ومتابعة الدكتور خالد:",
  "1) قناة يوتيوب: https://www.youtube.com/@Khaled_Najm",
  "2) حساب تيك توك: https://www.tiktok.com/@d.khaled.4",
  "3) الاستيج الصوتي داخل مجموعة استراحة أهل الأثر: افتح المجموعة نفسها واطلب الانضمام إلى الاستيج أو التحدث عندما يكون مفتوحًا.",
  "",
  "لا توجد وصلة مستقلة مؤكدة للاستيج."
].join("\n");

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function isAddressed(message: Record<string, any>, botUsername: string): boolean {
  const text = typeof message.text === "string" ? message.text : "";
  if (/^\/(?:live|broadcast)(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  if (/(?:^|\s)يا\s+حارس(?:[!،,.؟?\s]|$)/u.test(text)) return true;
  if (botUsername && new RegExp("(^|\\s)@" + botUsername.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "(?=\\s|$)", "i").test(text)) return true;
  const reply = message.reply_to_message;
  return Boolean(reply?.from?.is_bot && (
    !botUsername || String(reply.from.username || "").toLowerCase() === botUsername.toLowerCase()
  ));
}

function isLiveQuestion(text: string): boolean {
  if (/^\/(?:live|broadcast)(?:@\w+)?(?:\s|$)/i.test(text.trim())) return true;
  const asks = /(?:رابط|لينك|وصلة|أين|فين|ازاي|كيف|عايز|عاوز|اريد|أريد|البث|اللايف|لايف|مباشر|live|stream|broadcast)/iu.test(text);
  const platform = /(?:يوتيوب|youtube|تيك\s?توك|tiktok|استيج|stage|بث|لايف|مباشر|live|stream|broadcast)/iu.test(text);
  return asks && platform;
}

async function sendReply(token: string, chatId: string | number, text: string, replyTo?: number) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(Number.isSafeInteger(replyTo) ? { reply_to_message_id: replyTo } : {})
    }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
  const result = await response.json();
  if (result?.ok !== true) throw new Error("TELEGRAM_SEND_FAILED");
}

Deno.serve(async (request: Request) => {
  if (request.method === "GET") return json({ service: "telegram-webhook", ready: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  const groupId = Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("TELEGRAM_MEDIA_GROUP_ID") || "";
  const botUsername = (Deno.env.get("TELEGRAM_BOT_USERNAME") || "Horas96sbot").replace(/^@/, "");

  if (!token || !expectedSecret || !groupId) {
    console.error("Telegram webhook configuration is incomplete.");
    return json({ error: "Webhook is not configured" }, 503);
  }

  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!constantTimeEqual(providedSecret, expectedSecret)) return json({ error: "Unauthorized" }, 401);

  let update: Record<string, any>;
  try {
    const raw = await request.text();
    if (raw.length > 64 * 1024) return json({ error: "Payload too large" }, 413);
    update = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const message = update.message || update.edited_message;
  if (!message || !message.chat || String(message.chat.id) !== String(groupId)) {
    return json({ ok: true, ignored: true });
  }
  if (message.from?.is_bot || typeof message.text !== "string" || !isAddressed(message, botUsername)) {
    return json({ ok: true, ignored: true });
  }

  if (isLiveQuestion(message.text)) {
    try {
      await sendReply(token, groupId, LIVE_REPLY, message.message_id);
    } catch {
      console.error("Telegram reply delivery failed.");
      return json({ error: "Telegram delivery failed" }, 502);
    }
    return json({ ok: true, replied: true });
  }

  return json({ ok: true, ignored: true, reason: "No verified answer handler is configured for this question type." });
});
