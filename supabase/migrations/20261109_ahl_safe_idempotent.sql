-- إستراحة أهل الأثر — ترحيل آمن idempotent (لا يُطبّق تلقائيًا).
-- المصدر: supabase/schema.sql بعد مراجعة سطر سطر.
-- مراجعة: لا يوجد DROP TABLE / TRUNCATE / DELETE / DROP COLUMN / ALTER TYPE.
-- كل العمليات: CREATE TABLE IF NOT EXISTS + ENABLE RLS + REVOKE/GRANT + DROP POLICY IF EXISTS + CREATE POLICY.
-- آمن للتشغيل أكثر من مرة؛ لا يمس بيانات قائمة ولا يحذف صفوفًا.
-- جدول جديد audience_questions يُضاف هنا فقط (لا يغيّر RLS قائمة).
-- لا تنفذ هذا على المشروع المباشر من الوكيل؛ نفّذه يدويًا بعد مراجعة المالك.

-- ===== user_data (مصادق فقط، صفوفه الخاصة) =====
create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;
-- Revoke every existing authenticated privilege first (including DELETE/TRUNCATE),
-- then grant only the operations protected by the row-level policies below.
revoke all on table public.user_data from anon, authenticated, public;
grant select, insert, update on table public.user_data to authenticated;
drop policy if exists "Users can read their own data" on public.user_data;
create policy "Users can read their own data"
  on public.user_data for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own data" on public.user_data;
create policy "Users can insert their own data"
  on public.user_data for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own data" on public.user_data;
create policy "Users can update their own data"
  on public.user_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ===== admin_users (service_role فقط) =====
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated, public;
grant all on public.admin_users to service_role;

-- ===== lectures (قراءة المنشور فقط للعامة؛ الكتابة للمشرف عبر service_role) =====
create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  starts_at timestamptz,
  category text not null default 'محاضرة' check (char_length(category) <= 80),
  stream_url text,
  recording_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lectures enable row level security;
revoke all on public.lectures from anon, authenticated, public;
grant all on public.lectures to service_role;
grant select on public.lectures to anon, authenticated;
drop policy if exists "Public can read published lectures" on public.lectures;
create policy "Public can read published lectures"
  on public.lectures for select to anon, authenticated using (status = 'published');

-- ===== audience_questions (طابور أسئلة الجمهور — إدخال مجهول، قراءة service_role فقط) =====
-- الواجهة/الخادم يقتحلان عبر service_role (الخادم) أو anon insert فقط هنا.
-- النص مخزّن plain-text ويُعرض عبر textContent فقط (لا HTML) لمنع XSS.
create table if not exists public.audience_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(trim(question)) between 5 and 1600),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.audience_questions enable row level security;
revoke all on public.audience_questions from anon, authenticated, public;
grant all on public.audience_questions to service_role;
grant insert on public.audience_questions to anon, authenticated;
drop policy if exists "Anyone can submit a question" on public.audience_questions;
create policy "Anyone can submit a question"
  on public.audience_questions for insert to anon, authenticated
  with check (char_length(trim(question)) between 5 and 1600 and status = 'pending');
-- لا توجد سياسة SELECT للعامة: لا تُقرأ الأسئلة علنًا أبدًا (service_role فقط عبر الخادم/الإدارة).
