'use strict';

const LIVE_LINKS_REPLY = [
  'روابط البث ومتابعة الدكتور خالد:',
  '1) قناة يوتيوب: https://www.youtube.com/@Khaled_Najm',
  '2) حساب تيك توك: https://www.tiktok.com/@d.khaled.4',
  '3) الاستيج الصوتي داخل مجموعة استراحة أهل الأثر: افتح المجموعة نفسها واطلب الانضمام إلى الاستيج أو التحدث عندما يكون مفتوحًا.',
  '',
  'يمكنك فتح الروابط ومتابعة الخيار المناسب لك. لا توجد وصلة مستقلة مؤكدة للاستيج.'
].join('\n');

function isLiveLinkQuestion(message) {
  if (!message || typeof message.text !== 'string') return false;
  const text = message.text.trim().toLowerCase();
  if (!text) return false;
  if (/^\/(?:live|broadcast)(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  const asksAboutLive = /(?:رابط|لينك|وصلة|أين|فين|ازاي|كيف|عايز|عاوز|اريد|أريد|البث|اللايف|لايف|مباشر|live|stream|broadcast)/iu.test(text);
  const namesPlatform = /(?:يوتيوب|youtube|تيك ?توك|tiktok|استيج|stage|بث|لايف|مباشر|live|stream|broadcast)/iu.test(text);
  return asksAboutLive && namesPlatform;
}

function createTelegramAssistant(options) {
  const sendMessage = options && options.sendMessage;
  if (typeof sendMessage !== 'function') throw new TypeError('sendMessage is required');
  return {
    async handleMessage(message, groupId) {
      if (!message || !message.chat || String(message.chat.id) !== String(groupId)) return false;
      if (!isLiveLinkQuestion(message)) return false;
      await sendMessage({ chat_id: groupId, text: LIVE_LINKS_REPLY, disable_web_page_preview: true });
      return true;
    }
  };
}

module.exports = { LIVE_LINKS_REPLY, isLiveLinkQuestion, createTelegramAssistant };
