-- Recovered verbatim from Production PostgreSQL statement logs.
-- Applied at 2026-11-18 17:25:18 UTC; SQLSTATE 00000.
-- Preserve original semantics; do not reapply to Production.
alter table public.ai_tasks
  add column if not exists approval_id uuid references public.ai_approvals(id) on delete set null;

create index if not exists ai_tasks_approval_id_idx on public.ai_tasks(approval_id);

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

  if not exists (select 1 from public.admin_users a where a.user_id = p_actor_user_id) then
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
      approval_id = case when p_action = 'IMPLEMENT' then v_approval_id else approval_id end,
      human_approved = (p_action = 'MERGE' and p_decision = 'APPROVED'),
      human_approval_id = case when p_action = 'MERGE' then v_approval_id else human_approval_id end,
      status = case when p_decision = 'REJECTED' then 'REJECTED' else status end,
      updated_at = now()
  where id = p_task_id;

  return v_approval_id;
end;
$function$;

revoke all on function public.record_ai_approval(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_ai_approval(uuid,uuid,text,text,text) to service_role;
