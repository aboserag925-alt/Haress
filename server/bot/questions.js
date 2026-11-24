'use strict';

const { escapeHtml } = require('./telegram-client');

const MAX_ANSWER = 4000;
const STATUS_LABELS = {
  pending: 'بانتظار المراجعة',
  review: 'إجابة بانتظار النشر',
  published: 'معتمد ومنشور',
  rejected: 'مرفوض'
};

// Older drafts may still end with Gemini's own "unapproved draft" sentence. That sentence is wrong once a
// moderator approves the answer, so a trailing paragraph made only of that notice is removed on approval.
function stripDraftNotice(text) {
  const lines = String(text || '').trim().split(/\n/);
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    if (last === '') { lines.pop(); continue; }
    if (last.length < 220 && /(?:المسودة|مسودة)\s+غير\s+معتمدة|حتى\s+يراجعها/.test(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

function reviewKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: 'اعتماد المسودة', callback_data: 'q:ap:' + id },
      { text: 'تعديل', callback_data: 'q:ed:' + id },
      { text: 'رفض', callback_data: 'q:rj:' + id }
    ]]
  };
}

function questionText(row, status, note) {
  const lines = [
    '<b>سؤال للمراجعة</b>',
    'رقم السؤال: <code>' + escapeHtml(row.id) + '</code>',
    'المصدر: ' + (row.source === 'telegram' ? 'Telegram' : 'الموقع'),
    '',
    escapeHtml(row.question),
    '',
    '<b>مسودة Gemini غير معتمدة:</b>',
    escapeHtml(row.draft || '')
  ];
  if (status) lines.push('', 'الحالة: ' + STATUS_LABELS[status] + (note ? ' ' + escapeHtml(note) : ''));
  else lines.push('', 'لا تُنشر أي إجابة قبل اعتماد مشرف. للإجابة بنفسك ردّ (Reply) على هذه الرسالة.');
  return lines.join('\n');
}

