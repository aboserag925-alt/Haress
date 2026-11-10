-- Stage 3 — audit_log table (WRITTEN ONLY, NEVER EXECUTED from this repository).
-- Idempotent: create table if not exists.
-- Security:
--   * RLS enabled; NO read/write policies for anon or browser-authenticated.
--     Admin activity rows are written exclusively through the server-side
--     service_role from the Node/Next server (which authorizes the acting
--     admin via admin_users server-side).
--   * Records only: action, entity_type, entity_id, actor_id, created_at.
--     No personal data (email/names) is stored.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated, public;
grant all on public.audit_log to service_role;
