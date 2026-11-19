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

  if p_actor_user_id is null or not exists (
    select 1 from public.admin_users where user_id = p_actor_user_id
  ) then
    raise exception 'Administrator authorization required';
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

commit;
