-- Keep newly created AI tasks untrusted and approval-gated by default.
-- Existing rows are intentionally unchanged.
alter table public.ai_tasks
  alter column requires_approval set default true,
  alter column tainted set default true,
  alter column source set default 'suggestion';
