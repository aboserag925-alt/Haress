-- Daily content (dhikr / hadith / benefit). Written by moderators only, never generated automatically.
-- A row is published only when it has a source and a reviewer.

create table if not exists public.daily_content (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('ذكر', 'حديث', 'فائدة')),
  text text not null check (char_length(trim(text)) between 1 and 3000),
  -- Book and number, or the grading for a hadith. Rows without a source are never published.
  source text not null check (char_length(trim(source)) > 0),
  -- Telegram user id of the moderator who reviewed and added the row.
  reviewed_by bigint not null,
  publish_at timestamptz not null,
  state text not null default 'scheduled' check (state in ('scheduled', 'claiming', 'sent')),
  claimed_at timestamptz,
  published_at timestamptz,
  -- Cairo calendar date of the post. The partial unique index allows at most one daily post per day.
  post_date date,
  created_at timestamptz not null default now()
);

create unique index if not exists daily_content_one_per_day
  on public.daily_content (post_date) where post_date is not null;

alter table public.daily_content enable row level security;
revoke all on public.daily_content from anon, authenticated, public;
grant all on public.daily_content to service_role;
