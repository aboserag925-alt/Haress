# Haress database security remediation plan

**Status:** review-only plan; no production database changes have been made.  
**Target branch:** `fix/security-default-privileges`  
**Base:** `main` at `e216db2bf2c7c87366cce11b385f428c9e62abbd` (verified 2026-11-20).

## Scope and safety boundaries

This work is for Haress, the primary product. The branch is isolated from `main`. Do not merge, deploy, run SQL against the production Supabase project, alter production grants/default privileges, or change secrets without separate explicit approval.

Preserve the existing Arabic/RTL app, authentication, admin authorization, RLS, Telegram approval workflow, tests, and deployment protections. Do not weaken RLS or expose service-role credentials.

## Evidence-backed findings from the read-only Supabase audit

1. The `public.member_discipline` and `public.member_progress` views were created as owner-rights views (`security_invoker=false`). Their ACLs allow `anon` and `authenticated` to SELECT. The views expose member identifiers and attendance/points/rank aggregates. The underlying attendance and rewards tables have owner-scoped RLS, so owner-rights views can bypass the intended row boundary.
2. The `postgres` default ACL for relations in `public` includes `anon` and `authenticated` with broad relation privileges. This explains how a newly created view can inherit public role privileges. Do not globally alter default ACLs until every existing object and intended API use has been inventoried.
3. The `postgres` default ACL also grants broad privileges on sequences and EXECUTE on functions to public-facing roles. Existing sensitive AI RPCs inspected during the audit were restricted, but future objects may inherit overly broad privileges.
4. `ai_audit_events_id_seq` has broader privileges for `anon` than needed; the table itself does not grant anonymous access. Verify the sequence's ownership/default expression and actual use before changing it.
5. The `audience_questions` insert policy appears intentionally public and constrains new questions to the `pending` state. Preserve it unless the public question submission flow is proven unused.
6. The current app's AI files show a split between a database-backed `task-service` and an in-memory `HaresAISupervisor`. The approval API authenticates the user and checks `admin_users`, but the complete persisted create → analyze → approve → execute lifecycle is not yet proven to be wired end-to-end.

## Required repository investigation before writing a migration

- Search the full repository for `member_discipline` and `member_progress` usage, including frontend, server, edge worker, and tests. Identify whether consumers require public aggregates, self-only aggregates, or admin-wide access.
- Inventory all `ALTER DEFAULT PRIVILEGES` and explicit GRANT/REVOKE statements in migrations and schema files.
- Inspect the exact definition and ACLs of both views, all source-table RLS policies, and relevant admin authorization predicates.
- Inspect sequence defaults/ownership and all references to `ai_audit_events_id_seq`.
- Trace every caller of `createTaskService`, `HaresAISupervisor`, `record_ai_task_analysis`, and `record_ai_approval`. Establish whether there is an authenticated, server-only path that clears taint after a successful trusted review. Never trust a client-supplied `trustedSource` flag.

## Proposed remediation design (not executable yet)

1. Prefer `security_invoker=true` for member views where the intended behavior is to enforce the caller's RLS. Confirm PostgreSQL version compatibility (production is PostgreSQL 17) and test with distinct member identities.
2. Revoke `anon` SELECT on the two member views. Grant `authenticated` only if the invoker view plus underlying RLS demonstrably limits rows to the current member. If the application needs administrator-wide aggregates, design a separate server-only/admin view or RPC with explicit admin authorization; do not make the member view owner-rights/public.
3. Review default ACLs by object type and creator role. Propose least-privilege defaults for future tables, sequences, and functions, but do not apply blanket changes until migrations and application dependencies are inventoried. Explicit grants should be added only where the Data API needs them.
4. Revoke unnecessary anonymous sequence privileges only after verifying the sequence is not used by a public insert path. Keep public question submission functional.
5. For AI lifecycle wiring, keep untrusted input tainted; require successful persisted security/verifier analysis before a privileged server-side transition; bind approval to the authenticated admin user; keep implementation/merge behind the human approval gate. Preserve audit events atomically where feasible.
6. Add regression tests for anonymous denial, member A vs member B isolation, admin access, public question submission, sequence access, and AI state transitions.

