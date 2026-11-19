-- Durable metadata for Telegram-reviewed media. Objects remain in the private haress-media bucket.
begin;

create table if not exists public.media_library_items (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 180),
  category text not null check (category in ('audio','video','books','images','other')),
  kind text not null check (kind in ('audio','video','books','image','other')),
  mime_type text not null check (char_length(mime_type) between 1 and 160),
  file_name text not null check (char_length(file_name) between 1 and 180),
  file_unique_id text not null unique,
  object_key text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected','removed')),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  removed_at timestamptz
);

create index if not exists media_library_items_public_idx
  on public.media_library_items (uploaded_at desc)
  where status = 'approved';

create index if not exists media_library_items_pending_idx
  on public.media_library_items (uploaded_at asc)
  where status = 'pending';

create table if not exists public.media_library_state (
  singleton boolean primary key default true check (singleton),
  telegram_update_offset bigint,
  updated_at timestamptz not null default now()
);

alter table public.media_library_items enable row level security;
alter table public.media_library_state enable row level security;
revoke all on public.media_library_items from public, anon, authenticated;
revoke all on public.media_library_state from public, anon, authenticated;
grant all on public.media_library_items to service_role;
grant all on public.media_library_state to service_role;

commit;
