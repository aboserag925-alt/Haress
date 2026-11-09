# استراحة أهل الأثر

موقع ثابت ونماذج لشاشات التطبيق:

- `index.html`: الصفحة التعريفية.
- `app/`: تطبيق الويب التقدمي.
- `screens/`: نماذج الشاشات الرئيسية والجدول والأرشيف وصفحة القسم.
- `assets/logo.jpg`: شعار المجلس.

## النشر على GitHub Pages

يُنشر الموقع والتطبيق الثابتان تلقائيًا عبر `.github/workflows/pages.yml` عند الدفع إلى فرع `main` أو يدويًا من تبويب Actions. من إعدادات المستودع، اختر **Settings → Pages → Build and deployment → Source → GitHub Actions**. بعد نجاح سير العمل سيكون الموقع على `https://aboserag925-alt.github.io/Haress/`.

ينشئ سير العمل صفحة `404.html` من الصفحة الرئيسية، ويبني موارد التطبيق ويتحقق من وجود الملفات المطلوبة قبل رفعها إلى Pages. عند غياب `AHL_API_BASE_URL` تبقى الصفحات الثابتة متاحة دون إرسال طلبات إلى API غير مهيأ.

GitHub Pages لا يشغّل خادم Node.js؛ لذلك تحتاج الأسئلة ومكتبة ملفات Telegram إلى خادم HTTPS عام مستقل. بعد نشر الخادم أضف متغير المستودع `AHL_API_BASE_URL` من **Settings → Secrets and variables → Actions → Variables**، بقيمة أصل الخادم فقط مثل `https://api.example.com`، ثم أعد تشغيل سير عمل Pages. لتمكين المصادقة ولوحة الإدارة أضف أيضًا متغيري `SUPABASE_URL` و`SUPABASE_ANON_KEY` العامين في المكان نفسه؛ يحقن سير العمل المفتاح العام فقط في ملفات التطبيق. اضبط `ALLOWED_ORIGINS` في الخادم ليشمل أصل GitHub Pages `https://aboserag925-alt.github.io` (وأي نطاق مخصص تستخدمه). تبقى مفاتيح Gemini وTelegram وملفات المكتبة على الخادم ولا تُرفع إلى Pages.

إن لم تضبط `AHL_API_BASE_URL` فستُنشر الواجهة وحدها، وستبقى ميزات API غير متاحة حتى ربط الخادم. لن يتم نشر ملف `.env` أو مجلد `storage/`.

## مسارات النشر (حالة معمارية)

- **GitHub Pages:** `.github/workflows/pages.yml` ينشر الواجهة الثابتة عند الدفع إلى `main` (يتطلب إعداد Source = GitHub Actions ومتغيرات البناء العامة عند الحاجة).
- **Cloudflare Workers (أصول ثابتة):** الإعداد الموثوق في المستودع هو `wrangler.jsonc` فقط (`assets.directory = ./app`). يوجد مساران محتملان للنشر: تكامل **Cloudflare Workers Builds/Git** (إن كان مفعّلًا في حساب Cloudflare)، ومسار **GitHub Actions** عبر `.github/workflows/cloudflare-worker.yml` الذي ينشر عند الدفع إلى `main` بعد الاختبارات ويتطلب أسرار GitHub صالحة (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) بصلاحيات نشر العامل `hares`. يعتمد المسار الفعّال على إعدادات Cloudflare/GitHub الخارجية.
- **خادم Node.js/API:** `server/index.js` وواجهات `/api/*` (الأسئلة، المكتبة، الإدارة، الاقتراحات، إلخ) تعمل كخادم Node منفصل؛ نشر الأصول الثابتة وحده لا يشغّل هذه الواجهات. جاهزية الواجهة الأمامية لا تعني جاهزية الخلفية للإنتاج دون استضافة/تهيئة خلفية موثوقة.

## تطوير CSS

يستخدم المشروع Tailwind CSS 4. بعد تثبيت Node.js، ثبّت اعتماديات التطوير:

