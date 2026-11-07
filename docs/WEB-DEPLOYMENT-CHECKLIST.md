# دليل نشر منصة استراحة أهل الأثر على Cloudflare

هذا الإعداد يجعل Cloudflare Workers نقطة الدخول العامة للموقع، ويقدم الملفات الثابتة ويوجه طلبات API إلى خادم Node.js منفصل. خادم Node الحالي يعتمد على `node:http` ونظام الملفات وتخزين Telegram؛ لذلك لا يُشغّل مباشرة داخل Worker بصيغته الحالية.

## 1. بنية النشر

- Cloudflare Worker: `cloudflare/worker.mjs`، يستقبل طلبات `/api/*` ويمررها إلى خادم Node عبر HTTPS.
- Static Assets: ينتجها `npm run build:cloudflare` داخل `dist/` وتشمل الصفحة التعريفية والتطبيق وملفات assets وscreens.
- Node.js backend: يستضيفه مزود يدعم Docker/Node.js، مع الاحتفاظ بالخدمات الحالية والتخزين الدائم عند الحاجة.

## 2. ربط Cloudflare بالمستودع

في Workers & Pages أنشئ/افتح Worker باسم `hares` واربط مستودع `aboserag925-alt/Haress` بفرع النشر المعتمد بعد الموافقة على PR.

إعدادات البناء:
- Build command: `npm ci && npm run build:cloudflare`
- Deploy command: `npx wrangler deploy`
- Root directory: جذر المستودع
- Node.js: الإصدار 22

يعتمد المشروع ملف `wrangler.toml` واحدًا. لا تُنشئ إعدادًا موازيًا باسم `wrangler.jsonc`.

## 3. متغير Worker

في Worker → Settings → Variables and Secrets أضف:

| الاسم | النوع | القيمة |
|---|---|---|
| `AHL_API_BASE_URL` | Variable | أصل خادم Node المنشور، مثل `https://api.example.com` |

يجب أن يكون العنوان HTTPS فقط، دون مسار أو شرطة أخيرة. لا تضع مفاتيح Supabase أو Gemini أو Telegram في هذا المتغير.

عند عدم ضبطه، يعيد Worker استجابة 503 واضحة لطلبات API بدلًا من الادعاء بأن الخادم متاح.

## 4. خادم Node.js ومتغيراته السرية

شغّل الخادم الحالي باستخدام Dockerfile على مزود Node/Docker. يجب أن يستمع إلى `0.0.0.0` والمنفذ الذي توفره الاستضافة، وأن ينجح المسار `/api/health`.

متغيرات الخادم (تُضبط في مزود الخادم فقط):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — سر خادمي فقط.
- `GEMINI_API_KEY`
- `GROK_API_KEY` — اختياري.
- `TELEGRAM_BOT_TOKEN` و`TELEGRAM_CHAT_ID` عند تفعيل Telegram.
- `TURNSTILE_SECRET_KEY` عند تفعيل Turnstile.
- `ALLOWED_ORIGINS=https://hares.aboserag925.workers.dev`

أضف أصل معاينة Workers مؤقتًا إلى `ALLOWED_ORIGINS` فقط إذا كنت تختبر API من تلك المعاينة. لا تستخدم wildcard لمصادر CORS. احتفظ بتخزين دائم لمسار `/srv/ahl-athar/storage` إذا فُعّلت ملفات Telegram.

## 5. إعداد Supabase

إعدادات الواجهة العامة فقط:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

تُمرر إلى أمر البناء في بيئة Cloudflare كمتغيرات بناء عامة؛ لا تستخدم مفتاح service role في البناء أو الواجهة.

لا تنفذ migrations على قاعدة الإنتاج من هذا الدليل. راجع أولًا `supabase/schema.sql` ثم migrations بالترتيب الموثق في هذا الملف سابقًا، وتحقق من الحالة الحالية للقاعدة قبل أي تغيير. حافظ على RLS وسياسات `admin_users`.

## 6. التحقق بعد النشر

1. افتح `https://hares.aboserag925.workers.dev/` و`/app/`.
2. اختبر `/api/health`؛ يجب أن تأتي الاستجابة من خادم Node عبر Worker.
3. اختبر تسجيل الدخول وقراءة المحاضرات والمنتدى وصلاحيات الإدارة.
4. اختبر الاقتراحات وTelegram فقط بعد إعداد أسرارهما على خادم Node.
5. راجع Cloudflare Worker Logs وخادم Node logs لأي 5xx.

لا تعتبر المنصة مكتملة تشغيليًا قبل نجاح هذه الاختبارات. هذا التغيير لا ينشر Worker تلقائيًا ولا يعدل إعدادات حساب Cloudflare أو قاعدة Supabase.
