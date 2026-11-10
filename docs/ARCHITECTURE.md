# معمارية منصة استراحة أهل الأثر (ARCHITECTURE)

هذه الوثيقة مرجع البناء: الواجهة الثابتة، الخادم الديناميكي، وتكامل Supabase، بالإضافة إلى متغيرات التشغيل وإجراءات المالك.

## 1. نظرة عامة

| المكوّن | الموقع | الاستضافة | ملاحظات |
|---|---|---|---|
| الواجهة الثابتة | `index.html`، `app/`، `assets/`، `screens/` | GitHub Pages (`.github/workflows/pages.yml`) أو أصول Cloudflare Workers (`wrangler.jsonc`) | لا تشغّل أي خادم Node |
| الخادم الديناميكي | `server/index.js` | استضافة Node.js/Docker (Railway-like) | يخدم `/api/*` فقط (health, questions, library/media, admin, suggestions/AI) |
| المصادقة والبيانات | `app/auth-client.js` ← يُبنى من `src/auth-client.js` عبر `npm run build:auth` | Supabase (browser-side فقط بالـ anon key) | مفتاح `service_role` يبقى على الخادم فقط |
| التخزين المحلي للخادم | `storage/` (gitignored) | وحدة تخزين دائمة | `STORAGE_DIRECTORY` (انظر docs/BACKEND_PRODUCTION.md) |

## 2. متغير `AHL_API_BASE_URL`

### مصدر القيمة في المستودع

القيمة الحالية مصدرها **`app/runtime-config.js`** (والنظير في جذر المستودع `runtime-config.js`)، وكلاهما ملتزَم في Git بقيمة فارغة:

```js
window.AHL_API_BASE_URL = '';
```

هذان الملفان هما نقطة القراءة الوحيدة وقت التشغيل، ويستهلكها:

- `index.html` (المكتبة والبث) — سطر `typeof window.AHL_API_BASE_URL === 'string' ? …replace(/\/+$/,'') : ''`
- `app/app.js` (بناء روابط `/api/lectures` وغيرها)
- `app/admin.html` (لوحة الإدارة: `window.AHL_API_BASE_URL || ''`)

عند بقاء القيمة فارغة تظل الصفحات الثابتة منشورة دون إرسال أي طلبات إلى API غير مهيأ (سلوك مقصود).

### مكان الإعداد الفعلي في الإنتاج

لا تُضع القيمة في Git. الإنتاج يُعدّ في **متغيرات مستودع GitHub Actions**:
**Settings → Secrets and variables → Actions → Variables ← `AHL_API_BASE_URL`**

- سير عمل Pages (`.github/workflows/pages.yml`) يقرأ `vars.AHL_API_BASE_URL` ثم يكتب القيمة وقت البناء في `_site/runtime-config.js` و`_site/app/runtime-config.js`.
- سير عمل Android (`.github/workflows/android-build.yml`) يقرأ المتغير نفسه ويحقنه في `app/runtime-config.js` أثناء البناء.
- التحقق داخل الـ workflow: يجب أن تكون القيمة أصلًا HTTPS خاليًا من أي مسار أو `/` زائدة، وإلا يفشل البناء.
- على الخادم يجب ضبط `ALLOWED_ORIGINS` ليشمل أصل الواجهة بدقة (مثل `https://aboserag925-alt.github.io` وأي نطاق مخصص) — لا CORS بـ wildcard.

### الجدول الزمني للإعداد

1. نشر الخادم على استضافة HTTPS موثوقة (انظر قائمة التحقق في docs/BACKEND_PRODUCTION.md).
2. التحقق العام: `GET https://<الخادم-الحقيقي>/api/health` يعيد `200 {"ok":true}`.
3. ضبط متغير المستودع `AHL_API_BASE_URL` ثم إعادة تشغيل سير عمل Pages/Android.

## 3. OWNER ACTIONS (إجراءات لا ينفّذها الوكيل)

### Stage 4 فقط — تكامل YouTube

متغيّرات بيئة على استضافة الخادم (secrets) — **لا تُوضع أبدًا في Git ولا في نشر GitHub Pages**، ولا تُفعَّل قبل المرحلة المتفق عليها:

| المتغير | الوصف | أين يُعدّ | متى |
|---|---|---|---|
| `YOUTUBE_API_KEY` | مفتاح YouTube Data API v3 (سر) | إعدادات بيئة استضافة الخادم فقط | Stage 4 |
| `YOUTUBE_CHANNEL_ID` | معرّف القناة (عام لكن لا معنى له قبل الـ API key) | إعدادات بيئة استضافة الخادم فقط | Stage 4 |

قاعدة صريحة: أي Stage آخر (0–3، 5، 6) **لا** يقرأ أو يشير إلى هذين المتغيّرين. في `.env.example` أُضيفا كسطرَين فارغَين تحت تعليق `OWNER ACTION — Stage 4`. يتحقّق `npm run check:secure` (Stage 0) آليًا من عدم وجود قيم سرية في الملفات المرفوعة إلى Git.

## 4. سلسلة البناء والأدوات (toolchain pinning)

- `tailwindcss` و`@tailwindcss/cli` مثبّتان بإصدار مضبوط **بدون `^`** (انظر `package.json`) لمنع انحراف الأداة (tool drift) بين بناء بهذا الجهاز وآخر.
- `app/tailwind.css` و`app/auth-client.js` و`app/vendor/` **ملفات مُولَّدة للبناء**؛ CI يعيد توليدها عبر `npm run build:app` ولا يلزم التزامها يدويًا في كل PR.
- للأثريات الملتزَمة في Git (إن وُجدت) تجري نفس قاعدة المراجعة: لا تُدخل في PR إلا إذا كان التغيير مقصودًا ومبررًا.

## 5. الجدول العام للمراحل (ROADMAP)

| المرحلة | النطاق |
|---|---|
| Stage 0 | تدقيق وإصلاح المنصة + تثبيت الأدوات + وثيقة المعمارية + check:secure |
| Stage 1–2 | (تُستكمل وفق خطة المالك) |
| Stage 4 | تكامل YouTube (OWNER ACTIONS أعلاه) |
| Stage 7 | تحويل `assets/logo.jpg` إلى WebP (مُؤجَّل عمدًا؛ لا تُعدَّل ملفات الشعار قبلها) |

> تفاصيل المراحل 1–3 تعود لخطة المالك؛ كل فرع/PR يُنفّذ في مرحلته المستقلة بعد الموافقة.
