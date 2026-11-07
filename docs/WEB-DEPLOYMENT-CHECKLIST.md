# دليل تجهيز ونشر منصة استراحة أهل الأثر

هذا الدليل خاص بنشر نسخة الويب فقط. لا ينشئ تطبيق Android ولا يغيّر قاعدة Supabase تلقائيًا.

## 1. ترتيب النشر

1. جهّز قاعدة Supabase ونفّذ المخطط والترحيلات حسب الترتيب أدناه.
2. انشر خادم Node.js من المستودع باستخدام Dockerfile على Render أو استضافة Docker مماثلة.
3. بعد ظهور عنوان HTTPS للخادم، أضفه إلى متغير GitHub Actions باسم `AHL_API_BASE_URL`.
4. أضف إعدادات Supabase العامة إلى GitHub Actions Variables، ثم شغّل سير عمل **Deploy GitHub Pages** بعد دمج النسخة المعتمدة إلى `main`.
5. اختبر رابط الصفحة الرئيسية ورابط التطبيق والوظائف التي تتطلب الخادم وقاعدة البيانات.

## 2. GitHub Pages Variables

أضف المتغيرات العامة التالية إلى **Settings → Secrets and variables → Actions → Variables** (أو إلى Environment المسمى `Main` إذا كانت المتغيرات مقيدة به):

| الاسم | القيمة |
|---|---|
| `SUPABASE_URL` | عنوان مشروع Supabase، مثل `https://project-ref.supabase.co` |
| `SUPABASE_ANON_KEY` | مفتاح Supabase العام anon/publishable فقط |
| `AHL_API_BASE_URL` | أصل خادم Node المنشور، HTTPS دون مسار أو شرطة أخيرة |
| `TURNSTILE_SITE_KEY` | مفتاح Cloudflare Turnstile العام، اختياري |

لا تضع `SUPABASE_SERVICE_ROLE_KEY` أو Gemini أو Grok أو Telegram في GitHub Pages Variables أو ملفات الواجهة.

## 3. خادم Node.js

أنشئ Web Service من المستودع `aboserag925-alt/Haress` باستخدام Dockerfile. يجب أن يستمع التطبيق إلى `0.0.0.0` والمنفذ الذي توفره بيئة الاستضافة. مسار فحص الصحة هو:

`/api/health`

أضف متغيرات الخادم التالية في لوحة الاستضافة:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — سر خادمي فقط.
- `ALLOWED_ORIGINS=https://aboserag925-alt.github.io`
- `GEMINI_API_KEY` — مطلوب لمسار صياغة مسودات الأسئلة.
- `GROK_API_KEY` — اختياري للنموذج الثاني.
- `TURNSTILE_SECRET_KEY` و`TURNSTILE_ENABLED=true` عند تفعيل حماية Turnstile؛ ويجب أن يطابق المفتاح العام إعداد Pages.
- `TELEGRAM_BOT_TOKEN` و`TELEGRAM_CHAT_ID` عند تفعيل البوت.
- `SITE_URL=https://aboserag925-alt.github.io/Haress/`

اترك `TELEGRAM_BOT_ENABLED=false` و`TELEGRAM_MEDIA_ENABLED=false` حتى تضبط البوت ومجموعة الملفات. لا تفعّل استقبال ملفات Telegram قبل التأكد من أن البوت لا يستخدم webhook أو مستهلك تحديثات آخر.

إذا فُعّلت مكتبة ملفات Telegram، اربط وحدة تخزين دائمة بمسار الحاوية `/srv/ahl-athar/storage` حتى لا تضيع الملفات عند إعادة إنشاء الحاوية. لا تعتمد على نظام ملفات مؤقت للتخزين الدائم.

## 4. قاعدة Supabase

في SQL Editor نفّذ أولًا `supabase/schema.sql`، ثم راجع ونفّذ ملفات الترحيل بالترتيب:

1. `202611020001_suggestions_ai.sql`
2. `202611070002_member_accounts.sql`
3. `202611070003_community_moderation.sql`
4. `202611070004_daily_visitors.sql`
5. `202611070005_ai_approval_hardening.sql`
6. `202611070006_telegram_privacy_preferences.sql`

هذه الخطوة لا تُنفذ تلقائيًا من GitHub Actions. افحص حالة قاعدة البيانات قبل التطبيق، ولا تعِد تطبيق ترحيل على قاعدة إنتاج دون مراجعة.

فعّل Google وApple من **Supabase Auth → Providers** وأدخل بيانات المزود المطلوبة. اضبط Site URL على:

`https://aboserag925-alt.github.io/Haress/`

وأضف Redirect URL:

`https://aboserag925-alt.github.io/Haress/**`

أنشئ حساب المشرف ثم أضف معرفه إلى `public.admin_users` من SQL Editor. لا تمنح صلاحية الإدارة اعتمادًا على البريد أو الواجهة وحدهما.

## 5. الروابط النهائية بعد النشر

- الصفحة الرئيسية: `https://aboserag925-alt.github.io/Haress/`
- التطبيق الكامل: `https://aboserag925-alt.github.io/Haress/app/`
- لوحة إدارة المحاضرات: `https://aboserag925-alt.github.io/Haress/app/admin.html`

لا تعتبر المنصة مكتملة تشغيليًا قبل نجاح `/api/health` من الخادم، وتسجيل الدخول، وقراءة المحاضرات، وإرسال اقتراح، وفتح المنتدى والمناظرات، وعمل لوحة المشرف، والتحقق من استقبال Telegram إذا تم تفعيله.
