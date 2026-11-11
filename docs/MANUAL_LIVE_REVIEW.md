HARESS — MANUAL LIVE IMPLEMENTATION REVIEW
============================================

Repository: aboserag925-alt/Haress
Pull request: #81 — https://github.com/aboserag925-alt/Haress/pull/81
Head branch: feat/manual-live
Base branch: feature/dr-khalid-ui (PR #75)
Base SHA: 563d2c114e0b8fad22c124d4181a80e4b5569374
Code snapshot reviewed: a62d051ffff76519c2f7b37945981f62cd4af21c (documentation-only refresh follows)
PR state at review: OPEN, NOT MERGED, mergeable=true
Changed files: 27

1. MIGRATION — REVIEW ONLY
--------------------------
File: supabase/migrations/20261111_live_state.sql

- Idempotent CREATE TABLE IF NOT EXISTS and singleton primary key id=1 with CHECK(id=1).
- Fields: is_live, stream_url, stream_title, provider, updated_at.
- RLS enabled.
- anon/authenticated: SELECT on the five public state columns only; no write grants.
- service_role: server-side table privileges only.
- Public SELECT policy uses USING (true); the CHECK(id=1) constraint and primary key enforce the single public row, avoiding any need to grant SELECT on private id.
- Seed row inserted with ON CONFLICT(id) DO NOTHING.
- broadcast_schedule is not created.
- Migration was NOT executed. No SQL was sent to Supabase.

2. NODE SERVER
--------------
Files: server/lecture-api.js, server/index.js

- GET /api/live/state reads only the public columns with the anon key.
- Server in-memory cache: 30 seconds; Cache-Control max-age=30 and s-maxage=30.
- allowed_hosts is returned as public configuration so the frontend follows LIVE_ALLOWED_HOSTS without granting access to the private singleton id.
- GET /api/live preserves the exact compatibility shape: { live: boolean, videoId: null }.
- POST /api/admin/live requires a Supabase Bearer session and a positive admin_users lookup.
- CSRF: exact Origin allowlist via ALLOWED_ORIGINS. Cross-site requests are accepted only when the Origin exactly matches an explicitly configured trusted frontend origin; without an allowlist, cross-site is rejected.
- Stream URL validation: HTTPS only, no credentials, no non-standard port, no javascript:/data:, and exact host/subdomain boundary matching against LIVE_ALLOWED_HOSTS.
- Default allowlist: tiktok.com,facebook.com,t.me. Server configuration is adjustable; the public endpoint communicates the active allowlist to the client.
- Writes use PostgREST upsert on_conflict=id with resolution=merge-duplicates and fixed id=1. No DELETE-then-INSERT path exists.
- audit_log insert is best-effort because its schema is not established in this repository. A missing/incompatible audit_log does not roll back a successful live-state update.
- No service-role value is placed in browser files. The server reads the existing server environment variable only.

3. FRONTEND AND PWA
-------------------
Files: app/index.html, app/istiraha.js, app/istiraha-content.js,
       app/live-client.js, app/live.html, app/live-admin.html,
       app/sw.js, app/_headers

- The existing app homepage live section now reads the manual live state and links to app/live.html.
- app/live.html refreshes every 60 seconds and on visibilitychange.
- Watch links are created only after HTTPS allowlist validation and use target=_blank with rel=noopener noreferrer.
- No iframe is used. This is the conservative choice because no provider embed contract was approved.
- app/live-admin.html provides sign-in, on/off, stream URL and title; the server independently verifies admin_users.
- YouTube links, automatic detection logic, Worker code and YouTube CSP frame/preconnect entries were removed from the app/site branch.
- Service Worker cache is ahl-athar-v6; new live pages are included; activation deletes older ahl-athar-* caches.
- Existing app update banner / manual activation flow remains in app/app.js.

4. REMOVED AUTOMATIC VIDEO WORKER
---------------------------------
Deleted:
- worker/live.mjs
- worker/index.mjs
- worker/live.test.mjs

wrangler.jsonc now serves ./app as static assets and has no worker entry point.
No YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID references remain in the runtime, README, docs or workflow configuration.
The separate Gemini question-draft integration remains intentionally unchanged; it is unrelated to live detection. The only remaining generativelanguage.googleapis.com call is the existing Gemini API request in server/index.js. Google Fonts stylesheet references are also unrelated static font assets. No YouTube Data API endpoint remains.

5. TESTS AND CI EVIDENCE
------------------------
New tests: server/live-api.test.js
- Rejects javascript:, data:, HTTP, and unlisted stream hosts.
- Rejects authenticated users absent from admin_users.
- Rejects invalid stream URL before database write.
- Verifies singleton upsert uses on_conflict=id and merge-duplicates, with no DELETE and a row still present.
- Rejects untrusted cross-origin CSRF.
- Allows cross-site only for the exact explicitly allowlisted Origin.
- Verifies public cache headers and exact legacy /api/live response shape.
Frontend tests in app/pwa-assets.test.js:
- Allowlisted HTTPS URL accepted.
- Unlisted host and HTTP URL rejected.
- No iframe; watch link rel; 60-second refresh and visibilitychange.
- New live files are part of the PWA asset list.

Latest CI for reviewed source snapshot a62d051ffff76519c2f7b37945981f62cd4af21c:
- Hares CI push run 42943744237 — SUCCESS (Tests and Build, Secret Scan, CI Gate).
- test PR run 42943751235 — SUCCESS.
- test push run 42943744360 — SUCCESS.
- Cloudflare build workflow was not triggered for PR #81 because its base is still feature/dr-khalid-ui; it must run after the PR base is retargeted to main.
- No deploy job ran. No SQL was executed.
These are PR/preview checks only, not a production deployment.

6. GREP EVIDENCE
----------------
Command pattern:
grep -RniE 'youtube|YOUTUBE_API_KEY|YOUTUBE_CHANNEL_ID|www.googleapis.com/youtube|youtube/v3' .

Remaining matches are regression guards only:
- app/pwa-assets.test.js:78 — negative assertion that live UI contains no YouTube/API-key references.
- scripts/secure-check.mjs:21 — security check that fails if the legacy integration appears in frontend files.

No runtime YouTube link, Worker, API call, credential variable, documentation setup step, or workflow configuration remains.

Command pattern:
grep -Rni 'service_role' .

Matches are limited to:
- server-only environment variable names and server-side authorization code.
- SQL role grants/revokes and RLS setup.
- README/docs statements that the key is server-only.
- security scanner pattern.
- test fixtures using dummy values (for example 'service-key' / 'server-only-service-role-value') and a smoke-test empty value.

No actual service_role credential value was committed or exposed to frontend code. Gitleaks Secret Scan passed on this PR snapshot.

Command pattern:
grep -Rni 'googleapis' .

Remaining references:
- Google Fonts CSS URLs in HTML pages (font stylesheet assets).
- server/index.js generativelanguage.googleapis.com for the existing Gemini question-draft integration.
No www.googleapis.com/youtube/v3 request remains. Gemini was retained to avoid breaking the separate question-review workflow.

7. OPEN PULL REQUEST LIST — SNAPSHOT
------------------------------------
Equivalent GitHub open-PR listing (gh pr list --state open), captured during this review:
#81 feat/manual-live -> feature/dr-khalid-ui
#80 feat/stage4-live -> feat/stage3-auth-admin
#79 fix/security-backport -> main
#78 feat/stage3-auth-admin -> feat/stage2-data-layer
#77 feat/stage2-data-layer -> feat/stage1-nextjs-foundation
#76 feat/stage1-nextjs-foundation -> main
#75 feature/dr-khalid-ui -> main
#74 fix/auth-production-remediation -> main
#70 feat/r2-library-media-2 -> main
#67 feat/p0-backend-production-deployment-readiness -> main
#61 dependabot/npm_and_yarn/development-dependencies-f673dcc01f -> main
#60 dependabot/npm_and_yarn/production-dependencies-ac49bf6fcd -> main
#59 dependabot/github_actions/actions/setup-java-6 -> main
#58 dependabot/github_actions/actions/checkout-7 -> main
#57 dependabot/github_actions/actions/setup-node-7 -> main
#56 dependabot/github_actions/actions/upload-pages-artifact-5 -> main
#55 dependabot/github_actions/actions/deploy-pages-5 -> main
#53 chore/github-security-tooling -> main
#48 fix/cloudflare-worker-backend-bridge -> fix/website-completion-pre-mobile
#47 fix/website-completion-pre-mobile -> integration/unified-main-2026-11-07
#46 integration/unified-main-2026-11-07 -> main
#45 agent-to-support-the-netlify-build-4f62 -> fix/istirahat-ahl-athar
#44 feat/identity-motion-current-base -> fix/istirahat-ahl-athar
#29 feat/haress-pwa-capacitor-readiness -> fix/istirahat-ahl-athar
#27 feat/haress-motion-ai-workflow -> feat/haress-premium-motion-identity
#25 feat/haress-interactive-telegram-bot -> fix/istirahat-ahl-athar
#24 feat/ios-capacitor-app -> fix/istirahat-ahl-athar
#23 codex/light-islamic-ui -> fix/istirahat-ahl-athar
#22 feat/light-editorial-theme-2026-11-02 -> fix/istirahat-ahl-athar
#21 feat/hares-ai-suggestions-platform -> feat/site-polish-and-fixes-2026-11-02
#20 feat/site-polish-and-fixes-2026-11-02 -> fix/istirahat-ahl-athar
#17 feat/daily-visitor-count -> fix/istirahat-ahl-athar
#15 feat/homepage-motion-and-real-controls -> fix/istirahat-ahl-athar
#13 feat/support-payment-methods -> fix/istirahat-ahl-athar
#12 feat/gemini-grok-dual-engine -> fix/section-overlay-tap-and-member-profile
#11 fix/section-overlay-tap-and-member-profile -> feat/google-member-accounts
#10 feat/google-member-accounts -> fix/istirahat-ahl-athar
#9 fix/mobile-branding-backdrop -> fix/istirahat-ahl-athar
#7 _فرع -> fix/istirahat-ahl-athar
#6 main -> fix/istirahat-ahl-athar
#2 fix/website-first -> main

8. SAFETY / PRODUCTION BOUNDARIES
---------------------------------
- No merge performed.
- No production deploy performed.
- No SQL executed against any Supabase project.
- No production secrets or hosting environment variables changed.
- No Next.js code introduced into this task.
- PR #80 (Next.js-based Stage 4) remains separate and unmerged; this PR is based directly on #75 as requested.

End of review.


8. RELEASE CLOSEOUT ADDENDUM — 2026-11-11
------------------------------------------
Current PR #81 head: 9326a662096daefc04ba7a454c6ddd12da364968
Base: feature/dr-khalid-ui@563d2c114e0b8fad22c124d4181a80e4b5569374 (PR #75 head)
PR state: OPEN, NOT MERGED; GitHub reports mergeable=true.

Node baseline alignment:
- Both PR #81 workflow files now explicitly use actions/setup-node@v6 with Node 24.18.0.
- npm clean-install is used for the root project.
- The repository policy scanner is invoked explicitly as node scripts/secure-check.mjs, independently of npm run check:secure. This preserves the static frontend/security policy checks even if the Node 24 baseline PR changes check:secure to the production dependency audit.
- No dependency was added or upgraded by these workflow-only alignment commits.

Current-head GitHub Actions evidence:
- Hares CI push run 43048569449 — SUCCESS (Tests and Build, Dependency security audit, Repository security policy scan, generated asset checks, Secret Scan, CI Gate).
- test push run 43048569219 — SUCCESS.
- test PR run 43048579799 — SUCCESS, Docker build included.
- Test log on Node 24.18.0: 91 tests, 91 passed, 0 failed.
- npm audit reported 0 vulnerabilities; repository policy scanner passed.
- No Cloudflare build/deploy run was triggered for PR #81 because its base remains feature/dr-khalid-ui rather than main. No hosted Cloudflare build is claimed here.

Dependency and main-compatibility analysis:
- PR #75 head is exactly PR #81 base (563d2c114e0b8fad22c124d4181a80e4b5569374). PR #81 is therefore a child of #75, not an independent PR directly targeting main.
- PR #75 remains OPEN and NOT MERGED. PR #81 must first be integrated into its parent branch or have its dependency/base resolved after the owner decides the #75 sequence; it must not be merged directly into main in its current base configuration.
- Combined static comparison from main@4b8f5e4adfd05c946df09fcdad4006343c6c2d5c to the current PR #81 head is 80 commits ahead, 0 behind. The net tree contains the existing app/ site, manual-live pages, Node server API, tests, docs, and the two migrations; the temporary YouTube Worker files added by #75 are removed again by #81, so they are absent from the combined net diff.
- The combined branch retains wrangler.jsonc as static assets (./app), without a Worker entry point or new nodejs_compat flag. The compatibility_date remains 2026-11-05.
- The Node 24 PR #83 is a separate open PR against main. Its package.json check:secure script is the dependency audit; PR #81 keeps the static policy scanner as an explicit workflow step so the two checks are not conflated.

Migration review boundary:
- The checked-in main:supabase/schema.sql does not define public.live_state. PR #81 adds it only in 20261111_live_state.sql with a singleton id=1, a CHECK constraint, RLS, column-limited public SELECT, service_role writes, and an idempotent seed.
- This repository-file finding does NOT prove whether a live_state table already exists in the actual Supabase project. Production database state remains unverified. Do not execute the migration until the owner independently confirms the target database state and approves the SQL.
- 20261109_ahl_safe_idempotent.sql was reviewed against main:supabase/schema.sql: it repeats the user_data/admin_users/lectures definitions and policies already represented in schema.sql and adds audience_questions. It is additive and contains no DROP TABLE, TRUNCATE, DELETE, DROP COLUMN, or ALTER TYPE. Actual database drift and policy state remain unverified.

Safety:
- No merge, deploy, production SQL, secret change, or hosting setting change was performed.
- No production live endpoint or Railway/Supabase integration test was performed.
- Owner decisions remain required for PR #75 integration order and for approval of any production migration/deployment.
