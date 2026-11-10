-- Manual live state for the existing Node + app/ site.
-- Additive and idempotent. Review only; DO NOT execute automatically.
begin;

create table if not exists public.live_state (
  id smallint primary key default 1 check (id = 1),
  is_live boolean not null default false,
  stream_url text,
  stream_title text not null default 'البث المباشر',
  provider text,
  updated_at timestamptz not null default now()
);

alter table public.live_state enable row level security;
revoke all on table public.live_state from public, anon, authenticated;
revoke all on table public.live_state from service_role;
grant select (is_live, stream_url, stream_title, provider, updated_at)
  on table public.live_state to anon, authenticated;
grant select, insert, update, delete on table public.live_state to service_role;

drop policy if exists "Public can read live state" on public.live_state;
create policy "Public can read live state"
  on public.live_state for select to anon, authenticated
  using (id = 1);

insert into public.live_state (id, is_live, stream_url, stream_title, provider)
values (1, false, null, 'البث المباشر', null)
on conflict (id) do nothing;

commit;
