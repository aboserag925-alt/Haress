-- Group moderation warnings. Server-only (service_role); no browser role has access.

create table if not exists public.member_warnings (
  chat_id bigint not null,
  telegram_user_id bigint not null,
  warnings integer not null default 0 check (warnings >= 0),
  updated_at timestamptz not null default now(),
  primary key (chat_id, telegram_user_id)
);

alter table public.member_warnings enable row level security;
revoke all on public.member_warnings from anon, authenticated, public;
grant all on public.member_warnings to service_role;
