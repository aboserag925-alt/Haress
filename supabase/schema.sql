create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

revoke all on table public.user_data from anon, public;
grant select, insert, update on table public.user_data to authenticated;

drop policy if exists "Users can read their own data" on public.user_data;
create policy "Users can read their own data"
  on public.user_data
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own data" on public.user_data;
create policy "Users can insert their own data"
  on public.user_data
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own data" on public.user_data;
create policy "Users can update their own data"
  on public.user_data
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- Lecture publishing and administrator authorization.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now()
);

-- Idempotent role migration. The configured account is the sole Owner.
-- Existing non-owner administrator entries are removed; the future Editor
-- account is added only after its exact Auth user ID is confirmed.
alter table public.admin_users add column if not exists role text not null default 'editor';
do $
begin
  if not exists (
    select 1 from auth.users
    where lower(coalesce(email, '')) = lower('aboserag925@gmail.com')
  ) then
    raise exception 'Owner Auth account aboserag925@gmail.com must exist before applying the role migration.';
  end if;
end
$;
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check (role in ('owner', 'editor'));
delete from public.admin_users au
using auth.users u
where au.user_id = u.id
  and lower(coalesce(u.email, '')) <> lower('aboserag925@gmail.com');
update public.admin_users au
set role = 'owner'
from auth.users u
where au.user_id = u.id
  and lower(coalesce(u.email, '')) = lower('aboserag925@gmail.com');
insert into public.admin_users (user_id, role)
select id, 'owner'
from auth.users
where lower(coalesce(email, '')) = lower('aboserag925@gmail.com')
on conflict (user_id) do update set role = 'owner';
create unique index if not exists admin_users_single_owner
  on public.admin_users ((role))
  where role = 'owner';

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  starts_at timestamptz,
  category text not null default 'محاضرة' check (char_length(category) <= 80),
  stream_url text,
  recording_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.lectures enable row level security;
revoke all on public.admin_users from anon, authenticated, public;
revoke all on public.lectures from anon, authenticated, public;
grant all on public.admin_users, public.lectures to service_role;
grant select on public.lectures to anon, authenticated;

drop policy if exists "Public can read published lectures" on public.lectures;
create policy "Public can read published lectures"
  on public.lectures for select to anon, authenticated
  using (status = 'published');

-- The service role is used only by the server. No browser role can grant itself admin.
-- Add administrators manually from the Supabase SQL Editor, after creating their Auth account:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'admin@example.com';
