-- Track Telegram link deliveries so webhook retries do not repost the same source.
begin;

create table if not exists public.telegram_link_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (char_length(source_key) between 1 and 500),
  source_type text not null check (source_type in ('group_message', 'website_lecture')),
  source_ref text not null,
  url_count integer not null check (url_count > 0 and url_count <= 20),
  delivered_at timestamptz not null default now()
);

alter table public.telegram_link_deliveries enable row level security;
revoke all on public.telegram_link_deliveries from public, anon, authenticated;
grant all on public.telegram_link_deliveries to service_role;

comment on table public.telegram_link_deliveries is
  'Service-only idempotency ledger for doctor links posted by the Haress Telegram bot.';

commit;
