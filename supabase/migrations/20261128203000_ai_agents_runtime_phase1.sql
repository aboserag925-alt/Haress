-- Phase 1 AI task runtime: atomic task creation, persisted analysis evidence,
-- and strict database-side approval gates. Apply to haress-test only after review.
begin;
-- Preserve the original task request alongside its review lifecycle.
-- Additive and safe for existing task rows; no existing data is rewritten.
begin;
alter table public.ai_tasks add column if not exists task_type text;
alter table public.ai_tasks add column if not exists title text;
alter table public.ai_tasks add column if not exists description text;
do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='ai_tasks_task_type_check'
      and conrelid='public.ai_tasks'::regclass
  ) then
    alter table public.ai_tasks
      add constraint ai_tasks_task_type_check
      check (task_type is null or task_type in ('suggestion','security','implementation','ux','content','performance','product'));
  end if;
end
$constraint$;

-- Atomically create an AI task and its provenance audit event.
-- Either both rows commit, or neither row is persisted.
begin;

create or replace function public.create_ai_task_with_audit(
  p_suggestion_id uuid,
  p_actor_user_id uuid,
  p_source text,
  p_task_type text,
  p_title text,
  p_description text,
  p_risk text,
  p_requires_approval boolean,
  p_affected_areas text[]
) returns setof public.ai_tasks
language plpgsql
security definer
set search_path = ''
as $create_task$
declare
  v_task public.ai_tasks%rowtype;
  v_source text;
  v_areas text[];
begin
  if p_source not in ('suggestion','internal')
     or p_risk not in ('low','medium','high','critical')
     or p_requires_approval is null then
    raise exception 'Invalid AI task creation request';
  end if;

  if p_task_type is not null and p_task_type not in
     ('suggestion','security','implementation','ux','content','performance','product') then
    raise exception 'Invalid AI task type';
  end if;

  v_source := p_source;
  v_areas := coalesce(p_affected_areas, '{}'::text[]);

  insert into public.ai_tasks(
    suggestion_id,status,risk,confidence,task_type,title,description,
    requires_approval,approved,tainted,source,affected_areas
  ) values (
    p_suggestion_id,'PROPOSED',p_risk,null,p_task_type,
    nullif(pg_catalog.left(coalesce(p_title,''),120),''),
    nullif(pg_catalog.left(coalesce(p_description,''),3000),''),
    p_requires_approval,false,true,v_source,
    v_areas[1:30]
  )
  returning * into v_task;

  insert into public.ai_audit_events(
    event_type,suggestion_id,actor_user_id,metadata
  ) values (
    'ai.task.created',
    v_task.suggestion_id,
    p_actor_user_id,
    pg_catalog.jsonb_build_object(
      'task_id',v_task.id,
      'risk',v_task.risk,
      'affected_areas',v_task.affected_areas
    )
  );

  return next v_task;
  return;
end;
$create_task$;

revoke all on function public.create_ai_task_with_audit(uuid,uuid,text,text,text,text,text,boolean,text[]) from public, anon, authenticated;
grant execute on function public.create_ai_task_with_audit(uuid,uuid,text,text,text,text,text,boolean,text[]) to service_role;

-- Persist Maestro analysis plans with source provenance and a tamper-evident digest.
-- Reviews, artifact, task state and audit event commit or roll back together.
begin;

create table if not exists public.ai_task_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete restrict,
  artifact_type text not null check (artifact_type = 'maestro_analysis_plan'),
  version integer not null check (version > 0),
  schema_version integer not null check (schema_version = 1),
  artifact jsonb not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(task_id, artifact_type, version)
);

create index if not exists ai_task_artifacts_task_created_idx
  on public.ai_task_artifacts(task_id, created_at desc);

alter table public.ai_task_artifacts enable row level security;
revoke all on public.ai_task_artifacts from public, anon, authenticated, service_role;
grant select on public.ai_task_artifacts to service_role;

