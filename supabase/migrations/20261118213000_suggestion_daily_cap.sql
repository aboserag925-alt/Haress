-- Shared, atomic daily budget for public suggestions.
create table if not exists public.suggestion_daily_usage (
  usage_day date primary key,
  used_count integer not null default 0 check (used_count >= 0)
);

alter table public.suggestion_daily_usage enable row level security;
revoke all on public.suggestion_daily_usage from public, anon, authenticated;
grant all on public.suggestion_daily_usage to service_role;

create or replace function public.consume_suggestion_daily_cap(
  p_day date,
  p_cap integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
begin
  if p_day is null or p_cap is null or p_cap < 1 or p_cap > 1000000 then
    raise exception 'Invalid daily suggestion budget arguments';
  end if;

  insert into public.suggestion_daily_usage as existing (usage_day, used_count)
  values (p_day, 1)
  on conflict (usage_day) do update
    set used_count = existing.used_count + 1
    where existing.used_count < p_cap
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke execute on function public.consume_suggestion_daily_cap(date, integer)
  from public, anon, authenticated;
grant execute on function public.consume_suggestion_daily_cap(date, integer)
  to service_role;
