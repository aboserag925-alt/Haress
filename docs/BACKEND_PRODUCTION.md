# Backend production readiness (Node server)

This repository includes a Node.js server (`server/index.js`) for `/api/*` features (health, questions, library/media, admin, suggestions/AI workflows, integrations). **Static frontend deployment (GitHub Pages / Cloudflare Workers assets from `wrangler.jsonc`) does not run this server.**

## Repository-side readiness (current)
- `HOST` / `PORT` supported (`HOST` defaults to `127.0.0.1`; set `0.0.0.0` in containers as needed).
- Health endpoint: `GET /api/health` returns `{"ok":true}` (verified locally in a safe test run).
- CORS: allowlist via `ALLOWED_ORIGINS` (comma-separated origins) or same-origin fallback; no wildcard CORS.
- Security boundaries preserved: server-side secrets only, admin authorization checks, Turnstile fail-closed behavior when enabled, Supabase service-role usage server-side only. No Supabase production data/RLS/migrations/admin_users modified by repo maintenance.
- Persistent storage: file-based `storage/` (gitignored). `STORAGE_DIRECTORY` precedence in `createMediaLibrary`/server: **1)** explicit `options.storageDirectory` (trimmed, non-blank) **2)** resolved `env.STORAGE_DIRECTORY` (trimmed, non-blank; uses `options.env` when provided, else `process.env`) **3)** historical default `<repo>/storage`. Blank/whitespace-only values are ignored (no accidental whitespace directory). Mount the persistent volume to the **actual resolved** `STORAGE_DIRECTORY` path; `media-index.json` and `media/` files are created there.
- Container: `Dockerfile` + healthcheck present; Docker build validation may be environment-dependent.

## Required environment (configure on the hosting provider; never commit values)
See `.env.example`. Typical production needs depend on enabled features:
- Core: `HOST`, `PORT`, `ALLOWED_ORIGINS` (include the real frontend origin(s)).
- Storage: `STORAGE_DIRECTORY` (optional; set to a persistent-volume mount path when Telegram/media library persistence is required).
- Supabase/admin/AI/suggestions features: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (service role server-only).
- Questions/AI/Telegram as applicable: `GEMINI_API_KEY`, `GEMINI_MODEL`, `TELEGRAM_*`, `TURNSTILE_*`.
- Proxy/trust: set `TRUST_PROXY=true` only behind a trusted Cloudflare/reverse proxy that correctly sets client IP headers.

## Frontend integration (external configuration)
- Set `AHL_API_BASE_URL` to the real backend HTTPS origin in the frontend deployment/build environment (GitHub Pages variables / hosting config as appropriate).
- Set backend `ALLOWED_ORIGINS` to the real frontend origin(s). Do not use wildcard CORS.

## External blocker (owner/hosting action required)
No authenticated backend hosting provider was available through existing tools in this session. **Single external action required:** provision a trusted Node-capable production host (container/PaaS/VM) with HTTPS, persistent storage if needed, and the required environment variables/secrets; deploy the server; then verify `GET /api/health` and safe frontend API connectivity against the real backend URL.

## Cloudflare R2 library storage
- Primary file bytes: Cloudflare R2 bucket haress-media (private, standard). Via S3-compatible API (@aws-sdk/client-s3) server-side only. No public bucket, no presigned URLs in this phase; files are served through GET /api/library/files/:id with Range support.
- Metadata: media-index.json (in STORAGE_DIRECTORY) remains the library catalog (items/status/title) for Telegram polling/offset and approval workflow. R2 stores only file bytes keyed by storedName. media-index.json is NOT a new R2 source-of-truth flag.
- Backend selects R2 when all five vars are set: R2_BUCKET, R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Otherwise falls back to local STORAGE_DIRECTORY/media.
- Upload flow: validate (size, type, limit 500) -> storage.put -> storage.head verify (size match) -> save metadata -> review. On failure: no success recorded; stored object removed.
- Delete paths (reject/remove): storage.delete. Never delete legacy Railway Volume or media-index.json location.
- Railway vars (server-only): R2_BUCKET, R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (names only, see .env.example). Restricted token: Object Read & Write scoped to haress-media only.
- Legacy Railway Volume haress-production-storage at /srv/ahl-athar/storage: UNCHANGED per migration constraint.
