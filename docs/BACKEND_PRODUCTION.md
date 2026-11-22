# Backend production readiness (Node server)

This repository includes a Node.js server (`server/index.js`) for `/api/*` features (health, questions, library/media, admin, suggestions/AI workflows, integrations). **Static frontend deployment (GitHub Pages / Cloudflare Workers assets from `wrangler.jsonc`) does not run this server.**

## Repository-side readiness (current)
- **Runtime:** Node.js (`npm start` runs `node server/index.js`). Container image builds static app assets and runs the Node server (`Dockerfile`, `docker-compose.yml`).
- **HTTPS:** terminate HTTPS at the hosting provider/load balancer/proxy. The Node process serves HTTP; production traffic to users must be HTTPS.
- **Dynamic PORT:** server reads `process.env.PORT` (validated; default `8080`). `HOST` defaults `127.0.0.1`; set `HOST=0.0.0.0` in containers/hosts that require external binding. Providers that inject `PORT` (e.g. Railway-style PaaS) are supported.
- **Health check:** `GET /api/health` returns `200 {"ok":true}` (local verified). Configure the host/platform health check path to `/api/health`.
- **CORS:** allowlist via `ALLOWED_ORIGINS` (comma-separated exact origins) or same-origin fallback; **no wildcard CORS**. Set exact production frontend origin(s) only after the real backend/frontend origins are known.
- **Proxy trust:** set `TRUST_PROXY=true` only behind a trusted reverse proxy (e.g. Cloudflare/load balancer) that correctly sets client IP headers. Do not enable on direct/untrusted exposure.
- **Persistent storage:** file-based `storage/` (gitignored). `STORAGE_DIRECTORY` precedence: **1)** explicit `options.storageDirectory` (trimmed, non-blank) **2)** resolved `env.STORAGE_DIRECTORY` (trimmed, non-blank; uses `options.env` when provided, else `process.env`) **3)** historical default `<repo>/storage`. Blank/whitespace-only values are ignored. Mount the persistent volume to the **actual resolved** `STORAGE_DIRECTORY`; `media-index.json` and `media/` files are created there. Required when Telegram/media library persistence is needed.
- **Security boundaries preserved:** server-side secrets only; Supabase service-role key server-side only; admin authorization checks preserved; Turnstile fail-closed behavior when enabled; no wildcard CORS; no HTTP-controlled filesystem paths. **No Supabase production data/RLS/migrations/admin_users modified by repo maintenance.**
- **Observability/rollback (repo-side):** container logs via stdout/stderr; errors logged without secret values; Docker `HEALTHCHECK` present; host should retain logs and support rollback/redeploy of previous image/revision.

## Required environment (configure on hosting provider; never commit values)
See `.env.example`. Typical production needs depend on enabled features:
- Core: `HOST`, `PORT` (or provider-injected), `ALLOWED_ORIGINS` (exact frontend origins), `NODE_ENV=production`.
- Storage: `STORAGE_DIRECTORY` (optional; persistent-volume mount path for media/library).
- Supabase/admin/AI/suggestions: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (**service role server-only**).
- Questions/AI/Telegram as applicable: `GEMINI_API_KEY`, `GEMINI_MODEL`, `TELEGRAM_*`, `TURNSTILE_*`.
- Proxy: `TRUST_PROXY=true` only when appropriate behind trusted proxy.

## Deployment checklist (owner/host execution)
1. Choose a trusted Node/Docker host with HTTPS, env secrets, dynamic `PORT` support, health checks, logs/rollback, and persistent volume if media persistence required.
2. Build/deploy from this repo (`Dockerfile`) or run `npm ci --omit=dev` + `npm start` in a Node environment with built app assets present as expected by the server.
3. Set `HOST=0.0.0.0` (containers) and use injected `PORT` when provided.
4. Mount persistent volume to the resolved `STORAGE_DIRECTORY` path (container default storage path is `/srv/ahl-athar/storage`; set `STORAGE_DIRECTORY` if using a different mount).
5. Configure health check: `GET /api/health` expects HTTP 200.
6. Set required secrets/env vars (never in repo). Verify logs do not expose secrets.
7. Verify public `GET https://<real-backend>/api/health` returns 200.
8. Set frontend `AHL_API_BASE_URL` to the verified backend HTTPS origin and backend `ALLOWED_ORIGINS` to exact frontend origin(s); redeploy only affected components; run safe frontend↔backend/CORS/auth/admin checks.

## External blocker (current)
No authenticated backend hosting provider was available through existing tools in this session. **Single external owner action required:** provision/deploy the backend on a trusted HTTPS host with the checklist above, verify public `/api/health`, then complete `AHL_API_BASE_URL`/`ALLOWED_ORIGINS` integration. Do not invent hosting credentials or production URLs.
