# Member views security hardening — review plan

## Status

Prepared on `fix/security-invoker-member-views`, based on `main` at
`e216db2bf2c7c87366cce11b385f428c9e62abbd`.

This is a review plan only. It has **not** been applied to any Supabase project.
Do not merge or deploy it until the migration history is reconciled and the
acceptance tests below pass.

## Verified production findings

The production project inspected read-only is `doc` (PostgreSQL 17.11).

- `public.member_discipline` and `public.member_progress` are ordinary views
  owned by `postgres`, with no `security_invoker` option.
- Both views grant SELECT to `anon` and `authenticated`.
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

## Migration-history blocker

The production migration ledger contains 16 entries, including
`20261120001719_lecture_attendance_and_rewards`, while the current `main`
tree contains only four files under `supabase/migrations`. The migration
source corresponding to the production attendance/rewards schema is not
present in that directory. Reconcile and restore the missing migration source
history before adding a new numbered migration; do not invent or renumber
migration files to conceal this drift.

### Additional read-only recovery-branch investigation

Inspected `recovery/restore-production-migrations-2026-11-19` and compared it
with `main`. This branch is six commits ahead and two behind the inspected
`main` baseline. Its migration directory contains ten SQL files, including
six recovered migration sources from production statement logs:

- `20261109204441_create_haress_core_tables.sql`
- `20261118172423_haress_ai_workflow_storage_hardening.sql`
- `20261118172446_haress_ai_workflow_fk_indexes.sql`
- `20261118172518_haress_ai_approval_state_alignment.sql`
- `20261118172523_haress_ai_approval_state_preservation.sql`
- `20261118232154_create_agents_hub_schema.sql`

The recovered core migration defines `user_data`, `admin_users`, and
`lectures`; it does not define `lecture_attendance`, `reward_points`,
`member_discipline`, or `member_progress`. The recovered AI migrations
cover AI workflow tables/functions and do not supply the missing
attendance/rewards migration. The branch's `supabase/schema.sql` and
`supabase/migrations.test.js` also contain no references to those four
attendance/rewards objects.

The `agents_hub` migration only creates a separate `agents_hub` schema and
grants schema usage to `service_role`. Its presence in the recovery branch
is not evidence that the production project should be treated as an Agents Hub
database or that this schema should be changed.

Therefore, the recovery branch is useful evidence for part of the production
migration history, but it does **not** resolve the attendance/rewards source
gap. Do not merge that branch wholesale as part of this security fix. The
remaining production ledger entries and the original
`20261120001719_lecture_attendance_and_rewards` source still need exact
reconciliation against the production migration ledger / statement logs.

## Safety boundary

No production SQL, migration, RLS, Auth, Edge Function, GitHub main-branch,
Cloudflare, or deployment changes were made as part of this review.
