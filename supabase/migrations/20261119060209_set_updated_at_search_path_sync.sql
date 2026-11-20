-- Harden the shared updated_at trigger and preserve existing supporting schema.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists trg_suggestions_updated_at on public.suggestions;
create trigger trg_suggestions_updated_at
  before update on public.suggestions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_ai_tasks_updated_at on public.ai_tasks;
create trigger trg_ai_tasks_updated_at
  before update on public.ai_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_lectures_updated_at on public.lectures;
create trigger trg_lectures_updated_at
  before update on public.lectures
  for each row execute function public.set_updated_at();

create index if not exists idx_lectures_status_starts
  on public.lectures (status, starts_at);

do $$
begin
  if pg_catalog.to_regclass('public.user_data') is not null
     and not exists (
       select 1
       from pg_catalog.pg_constraint
       where conname = 'user_data_size_check'
         and conrelid = pg_catalog.to_regclass('public.user_data')
     ) then
    alter table public.user_data
      add constraint user_data_size_check
      check (pg_catalog.octet_length(data::text) <= 1048576) not valid;
  end if;
end
$$;
