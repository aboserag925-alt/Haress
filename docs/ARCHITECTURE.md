# Architecture — أهل الأثر

Status: drafting (Stage 1 = Next.js foundation, Stage 2 = data layer, Stage 3 = auth/admin, Stage 4 = live). This document grows with each stage.

## 1. Systems overview

| System | Location | Notes |
| --- | --- | --- |
| Legacy static site (Do **not** remove) | `app/`, `index.html`, `400.html`, `_site/` | GitHub Pages static app, PWA v2 (`ahl-athar-v2` cache). Served as-is. |
| Node backend | `server/` | `/api/*` (health, questions, library, admin, suggestions/AI). Deployed separately by the owner; frontend reaches it via `AHL_API_BASE_URL`. |
| Next.js web app (new, Stage 1+) | `web/` | App Router + Tailwind 4 + RTL + Tajawal. Deployed via `@opennextjs/cloudflare` config prepared, **not deployed in Stage 1**. |
| Supabase | `supabase/schema.sql` + `supabase/migrations/` | Stage 2 adds idempotent migrations. **No production SQL is ever executed from this repo.** |

## 2. Palette & identity (Stage 1)

- Background: `#050505`
- Gold accent: `#c49a54`
- Font: **Tajawal**, loaded as a runtime Google Fonts stylesheet (same approach the legacy site uses for Arabic fonts). Chosen over `next/font/google` so local/regional builds do not require build-time network access. RTL is set at `<html dir="rtl" lang="ar">`.
- Components: `Navbar`, `Hero`, `SectionCard`, `Footer`, `LiveButton`.
- The live button is **always visible** (red), fixed to the viewport, linking to the live area.
- The doctor's photo (existing brand asset `assets/logo.jpg`) is framed with an **arch-shaped border**, copied to `web/public/images/logo.jpg` (original untouched).
- Legacy anchors are preserved on the new homepage (`#about`, `#media`, `#q`, `#prayers`, `#adhkar`, `#compass`…) and `/index.html` redirects to `/`. Other legacy HTML pages (e.g. `admin.html`) remain reachable on the legacy deployment; decommissioning is a later stage and is explicitly out of scope.

## 3. Environment variables

Repo code never contains secret values. Only **variable names that already exist in this repository** are referenced (the rule "أسماء المتغيرات الموجودة في main فقط").

| Variable | Where | Owner action | Purpose |
| --- | --- | --- | --- |
| `AHL_API_BASE_URL` | GitHub Actions **variable** `vars.AHL_API_BASE_URL`; injected by `.github/workflows/android-build.yml` into `app/runtime-config.js` | Set to the verified HTTPS backend origin | Base URL used by the frontend for `/api/*`. In the Next app it is read at runtime (`web/app/api/live/route.ts` forwards to `${AHL_API_BASE_URL}/api/live`); it must be set in the serving environment (e.g. Workers secret/variable) — never committed. |
| `AHL_SUPABASE_URL` | GitHub Actions variable `vars.AHL_SUPABASE_URL` | Already used by android workflow | Supabase project URL; Stage 2 uses the same name for the unified server **and** browser client (anon key, public-safe). |
| `AHL_SUPABASE_ANON_KEY` | GitHub Actions variable `vars.AHL_SUPABASE_ANON_KEY` | Already used by android workflow | Public anon key (public-safe by design); same name for both clients. |
| `SUPABASE_SERVICE_ROLE_KEY` | Hosting-provider env (server only) | Set by owner | Server-side only; never exposed to browser code. |

### OWNER ACTIONS (reserved — do **not** wire before their stage)

- **Stage 4:** live streaming via the manual operator panel (`live_state`) with a non-restricted provider flow (embed allowlist empty by design; external "watch now" button until a provider is approved). No third-party video platform API or variables are used.

## 4. Deployment posture

- `@opennextjs/cloudflare` is configured (`web/open-next.config.ts`, `web/wrangler.jsonc`) but **nothing is deployed from this repository** by this work. Deployment (Workers/Pages, node server) remains the owner's action.
- GitHub Actions: all Node-based workflows run Node **26 LTS** (`26.13.0`, `.nvmrc`, `engines.node`). `web/` builds in CI (`ci.yml` job `web`), including `tsc --noEmit`.
- **Termux/Android caveat:** local `next build` is attempted locally; if native tooling fails on Termux, CI is the authoritative build environment (documented in the Stage 1 PR).

## 5. Data layer (Stage 2)

- **Unified Supabase client** — `web/src/lib/supabase/`:
  - `config.ts` — single source of configuration parsing/fail-safe validation. The **same variable names** serve server and browser: `AHL_SUPABASE_URL` / `AHL_SUPABASE_ANON_KEY` (both already exist in the repository as GitHub Actions variables; browser copies are public-safe values injected at deploy time, exactly like the legacy `window.AHL_SUPABASE_CONFIG` flow). No value ever ships in code; the module returns `null` when unconfigured and callers fail closed.
  - `server.ts` — lazy server singleton (Node/route handlers), anon key only, same options as browser.
  - `client.ts` — lazy browser singleton (`"use client"`), same variable names.
  - `types.ts` — shared row types mirroring the migration until generated `Database` types land.
