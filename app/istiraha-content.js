/* إستراحة أهل الأثر — بيانات الهوية والمحتوى والروابط.
   هذا الملف يفصل المحتوى الموثّق عن منطق الواجهة.
   أي معلومة غير مثبتة في المشروع تُكتب هنا صراحةً كـ placeholder. */
(function () {
  'use strict';

  var content = {
    brand: {
      name: 'إستراحة أهل الأثر',
      shortName: 'أهل الأثر',
      tagline: 'علم شرعي بمنهج أهل السنة',
      motto: 'القرآن والسنة بفهم وأخلاق سلف الأمة',
      legacy: 'غفر الله لهم'
    },
    doctor: {
      name: 'الشيخ خالد الحارس',
      role: 'المشرف على المجلس والدروس',
      verifiedFacts: [
        'يشرف على مجلس إستراحة أهل الأثر ودروسه العلمية.',
        'يراجع الأسئلة الشرعية بنفسه؛ ولا تُعد مسودات Gemini فتوى أو ردًا معتمدًا.'
      ],
      bioPlaceholder: 'نبذة عن الشيخ تُضاف قريبًا بعد اعتمادها.',
      topics: [
        'مصطلح الحديث',
        'الفقه وأصوله',
        'السيرة',
        'العقيدة',
        'صحيح الإمام مسلم',
        'عظماء الإسلام',
        'منوعات ومقتطفات'
      ]
    },
    schedule: {
      days: 'السبت إلى الخميس',
      times: '7:00 و10:00 مساءً',
      friday: 'الجمعة: لا دروس',
      note: 'المواعيد كما هي مثبتة في جدول التطبيق الحالي.'
    },
    links: {
      youtube: { label: 'يوتيوب', url: 'https://www.youtube.com/@khaled_najm' },
      tiktok: { label: 'تيك توك', url: 'https://www.tiktok.com/@d.khaled.4' },
      telegramChannel: { label: 'قناة تيليجرام', url: 'https://t.me/khaled_najm1' },
      telegramGroup: { label: 'مجموعة المجلس', url: 'https://t.me/+H-Rpxhc371VhYzU0' },
      recordings: { label: 'التسجيلات', url: 'https://t.me/recrdings' },
      quranRadio: { label: 'إذاعة القرآن الكريم — مصر', url: 'https://misrquran.gov.eg/' },
      saudiRadio: { label: 'إذاعة القرآن الكريم — السعودية', url: 'https://radioplus.sba.sa/ar/live/4' }
    },
    live: {
      /* اكتشاف البث متوقف حاليًا بقرار المنتج. يُحفظ المسار للتفعيل المستقبلي فقط.
         لا تُرسل الواجهة أي طلب حتى يصبح autoDetect=true صراحةً. */
      state: 'offline',
      verified: false,
      url: '',
      platform: 'يوتيوب',
      title: 'البث المباشر',
      autoDetect: false,
      apiPath: '/api/live',
      apiFallbackUrl: '',
      refreshMs: 120000,
      offlineMessage: 'اكتشاف البث المباشر تلقائيًا غير مفعّل حاليًا؛ تابع قناة الدكتور لمعرفة موعد البث.',
      note: 'تم ربط قناة الشيخ خالد نجم حارس السنة. رابط القناة متاح للمتابعة؛ اكتشاف البث التلقائي اختياري وسيُفعّل لاحقًا عند توفير إعداداته.',
      checkingLabel: 'جارٍ التحقق من حالة البث…',
      errorLabel: 'تعذّر التحقق من البث الآن. ستتم إعادة المحاولة تلقائيًا.'
    },
    forum: {
      status: 'telegram-group',
      label: 'انضم إلى مجتمع المجلس',
      message: 'يسعدنا انضمامك إلى مجموعة المجلس على تيليجرام للمشاركة في الحوار والتواصل مع أعضاء المجتمع.',
      note: 'اضغط للانضمام إلى مجموعة المجلس عبر الرابط الرسمي.'
    },
    consultation: {
      note: 'الأسئلة الشرعية يراجعها الشيخ خالد وحده. المسودة الآلية للمراجعة فقط وليست فتوى.'
    },
    library: {
      note: 'المواد المنشورة داخل التطبيق تمر باعتماد المشرف. وتسجيلات تيليجرام رابط رسمي.'
    },
    recitations: {
      note: 'روابط رسمية فقط. لا نضيف ملفات صوتية أو روابط بث غير موثّقة.'
    },
    support: {
      method: 'فودافون كاش',
      number: '01020744923',
      note: 'تأكد من الرقم قبل التحويل واحتفظ بإيصال التحويل.'
    }
  };

  window.AHL_ISTIRAHA = content;

  if (typeof window.CustomEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('istiraha:content', { detail: content }));
    } catch (error) {
      /* لا نعطّل الصفحة إذا فشل حدث المتصفح. */
    }
  }
})();
