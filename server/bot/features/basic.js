'use strict';

const { CATEGORY_NAMES } = require('../../media-library');
const { createUserRateLimiter } = require('../rate-limit');

const MIN_QUESTION = 5;
const MAX_QUESTION = 1600;
const SCHEDULE_DAYS = 7;
const LIBRARY_PAGE = 10;
const LIBRARY_FILTERS = ['all', 'audio', 'video', 'books', 'images'];

function cairoFormatter(options) {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', Object.assign({ timeZone: 'Africa/Cairo' }, options));
}

function formatDay(date) {
  return cairoFormatter({ weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function formatTime(date) {
  return cairoFormatter({ hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

function formatCairoDateTime(date) {
  return formatDay(date) + ' ' + formatTime(date);
}

function helpText(ctx) {
  return [
    '<b>استراحة أهل الأثر</b>',
    'منصة علمية دعوية تجمع المحاضرات والمواد المعتمدة وإجابات الأسئلة.',
    '',
    '<b>الأوامر</b>',
    '/schedule مواعيد المحاضرات والبث خلال 7 أيام',
    '/library آخر المواد المعتمدة',
    '/ask طريقة إرسال سؤال',
    '/remind تذكير خاص بالمحاضرات (في محادثة خاصة)',
    '/help عرض هذه القائمة'
  ].join('\n');
}

function openSiteKeyboard(ctx) {
  return { inline_keyboard: [[{ text: 'افتح الموقع والتطبيق', url: ctx.siteUrl }]] };
}

async function sendStart(ctx, message) {
  await ctx.reply(message, helpText(ctx), { reply_markup: openSiteKeyboard(ctx) });
}

async function sendSchedule(ctx, message) {
  if (!ctx.store.configured()) {
    await ctx.reply(message, 'الجدول غير متاح الآن. حاول لاحقًا.');
    return;
  }
  const from = new Date(ctx.now());
  const to = new Date(from.getTime() + SCHEDULE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await ctx.store.publicRead(
    'lectures?select=id,title,starts_at,category,stream_url&status=eq.published' +
    '&starts_at=gte.' + encodeURIComponent(from.toISOString()) +
    '&starts_at=lte.' + encodeURIComponent(to.toISOString()) +
    '&order=starts_at.asc');
  if (!rows || !rows.length) {
    await ctx.reply(message, 'لا توجد محاضرات أو بث منشور خلال 7 أيام. تابع الجدول لاحقًا.');
    return;
  }
  const lines = ['<b>مواعيد الأيام السبعة القادمة</b> (بتوقيت القاهرة)'];
  let currentDay = '';
  rows.forEach(function (row) {
    const date = new Date(row.starts_at);
    const day = formatDay(date);
    if (day !== currentDay) {
      currentDay = day;
      lines.push('', '<b>' + ctx.escape(day) + '</b>');
    }
    let line = formatTime(date) + ' - ' + ctx.escape(row.title);
    if (row.category) line += ' (' + ctx.escape(row.category) + ')';
    lines.push(line);
  });
  await ctx.reply(message, lines.join('\n'));
}

function libraryKeyboard(active) {
  const labels = { all: 'الكل', audio: CATEGORY_NAMES.audio, video: CATEGORY_NAMES.video,
    books: CATEGORY_NAMES.books, images: CATEGORY_NAMES.images };
  return {
    inline_keyboard: [LIBRARY_FILTERS.map(function (key) {
      return { text: (key === active ? '• ' : '') + labels[key], callback_data: 'lib:' + key };
    })]
  };
}

async function libraryText(ctx, filter) {
  if (!ctx.mediaLibrary) return 'المكتبة غير مفعلة على الخادم.';
  const all = await ctx.mediaLibrary.listApproved();
  const items = all.filter(function (item) { return filter === 'all' || item.category === filter; })
    .slice(0, LIBRARY_PAGE);
  if (!items.length) return 'لا توجد مواد معتمدة في هذا التصنيف بعد.';
  const base = (ctx.env.PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
  const lines = ['<b>آخر المواد المعتمدة</b>'];
  items.forEach(function (item, index) {
    const title = ctx.escape(item.title);
    const link = /^https:\/\//.test(base)
      ? '<a href="' + ctx.escape(base + item.url) + '">' + title + '</a>'
      : title;
    lines.push((index + 1) + '. ' + link + ' - ' + ctx.escape(item.categoryName));
  });
  return lines.join('\n');
}

async function sendLibrary(ctx, message) {
  await ctx.reply(message, await libraryText(ctx, 'all'), { reply_markup: libraryKeyboard('all') });
}

async function onLibraryCallback(ctx, callback) {
  const filter = callback.data.split(':')[1];
  if (!LIBRARY_FILTERS.includes(filter) || !callback.message) {
    await ctx.client.call('answerCallbackQuery', { callback_query_id: callback.id });
    return;
  }
  await ctx.client.call('answerCallbackQuery', { callback_query_id: callback.id });
  try {
    await ctx.client.call('editMessageText', {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: await libraryText(ctx, filter),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: libraryKeyboard(filter)
    });
  } catch (error) {
    // Telegram returns 400 when the text did not change; that is not a failure.
    if (error.status !== 400) throw error;
  }
}

function register(bot) {
  const askLimiter = createUserRateLimiter({ limit: 3, windowMs: 15 * 60 * 1000 });

  bot.registerCommand('start', { description: 'تعريف بالمنصة', handler: sendStart });
  bot.registerCommand('help', { description: 'قائمة الأوامر', handler: sendStart });
  bot.registerCommand('schedule', { description: 'مواعيد المحاضرات والبث', handler: sendSchedule });
  bot.registerCommand('library', { description: 'آخر المواد المعتمدة', handler: sendLibrary });
  bot.registerCommand('ask', {
    description: 'إرسال سؤال للمراجعة',
    handler: async function (ctx, message, argument) {
      if (!argument) {
        await ctx.reply(message, [
          '<b>طريقة إرسال سؤال</b>',
          'اكتب الأمر ثم سؤالك في رسالة واحدة، مثال:',
          '/ask ما شروط قبول الحديث؟',
          'يُعدّ النظام مسودة أولية، ويراجعها المشرفون. لا تُنشر إجابة قبل اعتماد مشرف، ولا تُعد المسودة فتوى.',
          'يمكنك أيضًا إرسال السؤال من الموقع: ' + ctx.escape(ctx.siteUrl)
        ].join('\n'));
        return;
      }
      if (argument.length < MIN_QUESTION || argument.length > MAX_QUESTION) {
        await ctx.reply(message, 'يجب أن يكون السؤال بين 5 و1600 حرف.');
        return;
      }
      if (!ctx.submitQuestion) {
        await ctx.reply(message, 'استقبال الأسئلة غير مفعّل الآن.');
        return;
      }
      if (!askLimiter(String(message.from.id), ctx.now()).allowed) {
        await ctx.reply(message, 'وصلت إلى حد الأسئلة المؤقت. حاول لاحقًا.');
        return;
      }
      try {
        await ctx.submitQuestion(argument, { source: 'telegram', user: message.from });
      } catch (error) {
        if (error && error.blocked) throw error;
        ctx.logger.error('Telegram question submission failed: ' + (error && error.message));
        await ctx.reply(message, 'تعذر إرسال السؤال الآن. حاول لاحقًا.');
        return;
      }
      await ctx.reply(message, 'وصل سؤالك إلى المشرفين للمراجعة. لن تُنشر أي إجابة قبل اعتمادها.');
    }
  });
  bot.registerCallback('lib', onLibraryCallback);
}

module.exports = { register, formatCairoDateTime, formatDay, formatTime };