- **Migrations** — `supabase/migrations/0001_stage2_data_layer.sql`:
  - Covers `series`, `articles`, `books`, `quran_items`, `forum_threads`, `forum_posts`, `site_settings` (all `create table if not exists`, with public SELECT restricted to `status = 'published'` / `'visible'`) plus a guarded additive `lecture.series_id` link to `series`.
  - `audience_questions` was inspected first: it is absent from `supabase/schema.sql`, and the migration deliberately does not reference it (only in comments). If it exists in production, inspecting it is an owner action.
  - **No write policies for `anon`/browser `authenticated`**: public roles receive SELECT only. Admin writes flow solely through `service_role` from the Node server (which authorizes admins server-side via `admin_users`) — the repository's existing boundary ("no browser role can grant itself admin") is preserved; existing RLS on `lectures`/`admin_users`/`user_data` is untouched.
  - Idempotency is contract-tested in `web/migrations.test.js` (npm test).
- **Nothing is executed** — applying the migration to the Supabase project is an explicit owner action (SQL Editor / Supabase CLI). No repo-side code or CI job runs DDL/DML against production.

## 6. Auth & Admin (Stage 3)

- **Unified SSR client** — `web/src/lib/supabase/server.ts` now uses `@supabase/ssr` `createServerClient` with cookie-based sessions (`getAll`/`setAll` via `next/headers` cookies; httpOnly/secure/sameSite via @supabase/ssr defaults + storageKey `ahl-athar-auth`), same variable names (`AHL_SUPABASE_URL` / `AHL_SUPABASE_ANON_KEY`), fail-closed when unconfigured.
- **Admin authorization** — `web/src/middleware.ts` protects `/admin/:path*`: session via SSR client (`auth.getUser`) + admin membership via service-role lookup in `admin_users`; denies (redirect `/`) when unauthenticated or non-admin; sets `Cache-Control: private, no-cache, no-store...` on auth responses. `web/src/lib/admin-guard.ts` (`getAdminUserId` / `requireAdmin` / `AdminForbiddenError`) is the single self-verifying entry used by admin actions/pages; every admin action re-verifies itself (CSRF same-origin + admin check), never relying on middleware alone.
- **Admin actions** — `web/src/actions/admin.ts`: create/update/delete via service-role client, input sanitization via entity field descriptors (`web/src/lib/admin-entities.ts`), audit_log writes (`web/src/lib/supabase/admin-client.ts`, `supabase/migrations/0002_stage3_audit_log.sql`).
- **Auth actions** — `web/src/actions/auth.ts`: email/password sign-in & sign-up via unified SSR client, rate limits (`web/src/lib/rate-limit.ts`), unified generic error (`web/src/lib/security.ts` `GENERIC_AUTH_ERROR`); magic link intentionally deferred (not confirmed enabled in project).
- **Media upload** — `web/src/lib/storage.ts`: server-side admin upload with MIME allowlist, magic-byte check, 25MB size cap, safe filename, separate public/draft buckets (`ahl-media-public` / `ahl-media-drafts`).
- **Admin UI** — `web/app/admin/**` (overview, list, create, edit) under /admin; server components read via admin client; forms post to server actions which self-verify.

### Stage 3 OWNER ACTIONS (additions)
- Set `SUPABASE_SERVICE_ROLE_KEY` on the hosting provider (server-only; consumed by admin/storage/audit server paths).

## 7. Live & Broadcast (Stage 4)

- **Live state** — `supabase/migrations/0003_stage4_live_state.sql` (idempotent): `public.live_state` operational row (`is_live`, `stream_url`, `stream_title`, `provider`, `updated_at). RLS: public SELECT allowed; admin writes only via service_role (admin server path, authorized via `admin_users`).
- **Live reads** — `web/src/lib/live-state.ts`: `getLiveState`, `getNextBroadcast`, `providerFromStreamUrl`. Public reads go through the unified server (anon) client behind the public RLS policy.
- **Public live API** — `web/app/api/live/route.ts` keeps the legacy compatibility shape `{ live, videoId }` (`live` from `live_state`, `videoId: null`); `web/app/api/live/state/route.ts` returns `{ live, next }` with `revalidate = 30`; `web/app/api/broadcast/next/route.ts` returns `{ next }` with `revalidate = 30`.
- **Public /live page** — `web/app/live/page.tsx` + `web/src/components/LiveScreen.tsx`: status bar (`is_live`), when live → iframe 16:9 in the golden container only for an embeddable provider from the allowlist, otherwise a big external button "شاهد البث الآن" (`target="_blank"`, `rel="noopener noreferrer"`); when off → offline state with next broadcast. 60s refresh, stops on tab hide (`visibilitychange`).
- **Admin live panel** — `web/app/admin/live/page.tsx` + `web/src/actions/admin.ts` `adminSetLiveState`: admin self-verification (via `admin_users`), CSRF same-origin check, stream URL validation (https only + allowlisted domains: tiktok.com / facebook.com / t.me), writes `live_state`, writes audit_log (`admin.live_state.set`).
- **Broadcast schedule** — `supabase/migrations/0004_stage4_broadcast_schedule.sql` (idempotent): `public.broadcast_schedule` (`title`, `starts_at_utc`, `status` draft|published, optional `stream_url`). RLS: public SELECT published only; admin writes via service_role.
- **Homepage** — `web/src/components/NextBroadcast.tsx`: upcoming broadcast countdown from `/api/broadcast/next`.
- **Navbar** — `web/components/LiveButton.tsx`: always-visible red live button with pulsing dot, reads `/api/live`, links to `#live`.

### Stage 4 OWNER ACTIONS (additions)
- Apply `0003_stage4_live_state.sql` and `0004_stage4_broadcast_schedule.sql` manually (SQL Editor / Supabase CLI) — never from this repository.
- No third-party video platform variables are required or used (Stage 4 live flow uses manual operator state only).
