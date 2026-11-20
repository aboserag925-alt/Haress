
alter table public.ai_tasks
  alter column requires_approval set default true,
  alter column tainted set default true,
  alter column source set default 'suggestion';