```powershell
npm.cmd install
```

ابنِ ملفات التطبيق (CSS ومكتبة مواقيت الصلاة والمصادقة المحلية) بعد تثبيت الاعتماديات:

```powershell
npm.cmd run build:app
```

يستخدم التطبيق مكتبة Adhan مفتوحة المصدر (MIT) لحساب مواقيت الصلاة واتجاه القبلة. مواقيت الصلاة تستخدم المنطقة الزمنية في الجهاز، ويمكن اختيار طريقة الحساب والمذهب لحساب العصر من قسم «الصلاة». يطلب التطبيق الموقع فقط عند الضغط على زر تحديد الموقع، ويحفظ الإحداثيات على الجهاز ولا يزامنها مع الحساب.

أضف رابط HTTPS مباشرًا لتسجيل أذان مرخّص تملك حق استخدامه من قسم «الصلاة». لا يتضمن المشروع تسجيلًا صوتيًا. تشغيل الأذان تلقائيًا بعد إغلاق التطبيق غير متاح في تطبيق الويب الثابت.

قسم الأذكار يحفظ عدّاد الصباح والمساء على الجهاز حتى نهاية اليوم المحلي.

زر «ادعم تطوير المنصة» البارز يظهر أسفل أيقونات التواصل ويفتح تفاصيل محافظ فودافون كاش واتصالات كاش عند الطلب. أرقام المحافظ غير مُضافة بعد؛ أضف بيانات صحيحة قبل النشر.

## الخادم الخلفي والأسئلة

يخدم خادم Node.js صفحات الموقع وواجهة `/api/questions`. بعد موافقة المستخدم، يرسل السؤال إلى Gemini لإنشاء مسودة عربية للمراجعة، ثم يرسل السؤال والمسودة إلى وجهة Telegram المحددة. المسودة ليست فتوى معتمدة؛ يراجع الدكتور خالد الإجابات الشرعية.

1. أضف مفاتيح Gemini وTelegram إلى `.env` المحلي في `GEMINI_API_KEY` و`TELEGRAM_BOT_TOKEN`، وضع معرّف وجهتك في `TELEGRAM_CHAT_ID`. يستخدم `GEMINI_MODEL=gemini-3.8-flash` افتراضيًا ويمكن تغييره.
2. أضف بوت Telegram إلى المجموعة/القناة المستهدفة، وامنحه صلاحية إرسال الرسائل. لا تشارك التوكن أو ملف `.env`.
3. شغّل الخادم والتطبيق محليًا عبر `npm.cmd start` ثم افتح `http://localhost:8080/`. لا تستخدم `python -m http.server` لميزة الأسئلة؛ خادم الملفات البسيط لا يوفر واجهة API.
4. أو شغّل `docker compose up --build`؛ يمرر Compose متغيرات `.env` إلى الحاوية دون نسخ الملف إلى صورة Docker.

يعمل الخادم محليًا على `127.0.0.1` افتراضيًا. للتشغيل على مضيف آخر، حدّد `HOST` و`PORT` في بيئة الخادم؛ يضبط Docker المضيف على `0.0.0.0` داخل الحاوية. يحد الخادم طول السؤال وحجم الطلب، ويقصر المعدل على 5 أسئلة لكل عنوان IP خلال 15 دقيقة، ويطبق CORS بقائمة أصول مسموحة على واجهات API ومكتبة الملفات، ويتحقق من مصدر الطلب قبل المعالجة. حد المعدل داخل الذاكرة ومناسب للتطوير أو لحمل محدود، وليس حماية كافية وحده لنشر عام مدفوع؛ أضف مصادقة أو CAPTCHA وتحديدًا مركزيًا للمعدل عند نشره للعامة. لا يثق الخادم بعناوين IP الواردة من `X-Forwarded-For`. إذا كنت خلف وكيل عكسي، اضبط تحديد المعدل عند الوكيل، ويمكن تحديد المصادر المسموحة عبر `ALLOWED_ORIGINS` (قائمة أصول مفصولة بفواصل).

