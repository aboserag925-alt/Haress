'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const migration=fs.readFileSync(path.join(__dirname,'migrations','202611140001_suggestions_ai_storage.sql'),'utf8');

test('suggestions and AI storage migration creates the required service-side tables',()=>{
  for(const table of ['suggestions','ai_tasks','ai_reviews','ai_approvals','ai_audit_events']){
    assert.match(migration,new RegExp('create table if not exists public\\.'+table+'\\b','i'));
    assert.match(migration,new RegExp('alter table public\\.'+table+' enable row level security','i'));
  }
});

test('AI tasks are tainted by default and approval RPC refuses tainted tasks',()=>{
  assert.match(migration,/tainted boolean not null default true/i);
  assert.match(migration,/if v_task\.tainted then raise exception 'Tainted tasks cannot be approved'/i);
});

test('all workflow tables are closed to browser roles and granted only to service_role',()=>{
  assert.match(migration,/revoke all on public\.suggestions, public\.ai_tasks, public\.ai_reviews, public\.ai_approvals, public\.ai_audit_events from public, anon, authenticated/i);
  assert.match(migration,/grant all on public\.suggestions, public\.ai_tasks, public\.ai_reviews, public\.ai_approvals, public\.ai_audit_events to service_role/i);
  assert.match(migration,/grant execute on function public\.record_ai_approval\(uuid,uuid,text,text,text\) to service_role/i);
  assert.match(migration,/revoke all on function public\.record_ai_approval\(uuid,uuid,text,text,text\) from public, anon, authenticated/i);
});

test('approval RPC validates administrator, task state, action and rejection reason',()=>{
  for(const phrase of ['Administrator authorization required','AI task not found','Task is not waiting for implementation approval','Task is not ready for human review','A reason is required when rejecting an approval']){
    assert.ok(migration.includes(phrase),phrase);
  }
  assert.match(migration,/security definer\s+set search_path = ''/i);
});

test('migration is transactional and does not destructively drop existing data',()=>{
  assert.match(migration,/^\\s*(?:--[^\\n]*\\n\\s*)*begin;/i);
  assert.match(migration,/commit;\s*$/i);
  assert.doesNotMatch(migration,/\b(drop table|truncate|delete from)\b/i);
});
