-- Restore database-enforced AI approval guards after recovered production
-- migrations replaced the original state and taint checks.
-- This migration is additive and does not change existing rows or permissions.
begin;

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
  v_task public.ai_tasks%rowtype;
  v_approval_id uuid;
  v_reason text := coalesce(p_reason, '');
begin
  if p_task_id is null
     or p_actor_user_id is null
     or p_action is null
     or p_decision is null
     or p_action not in ('IMPLEMENT', 'MERGE')
     or p_decision not in ('APPROVED', 'REJECTED')
     or pg_catalog.char_length(v_reason) > 1000
     or (p_decision = 'REJECTED' and pg_catalog.char_length(pg_catalog.btrim(v_reason)) = 0) then
    raise exception 'Invalid approval request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.admin_users a
    where a.user_id = p_actor_user_id
  ) then
    raise exception 'Actor is not an authorized administrator' using errcode = '42501';
  end if;

  select t.*
  into v_task
  from public.ai_tasks t
  where t.id = p_task_id
  for update;

  if not found then
    raise exception 'AI task not found' using errcode = 'P0002';
  end if;

  if v_task.tainted is distinct from false then
    raise exception 'Tainted tasks cannot be approved' using errcode = '42501';
  end if;

  if p_action = 'IMPLEMENT' and v_task.status <> 'WAITING_APPROVAL' then
    raise exception 'Task is not waiting for implementation approval' using errcode = '55000';
  end if;

  if p_action = 'MERGE' and v_task.status <> 'READY_FOR_REVIEW' then
    raise exception 'Task is not ready for human review' using errcode = '55000';
  end if;

  -- Keep each decision as an immutable approval row. The base schema
  -- does not guarantee a unique (task_id, action) constraint.
  insert into public.ai_approvals(task_id, actor_user_id, action, decision, reason)
  values (p_task_id, p_actor_user_id, p_action, p_decision, v_reason)
  returning id into v_approval_id;

  if p_action = 'IMPLEMENT' then
    update public.ai_tasks
    set approved = (p_decision = 'APPROVED'),
        approval_id = v_approval_id,
        status = case
          when p_decision = 'APPROVED' then 'APPROVED'
          else 'REJECTED'
        end,
        updated_at = pg_catalog.now()
    where id = p_task_id;
  else
    update public.ai_tasks
    set human_approved = (p_decision = 'APPROVED'),
        human_approval_id = v_approval_id,
        status = case
          when p_decision = 'APPROVED' then 'HUMAN_APPROVED'
          else 'REJECTED'
        end,
        updated_at = pg_catalog.now()
    where id = p_task_id;
  end if;

  insert into public.ai_audit_events(event_type, actor_user_id, metadata)
  values (
    case
      when p_decision = 'REJECTED' then 'ai.approval.rejected'
      else 'ai.approval.granted'
    end,
    p_actor_user_id,
    pg_catalog.jsonb_build_object(
      'task_id', p_task_id,
      'approval_id', v_approval_id,
      'action', p_action,
      'decision', p_decision,
      'reason', v_reason
    )
  );

  return v_approval_id;
end;
$function$;

revoke all on function public.record_ai_approval(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_ai_approval(uuid, uuid, text, text, text)
  to service_role;

commit;
