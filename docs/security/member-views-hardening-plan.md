# Member views security hardening — review plan

## Status

Prepared on `fix/security-invoker-member-views`, based on `main` at
`e216db2bf2c7c87366cce11b385f428c9e62abbd`.

This branch contains a review plan and recovered historical migration source.
It has **not** been applied to any Supabase project. Do not merge or deploy it
until the complete migration history is reconciled and the acceptance tests
below pass.

## Verified production findings

The production project inspected read-only is `doc` (PostgreSQL 17.11).

- `public.member_discipline` and `public.member_progress` are ordinary views
  owned by `postgres`, with no `security_invoker` option.
- The production inspection found SELECT available to `anon` and
  `authenticated` on both views.
- `member_discipline` aggregates attendance by `user_id`.
- `member_progress` exposes per-user attendance counts, discipline percentage,
  total points, rank and badge codes.
- `lecture_attendance` and `reward_points` have RLS enabled. Their policies
  allow a member to read their own rows and allow admins (checked through
  `public.admin_users`) to manage/read all rows.
- `admin_users` has RLS enabled but no SELECT policy for `authenticated`;
  it is not directly selectable by that role.
- `badges` has a public SELECT policy and is used by `member_progress`.

The view behavior is consistent with the Supabase advisor warning: default
PostgreSQL views use the view owner's privileges and can bypass underlying RLS.

## Candidate hardening SQL — NOT APPLIED

The intended change is:

```sql
begin;

-- Make both views evaluate underlying table privileges and RLS as the caller.
alter view public.member_discipline set (security_invoker = true);
alter view public.member_progress set (security_invoker = true);

-- Remove anonymous access; keep authenticated member/admin access subject to RLS.
revoke select on public.member_discipline, public.member_progress
  from anon, public;
grant select on public.member_discipline, public.member_progress
  to authenticated;

-- The attendance/points admin policies consult admin_users. Under
-- security_invoker, authenticated callers need narrowly-scoped visibility of
-- their own admin marker so those policies can evaluate without exposing the
-- administrator list.
grant select on public.admin_users to authenticated;
drop policy if exists "Users can read their own admin status"
  on public.admin_users;
create policy "Users can read their own admin status"
  on public.admin_users
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

commit;
```

Before turning this into a migration, verify that the exact production policy
names and definitions remain unchanged. Do not add a broad policy to
`admin_users`, and do not grant anon access to either view.

## Required acceptance tests

Run these only against an isolated Supabase development branch with synthetic
users/data, never against production as a test fixture.

1. Anonymous role:
   - SELECT from both member views returns no member rows (or is denied).
   - No ability to infer attendance, points, or rank for any user.
2. Authenticated ordinary member A:
   - Sees only A's attendance-derived row and points-derived totals.
   - Cannot see member B's rows or progress.
   - Cannot enumerate rows in `admin_users`; at most A's own admin marker is
     visible (normally no row).
3. Authenticated administrator:
   - Can read all attendance and points needed by the admin interface.
   - Can still perform only the admin operations already permitted by the
     existing ALL policies.
4. Service role:
   - Existing server-side behavior remains intact.
5. Application regression:
   - Verify member profile/progress and admin attendance/reward screens.
   - Verify empty-state behavior for a member with no attendance.
6. Security regression:
   - Confirm both view reloptions contain `security_invoker=true`.
   - Confirm `anon` has no SELECT privilege on either view.
   - Re-run Supabase security advisors.

## Migration-history reconciliation

A fresh read-only `list_migrations` of production project `doc` returned
exactly 16 entries. The final entry is
`20261120001719 / lecture_attendance_and_rewards`. The 16 ledger entries are:

| Version | Name |
|---|---|
| 20261109204441 | create_haress_core_tables |
| 20261118172423 | haress_ai_workflow_storage_hardening |
| 20261118172446 | haress_ai_workflow_fk_indexes |
| 20261118172518 | haress_ai_approval_state_alignment |
| 20261118172523 | haress_ai_approval_state_preservation |
| 20261118232154 | create_agents_hub_schema |
| 20261119060202 | suggestions_ai_storage_sync |
| 20261119060209 | set_updated_at_search_path_sync |
| 20261119060211 | suggestion_daily_cap_sync |
| 20261119060213 | haress_ai_task_secure_defaults |
| 20261119060706 | question_daily_cap_sync |
| 20261119060814 | ai_task_request_context_sync |
| 20261119060816 | atomic_ai_task_creation_sync |
| 20261119060818 | ai_reviews_storage_sync |
| 20261119060820 | ai_task_analysis_artifacts_sync |
| 20261120001719 | lecture_attendance_and_rewards |

### Attendance/rewards migration recovered

The exact SQL statement body for the final migration was recovered from the
production PostgreSQL log at `2026-11-20 00:17:19.873 UTC` (SQLSTATE
`00000`) and cross-checked against the production migration ledger. It has
been restored as:

`supabase/migrations/20261120001719_lecture_attendance_and_rewards.sql`

GitHub file blob SHA:
`f950ecf4f469c85007b2979ad55a40aabb3f7067`

The restored source contains the lecture columns, attendance and reward tables,
badge seeds, both member views, RLS policies, and grants. The original view
definitions do **not** set `security_invoker = true`; the recovered file is
historical source, not the hardening fix. It must not be reapplied to production.

### Additional read-only recovery-branch investigation

Inspected `recovery/restore-production-migrations-2026-11-19` and compared it
with `main`. That branch is six commits ahead and two behind the inspected
`main` baseline. Its migration directory contains ten SQL files, including
six recovered migration sources from production statement logs:

- `20261109204441_create_haress_core_tables.sql`
- `20261118172423_haress_ai_workflow_storage_hardening.sql`
- `20261118172446_haress_ai_workflow_fk_indexes.sql`
- `20261118172518_haress_ai_approval_state_alignment.sql`
- `20261118172523_haress_ai_approval_state_preservation.sql`
- `20261118232154_create_agents_hub_schema.sql`

The recovered core migration defines `user_data`, `admin_users`, and
`lectures`; it does not define the attendance/rewards objects. The
`agents_hub` migration only creates a separate `agents_hub` schema and grants
schema usage to `service_role`. This is not evidence that project `doc` is
an Agents Hub database or that this schema should be changed.

The remaining nine sync migrations have exact SQL bodies stored in the
production `supabase_migrations.schema_migrations.statements` records. A
read-only SELECT retrieved those bodies; the source files still need to be
reconstructed and compared against the four existing `main` migration files
before the repository migration history can be called fully reconciled.

The recovery branch is useful evidence but must not be merged wholesale as
part of this security fix. The remaining migration source files and their
version/name alignment must be restored on an isolated Git branch. Do not
invent or renumber migration versions.

## Safety boundary

Only the documentation and recovered historical SQL source were changed on
`fix/security-invoker-member-views`. No production SQL, migration, RLS, Auth,
Edge Function, Cloudflare, deployment, or `main`-branch changes were made.