## Acceptance criteria

- Anonymous requests cannot read another member's attendance, points, rank, or badge aggregates.
- An authenticated member can read only their own permitted aggregate data.
- An authorized administrator can access the intended administrative data.
- Public question submission still works with the existing validation and pending-only state.
- Browser roles cannot mutate attendance, rewards, AI task state, approvals, audit events, or privileged sequences.
- Sensitive AI functions remain server-only; untrusted input cannot become trusted by setting a request flag.
- All relevant existing tests and new regression tests pass.
- A migration is reviewed for exact blast radius and is tested on an isolated Supabase branch before any production proposal.

## Current implementation status

- [x] Created isolated Git branch from `main`.
- [x] Recorded the read-only audit findings and remediation/acceptance plan.
- [ ] Trace application references to the member views.
- [ ] Complete default-ACL and sequence dependency inventory.
- [ ] Trace AI task lifecycle wiring and tests.
- [ ] Draft migration only after the above checks.
- [ ] Run tests and isolated-branch verification.
- [ ] Open a draft PR for review.
- [ ] Production SQL / merge / deployment: requires separate explicit approval.


## Repository tracing update (2026-11-20)

### AI lifecycle wiring: concrete source inspection

- `server/index.js` constructs `createTaskService()` and passes it to `createApprovalApi()`. In the inspected server routing, the approval API is mounted, but there is no corresponding route that creates persisted AI tasks or records analysis.
- `server/ai/supervisor.js` is referenced by `server/ai/ai.test.js`; no production import from `server/index.js` was found in the repository search.
- `createTaskService` is referenced by `server/index.js` and its unit tests. The server's current use is through the approval API's `recordHumanApproval` operation.
- The service writes new `ai_tasks` rows directly through PostgREST and records the audit event separately on a best-effort basis. It does not call an atomic create-with-audit RPC.
- Repository code search did not locate a caller of `record_ai_task_analysis`. This is a search result, not proof that no dynamic or external caller exists.
- `trustedSource: true` is accepted by the task service and in-memory task factory. The supervisor explicitly forces `trustedSource: false` for analysis input. Before any wiring is added, trusted-source creation must be confined to a private server-controlled path; it must never be set from request JSON or user metadata.
- The SQL definition of `record_ai_approval` checks the supplied actor ID against `admin_users`, rejects tainted tasks, checks task state, and records approval plus audit event transactionally. Its EXECUTE privilege is restricted to `service_role`. Keep these protections.

### Member view references

Repository code search for `member_discipline`, `member_progress`, `attendance`, and `reward_points` did not return application references. This does **not** establish that the views are unused: the search index may omit files, and there may be dynamically constructed queries or external consumers. Do not change the view contract until the full repository tree and runtime dependencies are checked.

### Next implementation gate

- Treat the view consumer inventory as incomplete.
- Do not draft the production-facing view migration until consumers are identified or the views are confirmed unused through a complete source inventory and application smoke tests.
- The AI workflow gap is a separate code change from the default-privilege/view migration. Keep the PR focused; do not combine unrelated workflow refactoring with a database security patch.


## Cloudflare + Supabase integration review (2026-11-20; read-only)

### Supabase production project identity and current state

