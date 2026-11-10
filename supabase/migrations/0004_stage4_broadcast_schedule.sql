-- Stage 4 — broadcast_schedule table (WRITTEN ONLY, NEVER EXECUTED from this repository).
-- Idempotent: create table if not exists.
-- Security:
--   * RLS enabled; public SELECT is allowed ONLY for published broadcasts;
--     NO anon/browser write policy exists. Admin writes go exclusively through
--     the service_role from the Node server, which authorizes the acting admin
--     via admin_users server-side.
--   * Fields: title (1-180), starts_at_utc (timestamptz), status
--     (draft|published), stream_url (optional, <= 1000 chars).

create table if not exists public.broadcast_schedule (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  starts_at_utc timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  stream_url text check (stream_url is null or char_length(stream_url) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.broadcast_schedule enable row level security;
revoke all on public.broadcast_schedule from anon, authenticated, public;
grant all on public.broadcast_schedule to service_role;
grant select on public.broadcast_schedule to anon, authenticated;

drop policy if exists "Public can read published broadcast_schedule" on public.broadcast_schedule;
create policy "Public can read published broadcast_schedule"
  on public.broadcast_schedule for select to anon, authenticated
  using (status = 'published');
