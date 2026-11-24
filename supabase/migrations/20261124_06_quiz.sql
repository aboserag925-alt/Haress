-- Daily quiz. Questions are written and reviewed by group admins only. Server-only (service_role).

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(trim(question)) between 1 and 300),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct_index integer not null check (correct_index between 0 and 3),
  explanation text not null check (char_length(trim(explanation)) between 1 and 1500),
  -- Telegram user id of the admin who wrote and reviewed the question.
  reviewed_by bigint not null,
  publish_at timestamptz not null,
  reveal_at timestamptz not null,
  state text not null default 'scheduled' check (state in ('scheduled', 'claiming', 'posted', 'revealing', 'revealed')),
  claimed_at timestamptz,
  message_id bigint,
  created_at timestamptz not null default now(),
  check (reveal_at > publish_at)
);

create table if not exists public.quiz_answers (
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  telegram_user_id bigint not null,
  display_name text,
  choice_index integer not null check (choice_index between 0 and 3),
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  -- One answer per person per quiz.
  primary key (quiz_id, telegram_user_id)
);

create index if not exists quiz_answers_week on public.quiz_answers (answered_at) where is_correct;

alter table public.quizzes enable row level security;
alter table public.quiz_answers enable row level security;
revoke all on public.quizzes, public.quiz_answers from anon, authenticated, public;
grant all on public.quizzes, public.quiz_answers to service_role;
