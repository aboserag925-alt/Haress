-- Match the original intake behavior: a removed Telegram file may be re-uploaded.
begin;
alter table public.media_library_items
  drop constraint if exists media_library_items_file_unique_id_key;
create unique index if not exists media_library_items_active_file_unique_id_idx
  on public.media_library_items (file_unique_id)
  where status <> 'removed';
commit;
