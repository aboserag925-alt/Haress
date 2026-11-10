-- Stage 2 data layer — idempotent migration (WRITTEN ONLY, NEVER EXECUTED
-- from this repository; applying it is an owner action on the Supabase
-- Dashboard / SQL Editor).
--
-- Safety notes (documented in docs/ARCHITECTURE.md):
--   * Every existence-changing statement is idempotent:
--       - `create table if not exists`
--       - `drop policy if exists` directly followed by `create policy` for
--         the SAME table, the same pattern already used by supabase/schema.sql
--       - The only change to an already-live table (`lectures`) is a guarded,
--         additive `add column` that is skipped when the column exists.
--         NO existing RLS policy on lectures/admin_users/user_data is altered,
--         dropped, or recreated.
--   * `audience_questions` was checked before writing this migration: it is
--     NOT part of supabase/schema.sql in this repository, and this migration
--     does not reference or touch it. If it exists in production, inspecting
--     it there is an owner action (never repo-side SQL).
--   * No data statements: no TRUNCATE / UPDATE / DELETE / INSERT of real data.
--   * Writes are NOT allowed for browsers: public roles get SELECT only, and
--     only for published/visible rows. Admin writes go exclusively through
--     the service_role from the Node server (which authorizes admins via
--     admin_users server-side) — exactly the existing pattern. This keeps the
--     existing security boundary: "no browser role can grant itself admin".

-- ---------------------------------------------------------------------------
-- series (new table)
-- ---------------------------------------------------------------------------
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 120),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.series enable row level security;
revoke all on public.series from anon, authenticated, public;
grant all on public.series to service_role;
grant select on public.series to anon, authenticated;

drop policy if exists "Public can read published series" on public.series;
create policy "Public can read published series"
  on public.series for select to anon, authenticated
  using (status = 'published');

create index if not exists series_status_idx on public.series (status, created_at desc);

-- ---------------------------------------------------------------------------
-- series_id on lectures (existing table; guarded ADD COLUMN only)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lectures'
      and column_name = 'series_id'
  ) then
    raise notice 'lectures.series_id already exists — skipped';
  else
    alter table public.lectures
      add column series_id uuid references public.series(id)
      on delete set null;
  end if;
end
$$;

create index if not exists lectures_series_idx
  on public.lectures (series_id)
  where series_id is not null;

-- ---------------------------------------------------------------------------
-- articles (new table)
-- ---------------------------------------------------------------------------
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 160),
  title text not null check (char_length(trim(title)) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 600),
  body text not null default '' check (char_length(body) <= 100000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.articles enable row level security;
revoke all on public.articles from anon, authenticated, public;
grant all on public.articles to service_role;
grant select on public.articles to anon, authenticated;

drop policy if exists "Public can read published articles" on public.articles;
create policy "Public can read published articles"
  on public.articles for select to anon, authenticated
  using (status = 'published');

create index if not exists articles_status_idx
  on public.articles (published_at desc nulls last)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- books (new table)
-- ---------------------------------------------------------------------------
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 160),
  title text not null check (char_length(trim(title)) between 1 and 200),
  author text not null default '' check (char_length(author) <= 120),
  description text not null default '' check (char_length(description) <= 4000),
  cover_url text check (cover_url is null or char_length(cover_url) <= 1000),
  file_url text check (file_url is null or char_length(file_url) <= 1000),
  language text not null default 'ar' check (char_length(language) <= 12),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.books enable row level security;
revoke all on public.books from anon, authenticated, public;
grant all on public.books to service_role;
grant select on public.books to anon, authenticated;

drop policy if exists "Public can read published books" on public.books;
create policy "Public can read published books"
  on public.books for select to anon, authenticated
  using (status = 'published');

create index if not exists books_status_idx
  on public.books (published_at desc nulls last)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- quran_items (new table — recitations/pages of the Quran section)
-- ---------------------------------------------------------------------------
create table if not exists public.quran_items (
  id uuid primary key default gen_random_uuid(),
  item_kind text not null default 'recitation'
    check (item_kind in ('recitation', 'surah', 'juz', 'page')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  reciter text not null default '' check (char_length(reciter) <= 120),
  surah_number integer check (surah_number is null or surah_number between 1 and 114),
  audio_url text check (audio_url is null or char_length(audio_url) <= 1000),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quran_items enable row level security;
revoke all on public.quran_items from anon, authenticated, public;
grant all on public.quran_items to service_role;
grant select on public.quran_items to anon, authenticated;

drop policy if exists "Public can read published quran_items" on public.quran_items;
create policy "Public can read published quran_items"
  on public.quran_items for select to anon, authenticated
  using (status = 'published');

create index if not exists quran_items_status_idx
  on public.quran_items (item_kind, published_at desc nulls last)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- forum_threads (new table)
-- ---------------------------------------------------------------------------
create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 20000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.forum_threads enable row level security;
revoke all on public.forum_threads from anon, authenticated, public;
grant all on public.forum_threads to service_role;
grant select on public.forum_threads to anon, authenticated;

-- Public read = visible threads only. Writes = service_role (admins) only.
drop policy if exists "Public can read visible forum_threads" on public.forum_threads;
create policy "Public can read visible forum_threads"
  on public.forum_threads for select to anon, authenticated
  using (status = 'visible');

drop policy if exists "Members can read own forum_threads" on public.forum_threads;
create policy "Members can read own forum_threads"
  on public.forum_threads for select to authenticated
  using (author_id = (select auth.uid()));

create index if not exists forum_threads_status_idx
  on public.forum_threads (created_at desc)
  where status = 'visible';
create index if not exists forum_threads_author_idx
  on public.forum_threads (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- forum_posts (new table)
-- ---------------------------------------------------------------------------
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 20000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.forum_posts enable row level security;
revoke all on public.forum_posts from anon, authenticated, public;
grant all on public.forum_posts to service_role;
grant select on public.forum_posts to anon, authenticated;

drop policy if exists "Public can read visible forum_posts" on public.forum_posts;
create policy "Public can read visible forum_posts"
  on public.forum_posts for select to anon, authenticated
  using (status = 'visible');

drop policy if exists "Members can read own forum_posts" on public.forum_posts;
create policy "Members can read own forum_posts"
  on public.forum_posts for select to authenticated
  using (author_id = (select auth.uid()));

create index if not exists forum_posts_thread_idx
  on public.forum_posts (thread_id, created_at)
  where status = 'visible';
create index if not exists forum_posts_author_idx
  on public.forum_posts (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- site_settings (new table; public config key/value)
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  key text primary key check (char_length(key) between 1 and 120),
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated, public;
grant all on public.site_settings to service_role;
grant select on public.site_settings to anon, authenticated;

drop policy if exists "Public can read site_settings" on public.site_settings;
create policy "Public can read site_settings"
  on public.site_settings for select to anon, authenticated
  using (true);
