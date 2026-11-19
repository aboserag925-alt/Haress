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
     or p_status not in ('ANALYZED','FAILED')
     or p_artifact is null or pg_catalog.jsonb_typeof(p_artifact) <> 'object'
     or p_artifact_sha256 is null or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
     or pg_catalog.pg_column_size(p_artifact) > 65536
     or p_artifact->>'taskId' <> p_task_id::text
     or p_artifact->>'createdBy' <> p_actor_user_id::text
     or p_artifact->>'status' <> p_status
     or pg_catalog.jsonb_typeof(p_artifact->'source') <> 'object'
     or pg_catalog.jsonb_typeof(p_artifact->'plan') <> 'array'
     or pg_catalog.jsonb_array_length(p_artifact->'plan') > 40
     or pg_catalog.jsonb_typeof(p_artifact->'reports') <> 'array'
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
    if pg_catalog.jsonb_typeof(v_report) <> 'object'
       or pg_catalog.jsonb_typeof(v_report->'agent') <> 'string'
       or pg_catalog.char_length(v_report->>'agent') not between 1 and 40
       or pg_catalog.jsonb_typeof(v_report->'status') <> 'string'
       or v_report->>'status' not in ('PASS','FAIL','NEEDS_REVIEW','BLOCKED')
       or pg_catalog.jsonb_typeof(v_report->'data') <> 'object'
       or pg_catalog.jsonb_typeof(v_report->'warnings') <> 'array'
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

commit;
