-- Stage 4 — live_state table (WRITTEN ONLY, NEVER EXECUTED from this repository).
-- Idempotent: create table if not exists.
-- Security:
--   * RLS enabled; public SELECT is allowed for this operational live-state row
--     only (is_live / stream_url / stream_title / provider / updated_at — no
--     personal data). NO anon/browser write policy exists; admin writes go
--     exclusively through the service_role from the Node server, which authorizes
--     the acting admin via admin_users server-side.
--   * The live state is maintained by the manual operator panel via the admin
--     server action (adminSetLiveState) — no automated broadcast tooling runs.

create table if not exists public.live_state (
  id uuid primary key default gen_random_uuid(),
  is_live boolean not null default false,
  stream_url text,
  stream_title text,
  provider text,
  updated_at timestamptz not null default now()
);

alter table public.live_state enable row level security;
revoke all on public.live_state from anon, authenticated, public;
grant all on public.live_state to service_role;
grant select on public.live_state to anon, authenticated;

drop policy if exists "Public can read live_state" on public.live_state;
create policy "Public can read live_state"
  on public.live_state for select to anon, authenticated
  using (true);

create index if not exists live_state_updated_idx on public.live_state (updated_at desc);