function createQuestionService(options) {
  const env = options.env;
  const store = options.store;
  const client = options.client;
  const logger = options.logger || console;
  const now = options.now || function () { return Date.now(); };
  const createDraft = options.createDraft;
  const groupChatId = env.TELEGRAM_CHAT_ID;

  function enabled() {
    return Boolean(store.adminConfigured() && env.GEMINI_API_KEY && env.TELEGRAM_BOT_TOKEN && groupChatId);
  }

  async function transition(id, from, patch) {
    const rows = await store.admin('questions?id=eq.' + encodeURIComponent(id) +
      '&status=in.(' + from.join(',') + ')', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    });
    return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  }

  async function getQuestion(id) {
    const rows = await store.admin('questions?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1');
    return rows && rows[0] ? rows[0] : null;
  }

  async function rememberMessage(chatId, messageId, questionId, kind) {
    await store.admin('question_messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, question_id: questionId, kind: kind })
    });
  }

  // Stores the question, asks Gemini for a draft, and posts both to the moderators with review buttons.
  // The draft is never returned to the asker. Only the question id leaves this function.
  async function submit(text, meta) {
    meta = meta || {};
    if (!enabled()) throw new Error('Question intake is not configured');
    const draft = await createDraft(text);
    const rows = await store.admin('questions?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        source: meta.source === 'telegram' ? 'telegram' : 'web',
        question: text,
        draft: draft,
        asker_telegram_id: meta.user && meta.user.id ? meta.user.id : null
      })
    });
    const row = rows[0];
    try {
      const sent = await client.sendMessage(groupChatId, questionText(row), { reply_markup: reviewKeyboard(row.id) });
      await rememberMessage(sent.chat ? sent.chat.id : groupChatId, sent.message_id, row.id, 'question');
    } catch (error) {
      // Nothing reached the moderators, so drop the row and let the asker retry.
      await store.admin('questions?id=eq.' + encodeURIComponent(row.id), { method: 'DELETE' }).catch(function () {});
      throw error;
    }
    return { id: row.id };
  }

  async function notifyAsker(row) {
    if (row.source !== 'telegram' || !row.asker_telegram_id) return;
    try {
      await client.sendMessage(row.asker_telegram_id,
        '<b>إجابة سؤالك</b>\n' + escapeHtml(row.question) + '\n\n' + escapeHtml(row.answer));
    } catch (error) {
      // 403: the asker never started a private chat with the bot. The answer stays on the site.
      if (!error.blocked) logger.error('Answer notification failed: ' + error.message);
    }
  }

  async function updateReviewMessage(callback, row, status, note) {
    if (!callback.message) return;
    try {
      await client.call('editMessageText', {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: questionText(row, status, note),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [] }
      });
    } catch (error) {
      if (error.status !== 400) logger.error('Review message update failed: ' + error.message);
    }
  }

  function answerCallback(callback, text, alert) {
    return client.call('answerCallbackQuery', {
      callback_query_id: callback.id, text: text, show_alert: Boolean(alert)
    });
  }

  function approverName(user) {
    return user.username ? '@' + user.username : String(user.first_name || user.id);
  }

  async function handleCallback(ctx, callback) {
    const match = typeof callback.data === 'string' &&
      callback.data.match(/^q:(ap|ed|rj|pub|cx):([0-9a-f-]{36})$/i);
    if (!match || !callback.message || String(callback.message.chat.id) !== String(groupChatId)) {
      await answerCallback(callback, 'الطلب غير صالح.');
      return;
    }
    if (!await ctx.isAdmin(callback.from.id, { fresh: true })) {
      await answerCallback(callback, 'هذه الأزرار لمشرفي المجموعة فقط.', true);
      return;
    }
    const action = match[1];
    const id = match[2];
    const row = await getQuestion(id);
    if (!row) {
      await answerCallback(callback, 'السؤال غير موجود.');
      return;
    }
    const gone = function () { return answerCallback(callback, 'سبقت معالجة هذا السؤال.'); };

    if (action === 'ap') {
      if (!row.draft) { await answerCallback(callback, 'لا توجد مسودة.'); return; }
      const done = await transition(id, ['pending', 'review'], {
        status: 'published', answer: stripDraftNotice(row.draft), answer_source: 'draft',
        answered_by: callback.from.id, published_at: new Date(now()).toISOString()
      });
      if (!done) return gone();
      await answerCallback(callback, 'اعتُمدت المسودة ونُشرت.');
      await updateReviewMessage(callback, done, 'published', 'بواسطة ' + approverName(callback.from));
      await notifyAsker(done);
      return;
    }
    if (action === 'rj') {
      const done = await transition(id, ['pending', 'review'], { status: 'rejected', answer: null, answer_source: null });
      if (!done) return gone();
      await answerCallback(callback, 'رُفض السؤال.');
      await updateReviewMessage(callback, done, 'rejected', 'بواسطة ' + approverName(callback.from));
      return;
    }
    if (action === 'ed') {
      if (row.status !== 'pending' && row.status !== 'review') return gone();
      await answerCallback(callback, 'ردّ على رسالة التعديل بنص الإجابة.');
      const prompt = await client.sendMessage(callback.message.chat.id,
        'اكتب الإجابة المعدلة للسؤال <code>' + escapeHtml(id) + '</code> وأرسلها كردّ (Reply) على هذه الرسالة. ستُعرض للنشر بعد الاعتماد.',
        { reply_markup: { force_reply: true, selective: true }, reply_to_message_id: callback.message.message_id });
      await rememberMessage(prompt.chat ? prompt.chat.id : callback.message.chat.id, prompt.message_id, id, 'edit_prompt');
      return;
    }
    if (action === 'pub') {
      const done = await transition(id, ['review'], {
        status: 'published', answered_by: callback.from.id, published_at: new Date(now()).toISOString()
      });
      if (!done) return gone();
      await answerCallback(callback, 'نُشرت الإجابة.');
      await client.call('editMessageText', {
        chat_id: callback.message.chat.id, message_id: callback.message.message_id,
        text: 'نُشرت الإجابة على السؤال <code>' + escapeHtml(id) + '</code> بواسطة ' + escapeHtml(approverName(callback.from)),
        parse_mode: 'HTML', reply_markup: { inline_keyboard: [] }
      }).catch(function () {});
      await notifyAsker(done);
      return;
    }
    // cx: cancel a proposed answer and return the question to the pending list.
    const back = await transition(id, ['review'], { status: 'pending', answer: null, answer_source: null });
    if (!back) return gone();
    await answerCallback(callback, 'أُلغيت الإجابة المقترحة.');
    await client.call('editMessageText', {
      chat_id: callback.message.chat.id, message_id: callback.message.message_id,
      text: 'أُلغيت الإجابة المقترحة. السؤال ما زال بانتظار المراجعة.',
      reply_markup: { inline_keyboard: [] }
    }).catch(function () {});
  }

  // A moderator replies to the question message (or to the edit prompt) with the answer text.
  // The text is stored for review only. It is published after an explicit publish tap.
  async function handleReply(ctx, message) {
    const replied = message.reply_to_message;
    if (!replied || !message.from || String(message.chat.id) !== String(groupChatId)) return false;
    if (typeof message.text !== 'string' || !message.text.trim()) return false;
    const links = await store.admin('question_messages?select=question_id,kind&chat_id=eq.' +
      encodeURIComponent(message.chat.id) + '&message_id=eq.' + encodeURIComponent(replied.message_id));
    if (!links || !links.length) return false;
    if (!await ctx.isAdmin(message.from.id, { fresh: true })) return false;

    const answer = message.text.trim();
    if (answer.length > MAX_ANSWER) {
      await client.sendMessage(message.chat.id, 'الإجابة أطول من 4000 حرف. اختصرها وأعد الإرسال.',
        { reply_to_message_id: message.message_id });
      return true;
    }
    const id = links[0].question_id;
    const done = await transition(id, ['pending', 'review'], {
      status: 'review', answer: answer, answer_source: 'admin', answered_by: message.from.id
    });
    if (!done) {
      await client.sendMessage(message.chat.id, 'سبقت معالجة هذا السؤال أو لم يعد موجودًا.',
        { reply_to_message_id: message.message_id });
      return true;
    }
    await client.sendMessage(message.chat.id,
      '<b>حُفظت الإجابة للمراجعة ولم تُنشر بعد.</b>\nاضغط «نشر الإجابة» لاعتمادها.',
      {
        reply_to_message_id: message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: 'نشر الإجابة', callback_data: 'q:pub:' + id },
          { text: 'إلغاء', callback_data: 'q:cx:' + id }
        ]] }
      });
    return true;
  }

  async function listPublished() {
    const rows = await store.admin('questions?select=id,question,answer,published_at&status=eq.published' +
      '&order=published_at.desc&limit=50');
    return (rows || []).map(function (row) {
      return { id: row.id, question: row.question, answer: row.answer, published_at: row.published_at };
    });
  }

  return {
    enabled: enabled,
    submit: submit,
    handleCallback: handleCallback,
    handleReply: handleReply,
    listPublished: listPublished
  };
}

module.exports = { createQuestionService, questionText, stripDraftNotice };