ملف `.env` مستثنى من Git وDocker. لا تضع المفاتيح في ملفات `app/` أو JavaScript الواجهة. يلزم اتصال إنترنت ومفاتيح صحيحة؛ وتظل بقية ميزات التطبيق قابلة للاستخدام إذا لم تُضبط مفاتيح الخدمات.

## مكتبة ملفات Telegram

يمكن للبوت استقبال الملفات المنشورة **بعد تفعيل الميزة** في مجموعة واحدة، وحفظها محليًا للمراجعة قبل إظهارها في مكتبة التطبيق. أضف إلى `.env`:

```env
TELEGRAM_MEDIA_ENABLED=true
TELEGRAM_MEDIA_GROUP_ID=-100...
```

استخدم معرّف المجموعة التي ستُنشر فيها الملفات. إن كانت هي نفسها وجهة `TELEGRAM_CHAT_ID` يمكن ترك `TELEGRAM_MEDIA_GROUP_ID` فارغًا. أضف البوت إلى المجموعة كمشرف كي يستقبل منشورات الملفات ويتحقق من صلاحيات المعتمدين. يرسل البوت أزرار اعتماد/رفض؛ لا يستطيع اعتماد الملفات إلا مشرفو المجموعة. يُحدد التصنيف مبدئيًا من نوع الملف، ويمكن تغييره بإضافة وسم مثل `#صوتيات` أو `#فيديو` أو `#كتب` أو `#صور` إلى التعليق. يُستخدم نص التعليق عنوانًا للمادة. بعد النشر يمكن لمشرف حذف المادة من المجموعة بالأمر `/media-remove <معرّف-المادة>`.

تُقبل ملفات الصوت والفيديو والصور وPDF وEPUB وTXT حتى 20 ميجابايت للملف، مع حد 500 مادة معلّقة أو منشورة. تحفظ الملفات في مجلد `storage/` محليًا، وتُحفظ بياناتها في `storage/media-index.json`؛ وفي Docker يستخدم المشروع وحدة التخزين الدائمة `media_storage`. لا تضع ملفات التخزين تحت Git أو داخل مجلد الواجهة. الملفات المعتمدة تكون متاحة لزوار المنصة، لذلك لا ترفع محتوى خاصًا أو غير مرخّص.

تعمل المتابعة عبر Telegram `getUpdates`؛ لا تشغّل أكثر من نسخة متابعة واحدة للتوكن نفسه، ولا تفعّلها إذا كان للبوت webhook أو مستهلك تحديثات آخر. عند تشغيلها سيستهلك البوت طابور تحديثاته، ويتجاهل التحديثات الواردة من محادثات غير المجموعة المحددة؛ لذلك لا تفعّلها إذا كان هناك تكامل آخر يعتمد على التحديثات نفسها. أعد تشغيل الخادم بعد الإعداد. لا يستطيع Bot API استيراد سجل المجموعة القديم؛ تُعالج الملفات الجديدة والتحديثات التي ما زالت معلقة للبوت فقط. اترك `TELEGRAM_MEDIA_ENABLED=false` إن لم ترد تشغيل استقبال الملفات.

## إعداد حسابات المستخدمين ومزامنتها

يتطلب تسجيل البريد وكلمة المرور مشروع Supabase؛ لا يعمل تسجيل الدخول قبل إعداد بيانات المشروع:

