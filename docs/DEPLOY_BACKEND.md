# نشر الخادم الخلفي (Haress Backend)

## نظرة عامة
- الخادم: Node.js 22 (Docker).
- المنفذ: 8080.
- المتغيرات: `.env` (انسخ `.env.example`).
- الخادم لا يعمل على GitHub Pages؛ يحتاج استضافة منفصلة.

## المتغيرات المطلوبة
```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ALLOWED_ORIGINS=https://<your-site>.github.io,https://<your-domain>
TURNSTILE_ENABLED=true
TURNSTILE_SECRET_KEY=...
PROXY_SHARED_SECRET=...   # openssl rand -hex 32
QUESTIONS_DAILY_CAP=200
TRUST_PROXY=false        # true فقط خلف Cloudflare proxy
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
GEMINI_API_KEY=...
STORAGE_DIRECTORY=/srv/ahl-athar/storage
```

## الخيارات

### 1) Railway
1. New Project → Deploy from GitHub.
2. أضف المتغيرات أعلاه (Settings → Variables).
3. أضف Persistent Volume: `/srv/ahl-athar/storage`.
4. Public Domain: فعّل على المنفذ 8080.
5. `HOST=0.0.0.0`، `PORT=8080`.

### 2) Fly.io
1. `fly launch --no-deploy --copy-config` (أو Dockerfile).
2. `fly secrets set KEY=VALUE ...` لكل متغير.
3. `fly volumes create data --size 1` ثم attach إلى `/srv/ahl-athar/storage`.
4. `fly deploy`.

### 3) VPS (Docker Compose)
1. انسخ المشروع + `.env`.
2. `docker compose up -d --build`.
3. Nginx/Caddy كـ reverse proxy + HTTPS.
4. `HOST=0.0.0.0`، `PORT=8080`، `TRUST_PROXY=false` (أو true خلف Cloudflare).

## بعد النشر
- حدّث `AHL_API_BASE_URL` في GitHub Pages (Settings → Pages → Variables) إلى رابط الخادم.
- تحقق: `curl https://<your-backend>/api/health` → `{"ok":true}`.
- تحقق من CORS: أضف أصل الواجهة إلى `ALLOWED_ORIGINS`.
- Cloudflare Worker: `API_BACKEND_URL=<your-backend>`، `PROXY_SHARED_SECRET=<same>`.

## فحوصات
```bash
curl -fsS https://<your-backend>/api/health
curl -fsS https://<your-backend>/api/lectures?status=published
node scripts/smoke-check.mjs https://<your-backend> https://<your-site>.github.io
```
