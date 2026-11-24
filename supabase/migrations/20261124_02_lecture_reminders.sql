-- Lecture reminders: de-duplication log and optional private subscribers.
-- Only the server (service_role) reads or writes these tables. No browser role has access.

create table if not exists public.sent_reminders (
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  kind text not null check (kind in ('hour', 'start')),
  -- The lecture start time the reminder was sent for. A changed start time produces a new row,
  -- so a rescheduled lecture is reminded again for the new time.
  starts_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (lecture_id, kind, starts_at)
);

create table if not exists public.subscribers (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  subscribed_at timestamptz not null default now(),
  blocked boolean not null default false
);

alter table public.sent_reminders enable row level security;
alter table public.subscribers enable row level security;
revoke all on public.sent_reminders, public.subscribers from anon, authenticated, public;
grant all on public.sent_reminders, public.subscribers to service_role;