1. أنشئ مشروعًا في Supabase، واترك تأكيد البريد الإلكتروني مفعّلًا.
2. نفّذ `supabase/schema.sql` في SQL Editor داخل مشروع Supabase. سيُنشئ جدول المزامنة مع سياسات RLS التي تمنع كل مستخدم من قراءة بيانات غيره.
3. أضف `SUPABASE_URL` و`SUPABASE_ANON_KEY` إلى متغيرات GitHub Actions العامة لإعداد Pages، أو عرّفهما في بيئة البناء المحلية. ينشئ `build:app` إعداد المتصفح منهما. لا تستخدم `service_role` أو أي مفتاح سري في المتصفح.
4. اضبط إعدادات Supabase Auth → URL Configuration كما يلي: **Site URL** = `https://aboserag925-alt.github.io/Haress/`، وأضف إلى **Redirect URLs** النمط `https://aboserag925-alt.github.io/Haress/**` للسماح بالعودة إلى صفحات الموقع ومساراته. ثم نفّذ `npm.cmd run build:app` عند البناء المحلي أو أعد تشغيل سير عمل Pages.

تُحفظ جلسة الدخول باستعمال Supabase Auth، وتُزامَن طريقة حساب الصلاة ومذهب العصر وتقدم الأذكار اليومي. إحداثيات الموقع لا تغادر الجهاز. يبقى استخدام الصلاة والقبلة والأذكار متاحًا دون حساب.

أثناء التطوير، شغّل مراقبة ملفات HTML وإعادة بناء CSS عند كل تغيير:

```powershell
npm.cmd run dev:css
```

لتجهيز CSS مرة واحدة قبل النشر:

```powershell
npm.cmd run build:css
```

ملف Tailwind الناتج هو `app/tailwind.css`، ويُستخدم في الصفحة الرئيسية والتطبيق ونماذج الشاشات. استُبعدت قواعد Preflight للحفاظ على تنسيقات الصفحات الحالية.

## Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

أضف قيم الخادم المطلوبة إلى `.env` قبل تشغيل الخدمة.

يبني Docker موارد الواجهة قبل إنشاء الصورة، ويفتح الموقع والتطبيق والخادم الخلفي على `http://localhost:8080/`. يمرر Compose `SUPABASE_URL` و`SUPABASE_ANON_KEY` العامين للبناء، بينما تبقى المفاتيح السرية في إعدادات تشغيل الخادم فقط. لتغيير منفذ المضيف استخدم `HOST_PORT`؛ تبقى واجهة الحاوية على المنفذ 8080.

تطبيق الويب التقدمي في `app/` يدعم التثبيت من Safari عبر «إضافة إلى الشاشة الرئيسية»، ويضم أيقونة PNG مخصصة لـ iOS وبيانات manifest وService Worker. هذا لا ينتج تطبيق iOS أصليًا أو ملف IPA؛ يتطلب ذلك أدوات وبيئة Apple.

## اختبارات الخادم

```powershell
npm.cmd test
```


## لوحة إدارة المحاضرات والبث

