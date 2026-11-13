-- Haress Owner / Editor role migration.
-- Apply only after confirming that aboserag925@gmail.com is the intended Owner.
-- This migration fails before changing existing rows if that Auth account is absent.
begin;

alter table public.admin_users
  add column if not exists role text not null default 'editor';

do $$
begin
  if not exists (
    select 1 from auth.users
    where lower(coalesce(email, '')) = lower('aboserag925@gmail.com')
  ) then
    raise exception 'Owner Auth account aboserag925@gmail.com must exist before applying this migration.';
  end if;
end
$$;

alter table public.admin_users
  drop constraint if exists admin_users_role_check;
alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('owner', 'editor'));

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
on conflict (user_id) do update
set role = 'owner';

create unique index if not exists admin_users_single_owner
  on public.admin_users ((role))
  where role = 'owner';

commit;
