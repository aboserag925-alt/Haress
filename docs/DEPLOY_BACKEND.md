# بنية ونشر الخادم الخلفي لمنصة حرس الحدود

## البنية المعتمدة

- **Cloudflare:** استضافة واجهة الموقع وملفاتها الثابتة، وتمرير طلبات `/api/*` عبر Worker.
- **Railway:** تشغيل خادم Node.js الخلفي على المنفذ `8080`، بما في ذلك بيئات الاختبار ومعاينات الفروع.
- **Supabase:** قاعدة البيانات والمصادقة والتخزين. يستخدم الخادم مفتاح `service_role` من جهة الخادم فقط، ولا يجوز تضمينه في ملفات الواجهة أو Git.

مسار الطلبات:

1. يحمّل الزائر الواجهة من Cloudflare.
2. يمرر Worker طلبات `/api/*` إلى عنوان `API_BACKEND_URL` على Railway.
3. يتصل خادم Railway بـ Supabase للبيانات وRPC وStorage، وبالخدمات الخارجية المفعّلة مثل Telegram وGemini.

لا تستخدم GitHub Pages أو Netlify أو Vercel أو Fly.io أو VPS كوجهات نشر لهذا المشروع.

## بيئة الاختبار الحالية

- Railway project: `haress-backend-test`.
- Environment: `testing`.
- Service: `haress-backend-test`.
- فرع المصدر: `fix/pre-launch-hardening-v2`.
- المنفذ: `8080`.
- Health check: `/api/health`.
- عنوان الخدمة الحالي: `https://haress-backend-test-testing.up.railway.app`.
- Worker preview config: `wrangler.preview.jsonc`.

يجب أن تبقى بيئة الاختبار منفصلة عن الإنتاج، وألا يشير Worker المعاينة إلى خادم Railway الإنتاجي أو مشروع Supabase الإنتاجي.

## إعداد Railway

اضبط الخدمة لتستمع على:

```env
HOST=0.0.0.0
PORT=8080
NODE_ENV=production
```

المتغيرات التي يحتاجها الخادم بحسب الوظائف المفعّلة:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=haress-media
PROXY_SHARED_SECRET=
ALLOWED_ORIGINS=
QUESTIONS_DAILY_CAP=200
TURNSTILE_SECRET_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
GEMINI_API_KEY=
STORAGE_DIRECTORY=/srv/ahl-athar/storage
```

- لا تعرض قيم المتغيرات السرية في السجلات أو مخرجات CI.
- لا تضع `SUPABASE_SERVICE_ROLE_KEY` أو `PROXY_SHARED_SECRET` في الواجهة أو المستودع.
- يجب أن تتطابق قيمة `PROXY_SHARED_SECRET` بين Worker والخادم المقابل **داخل البيئة نفسها فقط**. استخدم سرًا مستقلًا للاختبار وآخر للإنتاج.
- أضف الأصول الأساسية إلى `ALLOWED_ORIGINS`، ولا تستخدم wildcard.
- يمكن إضافة أصول معاينات مؤقتة في `ALLOWED_ORIGINS_EXTRA`؛ تُدمج هذه القائمة مع الأساسية ولا تستبدلها.
- عند تفعيل نموذج الأسئلة في الإنتاج، يلزم إعداد `TURNSTILE_SECRET_KEY` مع مفاتيح Telegram وGemini وإعدادات Supabase اللازمة.
- يستخدم تخزين الوسائط الخاص في Supabase bucket باسم `haress-media` عند توافر إعدادات Supabase. وحدة Railway المركبة على `/srv/ahl-athar/storage` تبقى متاحة للتخزين المحلي الاحتياطي/ملفات الفهرسة حسب مسار التنفيذ.

## إعداد Cloudflare Worker

يحدد ملف Wrangler الخاص بكل بيئة عنوان الخادم الخلفي:

```json
{
  "vars": {
    "API_BACKEND_URL": "https://<railway-backend-domain>"
  }
}
```

يُضبط `PROXY_SHARED_SECRET` كـ Worker Secret، وليس ضمن `vars` أو ملف Wrangler. لا تستخدم سر الاختبار في Worker الإنتاج أو العكس.

## فحوص ما قبل المعاينة

من جذر المشروع:

```bash
curl -fsS https://haress-backend-test-testing.up.railway.app/api/health
node scripts/smoke-check.mjs --backend https://haress-backend-test-testing.up.railway.app --origin https://<cloudflare-preview-origin>
npm test
npm run build:app
```

يجب استبدال `<cloudflare-preview-origin>` بأصل المعاينة الفعلي. يفحص smoke check صحة الخادم، واستجابة قائمة المحاضرات، والسماح بأصل الواجهة المحدد ورفض الأصول غير المصرح بها.

## ضوابط الإنتاج

- لا تنشر إلى بيئة الإنتاج من سير عمل معاينة PR.
- لا تدمج إلى `main` ولا تنفذ نشرًا إنتاجيًا دون موافقة صريحة ومراجعة مستقلة.
- قبل اعتماد إصدار إنتاجي، تحقق من أن Railway وSupabase المستخدمين هما بيئتا الإنتاج المعتمدتان، وأن أسرارهما مستقلة عن الاختبار.
- لا تعتبر نجاح بناء Worker وحده دليلًا على سلامة اتصال API أو Supabase؛ يجب اجتياز فحوص الخادم والواجهة والاتصال.
