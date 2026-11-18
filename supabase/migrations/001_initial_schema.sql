-- Migration 001: AI tasks, audit events, suggestions tables + RLS + indexes + triggers
-- Idempotent: safe to re-run.

-- 1. suggestions table
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('feature','bug','design','content','performance','usability','other')),
  title text not null check (char_length(title) between 4 and 120),
  description text not null check (char_length(description) between 10 and 3000),
  status text not null default 'NEW' check (status in ('NEW','REJECTED','APPROVED','IN_PROGRESS','DONE')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  risk text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. ai_tasks table
create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid references public.suggestions(id) on delete set null,
  status text not null default 'PROPOSED',
  risk text,
  confidence numeric,
  requires_approval boolean not null default false,
  approved boolean not null default false,
  tainted boolean not null default false,
  source text not null default 'internal' check (source in ('suggestion','internal')),
  affected_areas text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. ai_audit_events table
create table if not exists public.ai_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  suggestion_id uuid references public.suggestions(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 4. ai_approvals table
create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('IMPLEMENT','MERGE')),
  decision text not null check (decision in ('APPROVED','REJECTED')),
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- 5. record_ai_approval function
create or replace function public.record_ai_approval(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_decision text,
  p_reason text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval_id uuid;
begin
  -- Verify actor is admin
  if not exists (select 1 from public.admin_users where user_id = p_actor_user_id) then
    raise exception 'Actor is not an admin';
  end if;
  -- Verify task exists
  if not exists (select 1 from public.ai_tasks where id = p_task_id) then
    raise exception 'Task not found';
  end if;
  insert into public.ai_approvals (task_id, actor_user_id, action, decision, reason)
  values (p_task_id, p_actor_user_id, p_action, p_decision, p_reason)
  returning id into v_approval_id;
  return v_approval_id;
end;
$$;

-- SECURITY: functions in the public schema are callable through the Supabase REST API by
-- default (EXECUTE is granted to PUBLIC). The actor id is caller-supplied, so without this
-- revoke any visitor could submit an admin's UUID and record an approval in their name.
revoke execute on function public.record_ai_approval(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_ai_approval(uuid, uuid, text, text, text)
  to service_role;

-- 6. RLS: revoke all from anon/authenticated, grant to service_role
alter table public.suggestions enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.ai_audit_events enable row level security;
alter table public.ai_approvals enable row level security;

revoke all on public.suggestions from anon, authenticated, public;
revoke all on public.ai_tasks from anon, authenticated, public;
revoke all on public.ai_audit_events from anon, authenticated, public;
revoke all on public.ai_approvals from anon, authenticated, public;

grant all on public.suggestions, public.ai_tasks, public.ai_audit_events, public.ai_approvals to service_role;

-- 7. Indexes
create index if not exists idx_lectures_status_starts on public.lectures (status, starts_at);
create index if not exists idx_ai_tasks_status on public.ai_tasks (status);
create index if not exists idx_ai_tasks_suggestion on public.ai_tasks (suggestion_id);
create index if not exists idx_ai_audit_events_suggestion on public.ai_audit_events (suggestion_id);
create index if not exists idx_suggestions_status on public.suggestions (status);
create index if not exists idx_suggestions_created on public.suggestions (created_at desc);

-- 8. user_data.data size limit (1MB)
-- "ADD CONSTRAINT IF NOT EXISTS" is not valid PostgreSQL, so guard with a DO block.
-- NOT VALID enforces the limit on new writes without failing on rows that already exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_data_size_check
      and conrelcid = 'public.user_data'::regclass
  ) then
    alter table public.user_data
      add constraint user_data_size_check
      check (octet_length(data::text) <= 1048576) not valid;
  end if;
end
$$;

-- 9. updated_at trigger function
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 10. Triggers for updated_at
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