- The repository's `wrangler.jsonc` production `SUPABASE_URL` points to `https://uzepglfimareggswjzlf.supabase.co`; this matches the active Supabase project named `doc` (PostgreSQL 17.11, region `eu-west-3`). This confirms `doc` is the database project currently wired to Haress; do not assume the separate `agents_hub` schema is the product database.
- The production project reports `ACTIVE_HEALTHY`.
- The database reports the same 16 applied migrations previously inventoried.
- Three Edge Functions are active: `lectures-admin` v2 (`verify_jwt=false`), `admin-operations` v4 (`verify_jwt=true`), and `submit-suggestion` v2 (`verify_jwt=false`). The two JWT-disabled functions require continued source-level internal authentication/validation checks; their setting alone is not proof of a vulnerability.
- Current Security Advisor still reports the two owner-rights member views, nine RLS-enabled tables without policies, and disabled leaked-password protection. The nine tables were previously checked for direct browser-role SQL privileges and were found not directly accessible to `anon` or `authenticated`; do not add permissive policies just to silence the INFO warning.
- A fresh read-only catalog query confirmed `postgres` default ACLs in `public`: sequences (`S`) grant `rwU` to anon/authenticated/service_role; functions (`f`) grant EXECUTE (`X`) to those roles; relations (`r`) grant `arwdDxtm` to those roles. Both member views still have broad ACLs including anon/authenticated and have no `security_invoker=true` reloption.
- The view definitions aggregate attendance, discipline percentages, points, rank names/codes and badge codes grouped by `user_id`. Treat this as member-related data and maintain a deny-by-default posture.

### Cloudflare Worker wiring and deployment controls

- Production `wrangler.jsonc` identifies Worker `hares`, assets directory `./app`, and the production Supabase URL above. It contains `previews: {}`; the preview config is a separate Worker `hares-preview` targeting the separate test Supabase project `bevyztwoijjzfngutnys`.
- The Worker source routes static assets through Cloudflare Assets. In Preview only, selected API paths are proxied to Supabase Edge Functions. In production, those paths are not sent through that Preview-only Supabase function proxy; other `/api/*` paths require `API_BACKEND_URL`, otherwise they fail closed with HTTP 503.
- The production Wrangler config does not declare `API_BACKEND_URL`. It may be configured externally in Cloudflare Dashboard, but that could not be verified with the connected tools in this session. The Cloudflare account/Worker settings and live production HTTP status also could not be read directly because no Cloudflare connector is available here.
- The repository's `.github/workflows/cloudflare-worker.yml` runs build, `wrangler deploy --dry-run`, and tests on PR/push; its actual production deploy job runs only on manual `workflow_dispatch`, only from `main`, and only when `confirm_production == true`. It requires Cloudflare secrets in GitHub Actions. This is a useful production gate; do not bypass it.
- The workflow's PR build intentionally points at the separate test Supabase project, while main validates the production project URL. Preserve that isolation.
- `docs/BACKEND_PRODUCTION.md` states that Cloudflare Workers static assets do not run the Node `server/index.js` API server; the Node server requires a separate Node-capable HTTPS host and persistent storage if media storage is used. This is a major readiness dependency, not a database migration issue.

### External deployment status and limits

- The Vercel preview for the documentation-only branch commit was BLOCKED because the Vercel project was paused. This is not a build failure and does not establish Cloudflare deployment health.
- No Cloudflare production deployment was triggered, no Worker vars/secrets were changed, and no Supabase production schema, data, RLS, grants, Edge Functions, or Auth settings were modified.
- The Supabase development branch named `main` remains `MIGRATIONS_FAILED` while its preview project status is `ACTIVE_HEALTHY`. The original migration failure remains unknown; do not reset/rebase/retry without the original error.

### Work remaining before implementation

1. Verify Cloudflare Dashboard production Worker variables/bindings, especially `API_BACKEND_URL`, and inspect latest deployment plus live HTTP/API smoke results. This needs a Cloudflare account connection or owner-provided dashboard evidence.
2. Decide whether production API traffic should be routed to the existing Node host or to specific Supabase Edge Functions. Do not make the Worker route production traffic to preview/test functions.
3. Verify the Node API host, HTTPS health endpoint, persistent storage, CORS allowlist, and frontend `AHL_API_BASE_URL` integration.
4. Complete view-consumer inventory and design the isolated database branch test before preparing executable SQL.
5. Obtain the original Supabase preview-branch migration failure details.

