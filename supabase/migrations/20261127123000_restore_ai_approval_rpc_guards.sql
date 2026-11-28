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
  v_existing_actor_user_id uuid;
  v_existing_decision text;
  v_has_existing boolean := false;
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

  -- Reuse the latest approval row when one exists. The recovered historical
  -- migrations used CREATE TABLE IF NOT EXISTS, so older installations may not
  -- have the task/action unique constraint. Lock the task above to serialize
  -- concurrent decisions for this task without depending on that constraint.
  select a.id, a.actor_user_id, a.decision
  into v_approval_id, v_existing_actor_user_id, v_existing_decision
  from public.ai_approvals a
  where a.task_id = p_task_id
    and a.action = p_action
  order by a.created_at desc, a.id desc
  limit 1
  for update;
  v_has_existing := found;

  -- A retry after a committed decision is idempotent only for the same
  -- administrator and the same decision. A different actor or decision must
  -- not reopen or reverse a task that has already left its approval state.
  if p_action = 'IMPLEMENT' and v_task.status <> 'WAITING_APPROVAL' then
    if not (
      v_has_existing
      and v_existing_actor_user_id = p_actor_user_id
      and v_existing_decision = p_decision
      and (
        (v_task.status = 'APPROVED' and p_decision = 'APPROVED')
        or (v_task.status = 'REJECTED' and p_decision = 'REJECTED')
      )
    ) then
      raise exception 'Task is not waiting for implementation approval' using errcode = '55000';
    end if;
  end if;

  if p_action = 'MERGE' and v_task.status <> 'READY_FOR_REVIEW' then
    if not (
      v_has_existing
      and v_existing_actor_user_id = p_actor_user_id
      and v_existing_decision = p_decision
      and (
        (v_task.status = 'HUMAN_APPROVED' and p_decision = 'APPROVED')
        or (v_task.status = 'REJECTED' and p_decision = 'REJECTED')
      )
    ) then
      raise exception 'Task is not ready for human review' using errcode = '55000';
    end if;
  end if;

  if v_has_existing then
    update public.ai_approvals
    set actor_user_id = p_actor_user_id,
        decision = p_decision,
        reason = v_reason,
        created_at = pg_catalog.now()
    where id = v_approval_id;
  else
    insert into public.ai_approvals(task_id, actor_user_id, action, decision, reason)
    values (p_task_id, p_actor_user_id, p_action, p_decision, v_reason)
    returning id into v_approval_id;
  end if;

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
