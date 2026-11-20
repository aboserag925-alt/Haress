
create index if not exists suggestions_user_id_idx on public.suggestions(user_id);
create index if not exists ai_approvals_actor_user_id_idx on public.ai_approvals(actor_user_id);
create index if not exists ai_audit_events_actor_user_id_idx on public.ai_audit_events(actor_user_id);
create index if not exists ai_tasks_human_approval_id_idx on public.ai_tasks(human_approval_id);
