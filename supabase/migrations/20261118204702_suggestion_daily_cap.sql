-- Shared daily budget and suggestion creation in one database transaction.
-- If inserting the suggestion fails, PostgreSQL rolls back the quota increment too.

create table if not exists public.suggestion_daily_usage (
  usage_day date primary key,
  used_count integer not null default 0 check (used_count >= 0)
);

alter table public.suggestion_daily_usage enable row level security;
revoke all on public.suggestion_daily_usage from public, anon, authenticated;
grant all on public.suggestion_daily_usage to service_role;

create or replace function public.submit_suggestion_with_daily_cap(
  p_day date,
  p_cap integer,
  p_category text,
  p_title text,
  p_description text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_item public.suggestions%rowtype;
begin
  if p_day is null
     or p_cap is null or p_cap < 1 or p_cap > 1000000
     or p_category is null
     or p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 4 and 120
     or p_description is null or pg_catalog.char_length(pg_catalog.btrim(p_description)) not between 10 and 3000 then
    raise exception 'Invalid suggestion submission arguments';
  end if;

  insert into public.suggestion_daily_usage as existing (usage_day, used_count)
  values (p_day, 1)
  on conflict (usage_day) do update
    set used_count = existing.used_count + 1
    where existing.used_count < p_cap
  returning true into v_allowed;

  if v_allowed is distinct from true then
    return pg_catalog.jsonb_build_object('allowed', false);
  end if;

  -- This insert shares the RPC transaction with the quota increment above.
  -- Any insert error aborts the whole function call and rolls the increment back.
  insert into public.suggestions (category, title, description, user_id)
  values (p_category, pg_catalog.btrim(p_title), pg_catalog.btrim(p_description), null)
  returning * into v_item;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'item', pg_catalog.jsonb_build_object(
      'id', v_item.id,
      'category', v_item.category,
      'title', v_item.title,
      'description', v_item.description,
      'status', v_item.status,
      'created_at', v_item.created_at
    )
  );
end;
$$;

revoke all on function public.submit_suggestion_with_daily_cap(date, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_suggestion_with_daily_cap(date, integer, text, text, text)
  to service_role;
