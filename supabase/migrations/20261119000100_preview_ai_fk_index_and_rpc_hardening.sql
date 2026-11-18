-- Harden the legacy suggestion quota RPC and reconcile indexes introduced
-- by the AI approval references. Safe to re-run on an existing Preview schema.
begin;

create index if not exists ai_tasks_approval_id_idx
  on public.ai_tasks(approval_id);
create index if not exists ai_tasks_human_approval_id_idx
  on public.ai_tasks(human_approval_id);

-- The older baseline already owns an identical created_at index.
drop index if exists public.suggestions_created_at_idx;

alter function public.consume_suggestion_daily_cap(date, integer)
  set search_path = '';
revoke all on function public.consume_suggestion_daily_cap(date, integer)
  from public, anon, authenticated;
grant execute on function public.consume_suggestion_daily_cap(date, integer)
  to service_role;

commit;