توجد لوحة المشرف في `/app/admin.html`. تعرض اللوحة إجمالي المحاضرات وعدد المنشور والمسودات، وتتيح البحث بعنوان المحاضرة أو تصنيفها وتصفية السجلات حسب حالة النشر، إلى جانب الإضافة والتعديل والحذف. لا تمنح اللوحة الصلاحية بمجرد تسجيل الدخول؛ يجب إضافة مستخدم Auth إلى جدول `public.admin_users` يدويًا من SQL Editor. نفّذ تحديث `supabase/schema.sql` في مشروع Supabase، ثم أنشئ حساب المشرف بالبريد الإلكتروني وأضف معرّفه عبر:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'admin@example.com';
```

اضبط متغيرات البيئة على خادم Node.js: `SUPABASE_URL` و`SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY`. مفتاح `service_role` سري ولا يوضع في المتصفح أو GitHub Pages أو ملفات المشروع. أضف أصل الموقع إلى `ALLOWED_ORIGINS`. إذا كان الخادم على نطاق منفصل عن GitHub Pages، اضبط `AHL_API_BASE_URL` في إعدادات بناء Pages على أصل الخادم، وأعد تشغيل النشر. يحتاج بناء واجهة المصادقة إلى `SUPABASE_URL` و`SUPABASE_ANON_KEY` العامين؛ ينشئ `build:app` ملف إعداد المتصفح منهما، ولا يضمّن مفتاح `service_role`.

تسمح واجهة القراءة العامة بعرض المحاضرات المنشورة فقط. إنشاء المحاضرات وتعديلها وحذفها يتطلبان جلسة Supabase صالحة ووجود المستخدم في `admin_users`؛ يتحقق الخادم من الاثنين في كل طلب. روابط البث والتسجيل تقبل HTTPS فقط. لا تعتبر اللوحة جاهزة للإنتاج قبل إضافة مفاتيح الخادم، وتسجيل مشرف موثوق، واختبار النشر على بيئة فعلية.

## التشغيل المحلي

```powershell
npm.cmd install
npm.cmd run build:app
npm.cmd start
# ثم افتح http://localhost:8080/
```

- خادم التطوير يخدم الواجهة + `/api/*` محليًا.
- نقطة `/api/live` المحلية ترجع `{"live":false,"videoId":null}` آمنًا عند غياب مفاتيح يوتيوب.

## البث المباشر (Cloudflare Worker)

الواجهة لا تحتوي مفتاح يوتيوب أبدًا. الحالة تأتي من `/api/live`:

- **Worker كامل:** `worker/index.mjs` + `worker/live.mjs` — يقرأ `YOUTUBE_API_KEY` و`YOUTUBE_CHANNEL_ID` من بيئة Worker فقط، ويعيد `{ live, videoId }`، ويلتحقق من معرّف الفيديو، ويخزّن النتيجة 5 دقائق (`Cache-Control: public, max-age=300`).
- **إعداد:** في Cloudflare Dashboard → Workers & Pages → `hares` → Settings → Variables أضف `YOUTUBE_API_KEY` و`YOUTUBE_CHANNEL_ID` (سرّي). لا يتوفر هذان المتغيران في GitHub؛ أضفهما من لوحة Cloudflare فقط.
- **مناطق التحقق:** الأيقونة الحمراء تظهر فقط عند `live=true` ومعرّف صالح؛ عند الفشل تعرض الواجهة «غير مباشر» وتعيد المحاولة كل دقيقتين.
- **نشر:** `wrangler.jsonc` مهيأ بـ `main: worker/index.mjs` و`ASSETS` للأصول؛ `.github/workflows/cloudflare-worker.yml` ينشر تلقائيًا بعد الاختبارات. معاينة PR عبر `wrangler deploy --dry-run` أو Workers Builds.

## إعدادات موجودة (أسماء ثابتة لا تغيّر)

| المتغير | الخدمة | المصدر | يعمل؟ |
|---|---|---|---|
| `SUPABASE_URL` | Supabase | GitHub Variable | نعم |
| `SUPABASE_ANON_KEY` (عام) | Supabase | GitHub Variable | نعم |
| `AHL_SUPABASE_URL` | Supabase | GitHub Variable | نعم |
| `AHL_API_BASE_URL` | Railway API | GitHub Variable (`https://haress-production.up.railway.app`) | نعم (أُضيف في هذه الجولة) |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | `production` Environment Secret | نعم |
| `SUPABASE_SERVICE_ROLE_KEY`، `GEMINI_API_KEY`، `TELEGRAM_BOT_TOKEN`، `TURNSTILE_SECRET` | سريّة | خادم فقط (Railway) | لا تُرفع للمشروع |
| `YOUTUBE_API_KEY` / `YOUTUBE_CHANNEL_ID` | Cloudflare Worker | لوحة Cloudflare فقط | **يجب إضافتها يدويًا** — بدونه يبقى البث offline |

لا تُنشئ ملفات `.env` جديدة ولا تُنسخ قيمًا هنا؛ استخدم الأسماء أعلاه فقط.

## قيم قابلة للتعديل (آمنة)

- المحتوى والنصوص: `app/istiraha-content.js`
- منطق الواجهة: `app/istiraha.js`
- الأنماط: `app/istiraha.css` و`app/brand-motion.css`
- SEO ومشاركة: بطاقات OG/Twitter في `index.html` و`app/index.html` والصورة `app/share-1200x630.jpg`
- الأيقونات: `app/icon.svg` و`app/icon-192.png` و`app/icon-512.png` و`app/apple-touch-icon.png`
- ترويسات الأمان: `app/_headers` (تُطبق على Cloudflare Assets فقط؛ إصدارات Worker تضبط ترويساتها بنفسها)

## الأمان والأداء

- كل روابط خارجية تحمل `rel="noopener noreferrer"`؛ إدخال المستخدم يُعرض عبر `textContent` فقط (لا XSS).
- `app/_headers` يوفر CSP وHSTS و`X-Content-Type-Options` و`Referrer-Policy` و`Permissions-Policy` و`X-Frame-Options` للأصول الثابتة.
- الصور: WebP/AVIF بأحجام + `loading="lazy"`/`decoding="async"` + أبعاد صريحة و`<picture>`؛ الخطوط `display=swap` + `preconnect`.
- التخزين المؤقت: `app/sw.js` هو `ahl-athar-v5` ويشمل الأصول الجديدة؛ وردود `/api/*` لا تُخزّن أبدًا.

## اختبارات

```powershell
npm.cmd test
node --test worker/live.test.mjs
```

## الجولة الثانية (فحص وطابور أسئلة وPWA)

### قاعدة البيانات — ترحيل آمن (لا يُطبَّق تلقائيًا)
- `supabase/migrations/20261109_ahl_safe_idempotent.sql`: نسخة آمنة idempotent من `schema.sql` (لا `DROP TABLE`/`TRUNCATE`/`DELETE`/`ALTER TYPE`) وآمنة للتشغيل المتكرر. تشمل جدول `audience_questions` الجديد (طابور أسئلة) مع RLS آمنة.
- **لا يُطبَّق من الوكيل** — راجعه ثم نفّذه يدويًا من Supabase SQL Editor (راجع «ما يحتاج تدخلاً يدويًا» في الـPR).

### الأسئلة
- النموذج: تحقق طول (5–1600)، تعقيم وسوم، حد معدل عميل (سؤال/دقيقة) + حد خادم (5/15 دقيقة) + Turnstile. الحالات: تحميل/فشل/فارغ/نجاح واضحة.
- الخادم (`server/index.js`): `sanitizeQuestion()` + إدخال best-effort إلى `audience_questions` عبر نفس `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`؛ عند غياب الجدول (`PGRST205`) يستمر الطلب دون فشل.
- Worker: حد معدل `60/دقيقة/IP` لـ`/api/live` (ذاكرة Function).

### الحالات غير المتصلة
- المحاضرات/المكتبة: عند نقص الجداول أو فراغها تعرض الواجهة «قادمة قريبًا» بأناقة بدل الانهيار، وتعمل تلقائيًا عند توفر الجداول.

### PWA
- صفحة `app/offline.html` احترافية (عربي، زر إعادة المحاولة) تُخدم عند فقدان الشبكة.
- `app/sw.js` أصبح `ahl-athar-v5` (يشمل `offline.html`). عند توفر نسخة جديدة يظهر شريط «يتوفر تحديث جديد» مع زر «تحديث الآن».

### تحقق آلي
```powershell
npm.cmd run check:secure
npm.cmd test
```

## ما يحتاج تدخلاً يدويًا (بالترتيب)
1. Cloudflare: أضف `YOUTUBE_API_KEY` و`YOUTUBE_CHANNEL_ID` في Workers → `hares` → Variables (من اللوحة فقط؛ لا قيم هنا).
2. Supabase: راجع `supabase/migrations/20261109_ahl_safe_idempotent.sql` ثم نفّذه في SQL Editor ثم تحقق من `audience_questions` و`lectures` و`user_data`.
3. انشر Worker عبر سير العمل بعد الدمج، ثم اختبر `/api/live` من `hares.aboserag925.workers.dev`.
