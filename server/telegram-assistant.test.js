'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LIVE_LINKS_REPLY, isLiveLinkQuestion, createTelegramAssistant } = require('./telegram-assistant');

test('recognizes common Arabic and English live-stream link questions', function () {
  for (const text of [
    'أين رابط البث؟',
    'فين اللايف على اليوتيوب؟',
    'عايز لينك تيك توك مباشر',
    'كيف أسمع الدكتور وقت البث؟',
    '/live'
  ]) assert.equal(isLiveLinkQuestion({ text }), true, text);
});

test('does not respond to unrelated group messages', function () {
  assert.equal(isLiveLinkQuestion({ text: 'السلام عليكم ورحمة الله' }), false);
  assert.equal(isLiveLinkQuestion({ text: 'متى موعد الدرس؟' }), false);
  assert.equal(isLiveLinkQuestion({ text: 'يوتيوب' }), false);
});

test('sends all three approved destinations together only in the configured group', async function () {
  const sent = [];
  const assistant = createTelegramAssistant({
    sendMessage: async payload => { sent.push(payload); }
  });
  assert.equal(await assistant.handleMessage({ chat: { id: '-1001' }, text: 'رابط البث على تيك توك' }, '-1001'), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, '-1001');
  assert.match(sent[0].text, /youtube\.com\/@Khaled_Najm/);
  assert.match(sent[0].text, /tiktok\.com\/@d\.khaled\.4/);
  assert.match(sent[0].text, /الاستيج الصوتي داخل مجموعة/);
  assert.equal(await assistant.handleMessage({ chat: { id: '-1002' }, text: 'أين البث؟' }, '-1001'), false);
  assert.equal(sent.length, 1);
});

test('reply text does not invent a direct stage URL', function () {
  assert.match(LIVE_LINKS_REPLY, /لا توجد وصلة مستقلة مؤكدة للاستيج/);
  assert.doesNotMatch(LIVE_LINKS_REPLY, /t\.me\//);
});
