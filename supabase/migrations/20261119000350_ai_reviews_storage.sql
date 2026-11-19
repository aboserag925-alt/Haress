-- Ensure the AI review table exists before record_ai_task_analysis writes reports.
-- Additive and safe for Preview databases where the table was created by an
-- earlier reconciliation migration; no existing review rows are rewritten.
begin;

create table if not exists public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  agent text not null,
  result text not null check (result in ('PASS','FAIL','NEEDS_REVIEW','BLOCKED')),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_reviews_task_created_idx
  on public.ai_reviews(task_id, created_at);

alter table public.ai_reviews enable row level security;
revoke all on public.ai_reviews from public, anon, authenticated;
grant all on public.ai_reviews to service_role;

commit;