create or replace function public.record_ai_task_analysis(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_artifact jsonb,
  p_artifact_sha256 text
) returns table (
  task_id uuid,
  artifact_id uuid,
  artifact_sha256 text,
  task_status text
)
language plpgsql
security definer
set search_path = ''
as $record_analysis$
declare
  v_task public.ai_tasks%rowtype;
  v_artifact_id uuid;
  v_version integer;
  v_report jsonb;
  v_agent text;
  v_result text;
  v_data jsonb;
  v_warnings jsonb;
begin
  if p_task_id is null or p_actor_user_id is null
     or p_status is null or p_status not in ('ANALYZED','FAILED')
     or p_artifact is null or pg_catalog.jsonb_typeof(p_artifact) is distinct from 'object'
     or p_artifact_sha256 is null or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
     or pg_catalog.pg_column_size(p_artifact) > 65536
     or p_artifact->>'taskId' is distinct from p_task_id::text
     or p_artifact->>'createdBy' is distinct from p_actor_user_id::text
     or p_artifact->>'status' is distinct from p_status
     or pg_catalog.jsonb_typeof(p_artifact->'source') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_artifact->'plan') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_artifact->'plan') > 40
     or pg_catalog.jsonb_typeof(p_artifact->'reports') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_artifact->'reports') > 12 then
    raise exception 'Invalid AI analysis artifact';
  end if;

  if not exists (
    select 1 from public.admin_users where user_id = p_actor_user_id
  ) then
    raise exception 'Administrator authorization required';
  end if;

  select * into v_task
  from public.ai_tasks
  where id = p_task_id
  for update;

  if not found then raise exception 'AI task not found'; end if;
  if v_task.status <> 'PROPOSED' or v_task.tainted is not true or v_task.approved is not false then
    raise exception 'AI task is not eligible for initial analysis persistence';
  end if;

  for v_report in
    select value from pg_catalog.jsonb_array_elements(p_artifact->'reports')
  loop
    if pg_catalog.jsonb_typeof(v_report) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_report->'agent') is distinct from 'string'
       or pg_catalog.char_length(v_report->>'agent') not between 1 and 40
       or pg_catalog.jsonb_typeof(v_report->'status') is distinct from 'string'
       or v_report->>'status' not in ('PASS','FAIL','NEEDS_REVIEW','BLOCKED')
       or pg_catalog.jsonb_typeof(v_report->'data') is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_report->'warnings') is distinct from 'array'
       or pg_catalog.jsonb_array_length(v_report->'warnings') > 10 then
      raise exception 'Invalid AI review report';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_report->'warnings') warning(value)
      where pg_catalog.jsonb_typeof(warning.value) <> 'string'
         or pg_catalog.char_length(warning.value #>> '{}') > 240
    ) then
      raise exception 'Invalid AI review warning';
    end if;

    v_agent := v_report->>'agent';
    v_result := v_report->>'status';
    v_data := v_report->'data';
    v_warnings := v_report->'warnings';

    insert into public.ai_reviews(task_id,agent,result,report)
    values (p_task_id,v_agent,v_result,pg_catalog.jsonb_build_object('data',v_data,'warnings',v_warnings));
  end loop;

  select coalesce(pg_catalog.max(version),0)+1 into v_version
  from public.ai_task_artifacts
  where ai_task_artifacts.task_id = p_task_id
    and artifact_type = 'maestro_analysis_plan';

  insert into public.ai_task_artifacts(
    task_id,artifact_type,version,schema_version,artifact,sha256,created_by
  ) values (
    p_task_id,'maestro_analysis_plan',v_version,1,p_artifact,p_artifact_sha256,p_actor_user_id
  ) returning id into v_artifact_id;

  update public.ai_tasks
  set status = p_status, updated_at = pg_catalog.now()
  where id = p_task_id
  returning * into v_task;

  insert into public.ai_audit_events(event_type,actor_user_id,metadata)
  values (
    'ai.analysis.completed',
    p_actor_user_id,
    pg_catalog.jsonb_build_object(
      'task_id',p_task_id,
      'artifact_id',v_artifact_id,
      'artifact_type','maestro_analysis_plan',
      'artifact_version',v_version,
      'artifact_sha256',p_artifact_sha256,
      'status',p_status,
      'review_count',pg_catalog.jsonb_array_length(p_artifact->'reports')
    )
  );

  return query select v_task.id,v_artifact_id,p_artifact_sha256,v_task.status;
