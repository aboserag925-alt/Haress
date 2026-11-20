
-- Haress AI workflow persistence. Service-side access only; browser roles remain denied.
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('feature','bug','design','content','performance','usability','other')),
  title text not null check (char_length(title) between 4 and 120),
  description text not null check (char_length(description) between 10 and 3000),
  status text not null default 'PENDING' check (status in ('PENDING','REJECTED')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid references public.suggestions(id) on delete set null,
  status text not null default 'PROPOSED',
  risk text not null default 'low' check (risk in ('low','medium','high','critical')),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  requires_approval boolean not null default false,
  approved boolean not null default false,
  tainted boolean not null default false,
  source text not null default 'internal' check (source in ('internal','suggestion')),
  affected_areas text[] not null default '{}',
  human_approved boolean not null default false,
  human_approval_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('IMPLEMENT','MERGE')),
  decision text not null check (decision in ('APPROVED','REJECTED')),
  reason text not null default '' check (char_length(reason) <= 1000),
  created_at timestamptz not null default now(),
  unique (task_id, action)
);

alter table public.ai_tasks
  add constraint ai_tasks_human_approval_fk
  foreign key (human_approval_id) references public.ai_approvals(id) on delete set null;

create table if not exists public.ai_audit_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'suggestion.created','suggestion.updated','suggestion.rejected',
    'ai.task.created','ai.analysis.completed','ai.approval.requested',
    'ai.approval.granted','ai.approval.rejected','ai.implementation.started',
    'ai.tests.executed','ai.verification.completed','ai.pull_request.prepared'
  )),
  suggestion_id uuid references public.suggestions(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lectures_created_by_idx on public.lectures(created_by);
create index if not exists suggestions_created_at_idx on public.suggestions(created_at desc);
create index if not exists suggestions_status_created_at_idx on public.suggestions(status, created_at desc);
create index if not exists ai_tasks_created_at_idx on public.ai_tasks(created_at desc);
create index if not exists ai_tasks_suggestion_id_idx on public.ai_tasks(suggestion_id);
create index if not exists ai_approvals_task_id_idx on public.ai_approvals(task_id);
create index if not exists ai_audit_events_created_at_idx on public.ai_audit_events(created_at desc);
create index if not exists ai_audit_events_suggestion_id_idx on public.ai_audit_events(suggestion_id);

alter table public.suggestions enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.ai_approvals enable row level security;
alter table public.ai_audit_events enable row level security;

revoke all on table public.suggestions, public.ai_tasks, public.ai_approvals, public.ai_audit_events from public, anon, authenticated;
grant all on table public.suggestions, public.ai_tasks, public.ai_approvals, public.ai_audit_events to service_role;
grant usage, select on sequence public.ai_audit_events_id_seq to service_role;

create or replace function public.record_ai_approval(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_decision text,
  p_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_approval_id uuid;
begin
  if p_task_id is null or p_actor_user_id is null
     or p_action not in ('IMPLEMENT','MERGE')
     or p_decision not in ('APPROVED','REJECTED')
     or (p_decision = 'REJECTED' and length(trim(coalesce(p_reason,''))) = 0)
     or length(coalesce(p_reason,'')) > 1000 then
    raise exception 'Invalid approval request' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.admin_users a where a.user_id = p_actor_user_id
  ) then
    raise exception 'Actor is not an authorized administrator' using errcode = '42501';
  end if;

  perform 1 from public.ai_tasks t where t.id = p_task_id for update;
  if not found then
    raise exception 'AI task not found' using errcode = 'P0002';
  end if;

  insert into public.ai_approvals(task_id, actor_user_id, action, decision, reason)
  values (p_task_id, p_actor_user_id, p_action, p_decision, left(coalesce(p_reason,''),1000))
  returning id into v_approval_id;

  update public.ai_tasks
  set approved = (p_action = 'IMPLEMENT' and p_decision = 'APPROVED'),
      human_approved = (p_action = 'MERGE' and p_decision = 'APPROVED'),
      human_approval_id = v_approval_id,
      status = case when p_decision = 'REJECTED' then 'REJECTED' else status end,
      updated_at = now()
  where id = p_task_id;

  return v_approval_id;
end;
$function$;

revoke all on function public.record_ai_approval(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_ai_approval(uuid,uuid,text,text,text) to service_role;

-- Keep the media bucket private and enforce the application's 20 MiB upload ceiling.
update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array[
      'audio/aac','audio/flac','audio/mp4','audio/mpeg','audio/ogg','audio/wav',
      'application/epub+zip','application/pdf','text/plain',
      'image/jpeg','image/png','image/webp',
      'video/mp4','video/webm'
    ]
where id = 'haress-media';
