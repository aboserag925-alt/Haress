'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, 'migrations', '20261119080000_telegram_link_deliveries.sql'), 'utf8');

test('Telegram link delivery ledger is service-role-only with RLS enabled', () => {
  assert.match(migration, /create table if not exists public\.telegram_link_deliveries/i);
  assert.match(migration, /alter table public\.telegram_link_deliveries enable row level security/i);
  assert.match(migration, /revoke all on public\.telegram_link_deliveries from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.telegram_link_deliveries to service_role/i);
  assert.match(migration, /source_key text not null unique/i);
  assert.match(migration, /source_type in \('group_message', 'website_lecture'\)/i);
  assert.match(migration, /^(?:\\s*--[^\\n]*\\n)*\\s*begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});

test('Telegram link bot is configured as a public webhook with its own secret validation', () => {
  const config = fs.readFileSync(path.join(__dirname, 'config.toml'), 'utf8');
  const fn = fs.readFileSync(path.join(__dirname, 'functions', 'telegram-link-bot', 'index.ts'), 'utf8');
  assert.match(config, /\[functions\.telegram-link-bot\]\s*\nverify_jwt = false/i);
  assert.match(fn, /x-telegram-bot-api-secret-token/i);
  assert.match(fn, /TELEGRAM_DOCTOR_USER_IDS/);
  assert.match(fn, /admin_users/);
  assert.match(fn, /telegram_link_deliveries/);
  assert.match(fn, /status.*published|eq\("status", "published"\)/i);
  assert.doesNotMatch(fn, /console\.(log|error)\([^\n]*(BOT_TOKEN|WEBHOOK_SECRET|SERVICE_ROLE)/i);
});