end;
$record_analysis$;

revoke all on function public.record_ai_task_analysis(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.record_ai_task_analysis(uuid,uuid,text,jsonb,text) to service_role;

-- Tighten the approval boundary: tainted tasks are never approvable, and each
-- action requires its expected lifecycle state and persisted review evidence.
create or replace function public.record_ai_approval(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_decision text,
  p_reason text default ''
) returns uuid
language plpgsql
security definer
set search_path = ''
as $record_approval$
declare
  v_task public.ai_tasks%rowtype;
  v_approval_id uuid;
begin
  if p_task_id is null or p_actor_user_id is null
     or p_action not in ('IMPLEMENT','MERGE')
     or p_decision not in ('APPROVED','REJECTED')
     or (p_decision = 'REJECTED' and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_reason,''))) = 0)
     or pg_catalog.char_length(coalesce(p_reason,'')) > 1000 then
    raise exception 'Invalid approval request';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_actor_user_id) then
    raise exception 'Administrator authorization required';
  end if;
  select * into v_task from public.ai_tasks where id = p_task_id for update;
  if not found then raise exception 'AI task not found'; end if;
  if v_task.tainted then raise exception 'Tainted tasks cannot be approved'; end if;
  if p_action = 'IMPLEMENT' and v_task.status <> 'WAITING_APPROVAL' then
    raise exception 'Task is not waiting for implementation approval';
  end if;
  if p_action = 'MERGE' and v_task.status <> 'READY_FOR_REVIEW' then
    raise exception 'Task is not ready for human review';
  end if;
  if p_decision = 'APPROVED' and p_action = 'IMPLEMENT' and not exists (
    select 1 from public.ai_reviews where task_id=p_task_id and agent='security' and result='PASS'
  ) then
    raise exception 'A passing security review is required before implementation approval';
  end if;
  if p_decision = 'APPROVED' and p_action = 'MERGE' and (
    not exists (select 1 from public.ai_reviews where task_id=p_task_id and agent='security' and result='PASS')
    or not exists (select 1 from public.ai_reviews where task_id=p_task_id and agent='test' and result='PASS')
    or not exists (select 1 from public.ai_reviews where task_id=p_task_id and agent='verifier' and result='PASS')
  ) then
    raise exception 'Passing security, test and verifier reviews are required before merge approval';
  end if;
  insert into public.ai_approvals(task_id,actor_user_id,action,decision,reason)
  values (p_task_id,p_actor_user_id,p_action,p_decision,pg_catalog.left(coalesce(p_reason,''),1000))
  returning id into v_approval_id;
  if p_action = 'IMPLEMENT' then
    update public.ai_tasks
      set status=case when p_decision='APPROVED' then 'APPROVED' else 'REJECTED' end,
          approved=(p_decision='APPROVED'),approval_id=v_approval_id,updated_at=pg_catalog.now()
      where id=p_task_id;
  else
    update public.ai_tasks
      set status=case when p_decision='APPROVED' then 'HUMAN_APPROVED' else 'REJECTED' end,
          human_approved=(p_decision='APPROVED'),human_approval_id=v_approval_id,updated_at=pg_catalog.now()
      where id=p_task_id;
  end if;
  insert into public.ai_audit_events(event_type,actor_user_id,metadata)
  values (case when p_decision='REJECTED' then 'ai.approval.rejected' else 'ai.approval.granted' end,
    p_actor_user_id,pg_catalog.jsonb_build_object('task_id',p_task_id,'result',p_decision,'action',p_action));
  return v_approval_id;
end;
$record_approval$;
revoke all on function public.record_ai_approval(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_ai_approval(uuid,uuid,text,text,text) to service_role;

commit;
