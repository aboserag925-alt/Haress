-- Questions, moderator review and published answers.
-- The Gemini draft and the asker's Telegram id stay server-side. Browsers read published answers
-- only through the server endpoint GET /api/answers, which selects id, question, answer, published_at.

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('web', 'telegram')),
  question text not null check (char_length(question) between 5 and 1600),
  draft text,
  status text not null default 'pending' check (status in ('pending', 'review', 'published', 'rejected')),
  answer text check (answer is null or char_length(answer) <= 4000),
  answer_source text check (answer_source in ('draft', 'admin')),
  asker_telegram_id bigint,
  answered_by bigint,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.question_messages (
  chat_id bigint not null,
  message_id bigint not null,
  question_id uuid not null references public.questions(id) on delete cascade,
  kind text not null check (kind in ('question', 'edit_prompt')),
  primary key (chat_id, message_id)
);

create index if not exists questions_published_idx on public.questions (published_at desc)
  where status = 'published';

alter table public.questions enable row level security;
alter table public.question_messages enable row level security;
revoke all on public.questions, public.question_messages from anon, authenticated, public;
grant all on public.questions, public.question_messages to service_role;
