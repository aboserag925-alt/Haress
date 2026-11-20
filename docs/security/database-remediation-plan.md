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
