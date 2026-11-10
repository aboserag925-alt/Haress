# Architecture — أهل الأثر

Status: drafting (Stage 1 = Next.js foundation, Stage 2 = data layer). This document grows with each stage.

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

- **Stage 4 only — YouTube variables:** `YOUTUBE_API_KEY` and `YOUTUBE_CHANNEL_ID` are **recorded here now, to be consumed in Stage 4 only**. The owner must create them as GitHub Actions variables/secrets on the hosting provider at the start of Stage 4. No code in Stages 1–3 reads them, and no values are set in this repository.
  - `YOUTUBE_API_KEY` — YouTube Data API key for live/lectures listing (secret; server-side or provider-injected only).
  - `YOUTUBE_CHANNEL_ID` — channel ID `UC…` of the public channel (non-secret, but treated like the rest: nothing is written into the repo).

## 4. Deployment posture

- `@opennextjs/cloudflare` is configured (`web/open-next.config.ts`, `web/wrangler.jsonc`) but **nothing is deployed from this repository** by this work. Deployment (Workers/Pages, node server) remains the owner's action.
- GitHub Actions: all Node-based workflows run Node **26 LTS** (`26.13.0`, `.nvmrc`, `engines.node`). `web/` builds in CI (`ci.yml` job `web`), including `tsc --noEmit`.
- **Termux/Android caveat:** local `next build` is attempted locally; if native tooling fails on Termux, CI is the authoritative build environment (documented in the Stage 1 PR).

## 5. Data layer plan (Stage 2 details land in this file at Stage 2)

- Unified Supabase client: `web/src/lib/supabase/` (server + browser, same variable names via `AHL_SUPABASE_URL` / `AHL_SUPABASE_ANON_KEY`).
- Migrations are **idempotent** (`create table if not exists`, `drop policy if exists`) and live under `supabase/migrations/`. They are **written, not executed** — production SQL is forbidden from repo-side work.
- Public read is restricted to published content; writes require `admin_users`. Existing RLS on already-live tables is never touched.
- `audience_questions` is not present in `supabase/schema.sql`; no Stage 2 migration touches it. If it exists in production it must be inspected (by the owner) before any future migration concerning it.
