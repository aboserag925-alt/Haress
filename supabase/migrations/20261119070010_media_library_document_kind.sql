-- Preserve the existing media kind vocabulary used by Telegram intake.
begin;
alter table public.media_library_items
  drop constraint if exists media_library_items_kind_check;
alter table public.media_library_items
  add constraint media_library_items_kind_check
  check (kind in ('audio','video','document','image','other'));
commit;
