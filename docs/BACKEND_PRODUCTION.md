# Backend production readiness (Node server)

This repository includes a Node.js server (`server/index.js`) for `/api/*` features (health, questions, library/media, admin, suggestions/AI workflows, integrations). **Static frontend deployment (GitHub Pages / Cloudflare Workers assets from `wrangler.jsonc`) does not run this server.**

## Repository-side readiness (current)
- `HOST` / `PORT` supported (`HOST` defaults to `127.0.0.1`; set `0.0.0.0` in containers as needed).
- Health endpoint: `GET /api/health` returns `{"ok":true}` (verified locally in a safe test run).
- CORS: allowlist via `ALLOWED_ORIGINS` (comma-separated origins) or same-origin fallback; no wildcard CORS.
- Security boundaries preserved: server-side secrets only, admin authorization checks, Turnstile fail-closed behavior when enabled, Supabase service-role usage server-side only. No Supabase production data/RLS/migrations/admin_users modified by repo maintenance.
- Persistent storage: file-based `storage/` (gitignored). Production hosting must provide persistent storage if Telegram/media library features are required.
- Container: `Dockerfile` + healthcheck present; Docker build validation may be environment-dependent.

## Required environment (configure on the hosting provider; never commit values)
See `.env.example`. Typical production needs depend on enabled features:
- Core: `HOST`, `PORT`, `ALLOWED_ORIGINS` (include the real frontend origin(s)).
- Supabase/admin/AI/suggestions features: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (service role server-only).
- Questions/AI/Telegram as applicable: `GEMINI_API_KEY`, `GEMINI_MODEL`, `TELEGRAM_*`, `TURNSTILE_*`.
- Proxy/trust: set `TRUST_PROXY=true` only behind a trusted Cloudflare/reverse proxy that correctly sets client IP headers.

## Frontend integration (external configuration)
- Set `AHL_API_BASE_URL` to the real backend HTTPS origin in the frontend deployment/build environment (GitHub Pages variables / hosting config as appropriate).
- Set backend `ALLOWED_ORIGINS` to the real frontend origin(s). Do not use wildcard CORS.

## External blocker (owner/hosting action required)
No authenticated backend hosting provider was available through existing tools in this session. **Single external action required:** provision a trusted Node-capable production host (container/PaaS/VM) with HTTPS, persistent storage if needed, and the required environment variables/secrets; deploy the server; then verify `GET /api/health` and safe frontend API connectivity against the real backend URL.
