
alter table public.lectures
  add column if not exists ends_at timestamptz,
  add column if not exists platform text default 'telegram',
  add column if not exists is_live boolean not null default false;

create table if not exists public.lecture_attendance (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'present' check (status in ('present','late','excused','absent')),
  joined_at timestamptz,
  minutes_attended integer not null default 0 check (minutes_attended >= 0),
  note text not null default '',
  source text not null default 'manual' check (source in ('manual','telegram','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lecture_id, user_id)
);
create index if not exists lecture_attendance_user_idx on public.lecture_attendance (user_id);

create table if not exists public.reward_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid references public.lectures(id) on delete set null,
  points integer not null,
  reason text not null default '',
  awarded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists reward_points_user_idx on public.reward_points (user_id);

create table if not exists public.badges (
  code text primary key,
  kind text not null default 'rank' check (kind in ('rank','badge')),
  name text not null,
  description text not null default '',
  emoji text not null default '',
  min_points integer not null default 0,
  min_discipline numeric(5,1) not null default 0,
  sort_order integer not null default 0
);

insert into public.badges (code, kind, name, description, emoji, min_points, min_discipline, sort_order) values
  ('rank_beginner', 'rank', 'مبتدئ', 'بداية الطريق', '🌱', 0, 0, 10),
  ('rank_regular', 'rank', 'منتظم', 'يحضر بانتظام', '📗', 50, 0, 20),
  ('rank_steady', 'rank', 'مواظب', 'مواظبة واضحة على المحاضرات', '📘', 120, 0, 30),
  ('rank_keen', 'rank', 'حريص', 'حرص على العلم والحضور', '📙', 250, 0, 40),
  ('rank_guard', 'rank', 'حارس', 'من حراس المجلس', '🛡️', 450, 0, 50),
  ('rank_senior_guard', 'rank', 'حارس أول', 'أعلى الرتب في المجلس', '🏅', 700, 0, 60),
  ('badge_perfect', 'badge', 'حضور كامل', 'ما غاب عن محاضرة محسوبة', '✅', 0, 100, 70),
  ('badge_committed', 'badge', 'ملتزم', 'انضباط ٩٠٪ أو أكثر', '⭐', 0, 90, 80),
  ('badge_active', 'badge', 'نشيط', 'شارك وحضر ١٠ محاضرات على الأقل', '🔥', 100, 0, 90)
on conflict (code) do nothing;

create or replace view public.member_discipline as
select
  a.user_id,
  count(*) filter (where a.status <> 'excused')::int as counted_lectures,
  count(*) filter (where a.status = 'present')::int as present_count,
  count(*) filter (where a.status = 'late')::int as late_count,
  count(*) filter (where a.status = 'absent')::int as absent_count,
  count(*) filter (where a.status = 'excused')::int as excused_count,
  round(
    100.0 * (count(*) filter (where a.status = 'present') + 0.75 * count(*) filter (where a.status = 'late'))
    / nullif(count(*) filter (where a.status <> 'excused'), 0)
  , 1) as discipline_pct
from public.lecture_attendance a
group by a.user_id;

create or replace view public.member_progress as
select
  p.*,
  coalesce((
    select b.name from public.badges b
    where b.kind = 'rank' and p.total_points >= b.min_points
    order by b.min_points desc limit 1
  ), 'مبتدئ') as rank_name,
  coalesce((
    select b.code from public.badges b
    where b.kind = 'rank' and p.total_points >= b.min_points
    order by b.min_points desc limit 1
  ), 'rank_beginner') as rank_code,
  coalesce((
    select array_agg(b.code order by b.sort_order) from public.badges b
    where b.kind = 'badge'
      and p.total_points >= b.min_points
      and coalesce(p.discipline_pct, 0) >= b.min_discipline
  ), '{}'::text[]) as badge_codes
from (
  select
    d.*,
    (d.present_count * 10 + d.late_count * 5
      + coalesce((select sum(r.points) from public.reward_points r where r.user_id = d.user_id), 0))::int as total_points
  from public.member_discipline d
) p;

alter table public.lecture_attendance enable row level security;
alter table public.reward_points enable row level security;
alter table public.badges enable row level security;

drop policy if exists "Users read own attendance" on public.lecture_attendance;
create policy "Users read own attendance" on public.lecture_attendance
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Admins manage attendance" on public.lecture_attendance;
create policy "Admins manage attendance" on public.lecture_attendance
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

drop policy if exists "Users read own points" on public.reward_points;
create policy "Users read own points" on public.reward_points
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Admins manage points" on public.reward_points;
create policy "Admins manage points" on public.reward_points
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

drop policy if exists "Anyone reads badges" on public.badges;
create policy "Anyone reads badges" on public.badges
  for select to anon, authenticated using (true);

grant select on public.member_discipline to authenticated;
grant select on public.member_progress to authenticated;
grant select on public.badges to anon, authenticated;
