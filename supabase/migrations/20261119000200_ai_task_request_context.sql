-- Preserve the original task request alongside its review lifecycle.
-- Additive and safe for existing task rows; no existing data is rewritten.
begin;
alter table public.ai_tasks add column if not exists task_type text;
alter table public.ai_tasks add column if not exists title text;
alter table public.ai_tasks add column if not exists description text;
alter table public.ai_tasks
  add constraint ai_tasks_task_type_check
  check (task_type is null or task_type in ('suggestion','security','implementation','ux','content','performance','product'));
commit;
