'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const migration=fs.readFileSync(path.join(__dirname,'migrations','202611140001_suggestions_ai_storage.sql'),'utf8');

test('suggestions and AI storage migration creates the required service-side tables',()=>{
  for(const table of ['suggestions','ai_tasks','ai_reviews','ai_approvals','ai_audit_events']){
    assert.ok(migration.includes('create table if not exists public.'+table),'missing table '+table);
    assert.ok(migration.includes('alter table public.'+table+' enable row level security'),'RLS missing for '+table);
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
  assert.match(migration,/^\s*(?:--[^\n]*\n\s*)*begin;/i);
  assert.match(migration,/commit;\s*$/i);
  assert.doesNotMatch(migration,/\b(drop table|truncate|delete from)\b/i);
});

const questionCap = fs.readFileSync(path.join(__dirname,'migrations','002_question_daily_cap.sql'),'utf8');
const suggestionCap = fs.readFileSync(path.join(__dirname,'migrations','20261118204702_suggestion_daily_cap.sql'),'utf8');
const triggerMigration = fs.readFileSync(path.join(__dirname,'migrations','20261118203913_set_updated_at_search_path.sql'),'utf8');
const submitFunction = fs.readFileSync(path.join(__dirname,'functions','submit-suggestion','index.ts'),'utf8');
const adminOperations = fs.readFileSync(path.join(__dirname,'functions','admin-operations','index.ts'),'utf8');

test('the canonical AI storage migration is unique and keeps tasks tainted by default',()=>{
  const files=fs.readdirSync(path.join(__dirname,'migrations'));
  assert.ok(files.includes('202611140001_suggestions_ai_storage.sql'));
  assert.ok(!files.includes('001_initial_schema.sql'));
  assert.ok(!files.includes('20261118203904_haress_admin_api_tables.sql'));
  assert.match(migration,/tainted boolean not null default true/i);
});

test('every SECURITY DEFINER migration function uses an empty search_path',()=>{
  for(const [name,sql] of [['AI storage',migration],['question cap',questionCap],['suggestion cap',suggestionCap]]){
    assert.match(sql,/security definer\s+set search_path = ''/i, name+' must pin an empty search_path');
    const paths = [...sql.matchAll(/security definer\s+set search_path\s*=\s*([^;\n]+)/gi)];
    assert.ok(paths.length > 0, name+' must contain a SECURITY DEFINER function with a pinned search_path');
    for (const match of paths) assert.equal(match[1].trim(), "''", name+' contains an unsafe search_path');
  }
  assert.match(triggerMigration,/set search_path = ''/i);
});

test('suggestion quota reservation and insertion are one atomic service-only RPC',()=>{
  assert.match(suggestionCap,/create or replace function public\.submit_suggestion_with_daily_cap/i);
  assert.match(suggestionCap,/insert into public\.suggestion_daily_usage[\s\S]*?insert into public\.suggestions/i);
  assert.match(suggestionCap,/security definer\s+set search_path = ''/i);
  assert.match(suggestionCap,/revoke all on function public\.submit_suggestion_with_daily_cap[\s\S]*?from public, anon, authenticated/i);
  assert.match(suggestionCap,/grant execute on function public\.submit_suggestion_with_daily_cap[\s\S]*?to service_role/i);
  assert.doesNotMatch(suggestionCap,/consume_suggestion_daily_cap/i);
});

test('suggestion Edge Function uses the atomic RPC and Cairo calendar day',()=>{
  assert.match(submitFunction,/submit_suggestion_with_daily_cap/);
  assert.match(submitFunction,/timeZone: "Africa\/Cairo"/);
  assert.doesNotMatch(submitFunction,/from\("suggestions"\)\.insert/);
  assert.doesNotMatch(submitFunction,/consume_suggestion_daily_cap/);
});


test('AI migration reconciles legacy production columns without replacing existing tables',()=>{
  assert.match(migration,/add column if not exists risk text/i);
  assert.match(migration,/add column if not exists confidence numeric/i);
  assert.match(migration,/add column if not exists ai_analysis jsonb/i);
  assert.match(migration,/actor_user_id uuid not null references auth\.users\(id\)/i);
  assert.match(migration,/insert into public\.ai_approvals\(task_id,actor_user_id,action,decision,reason\)/i);
  assert.doesNotMatch(migration,/approved_by uuid|ai_approvals\(task_id,approved_by/i);
  assert.match(migration,/ai_tasks_human_approval_id_fkey','ai_tasks_human_approval_fk/i);
  assert.match(migration,/ai_audit_events_id_seq/i);
});

test('public suggestions Edge Function allows only the production website origin',()=>{
  const source=fs.readFileSync(path.join(__dirname,'functions','submit-suggestion','index.ts'),'utf8');
  assert.match(source,/https:\/\/hares\.aboserag925\.workers\.dev/);
  assert.doesNotMatch(source,/hares-preview\.aboserag925\.workers\.dev|localhost:8787|127\.0\.0\.1:8787/);
});
test('admin and lecture Edge Functions retain approved Preview and Production origins',()=>{
  for(const file of [
    path.join(__dirname,'functions','lectures-admin','index.ts'),
    path.join(__dirname,'functions','admin-operations','index.ts')
  ]){
    const source=fs.readFileSync(file,'utf8');
    assert.match(source,/https:\/\/hares-preview\.aboserag925\.workers\.dev/);
    assert.match(source,/https:\/\/hares\.aboserag925\.workers\.dev/);
  }
});

test('approval audit event is recorded once by the guarded database RPC',()=>{
  assert.doesNotMatch(adminOperations,/ai\.approval\.recorded/);
  assert.match(migration,/ai\.approval\.granted/);
  assert.match(migration,/ai\.approval\.rejected/);
});

const lectureMetadataMigration=fs.readFileSync(path.join(__dirname,'migrations','20261128035523_add_lecture_media_metadata.sql'),'utf8');
test('lecture metadata migration adds optional fields and does not alter RLS or grants',()=>{
  assert.match(lectureMetadataMigration,/alter table public\.lectures/i);
  for(const column of ['sheikh','duration_seconds','content_type']) assert.match(lectureMetadataMigration,new RegExp('add column if not exists '+column,'i'));
  assert.match(lectureMetadataMigration,/char_length\(sheikh\) <= 120/i);
  assert.match(lectureMetadataMigration,/duration_seconds between 0 and 86400/i);
  assert.match(lectureMetadataMigration,/content_type in \('audio', 'video', 'document'\)/i);
  assert.doesNotMatch(lectureMetadataMigration,/enable row level security|create policy|drop policy|grant |revoke /i);
});

test('lecture content type remains unknown until a media type is supplied',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'migrations','20261128040941_make_lecture_content_type_optional.sql'),'utf8');
  assert.match(migration,/alter column content_type drop not null/i);
  assert.match(migration,/alter column content_type drop default/i);
  assert.match(migration,/where stream_url is null and recording_url is null/i);
  assert.doesNotMatch(migration,/enable row level security|create policy|drop policy|grant |revoke /i);
});

const aiRuntimeMigration = fs.readFileSync(path.join(__dirname,'migrations','20261128203000_ai_agents_runtime_phase1.sql'),'utf8');

test('AI runtime migration adds request context and atomic analysis artifacts without destructive table changes',()=>{
  for(const fragment of [
    'add column if not exists task_type text',
    'add column if not exists title text',
    'add column if not exists description text',
    'create or replace function public.create_ai_task_with_audit',
    'create table if not exists public.ai_task_artifacts',
    'create or replace function public.record_ai_task_analysis',
    'insert into public.ai_reviews',
    'insert into public.ai_task_artifacts',
    'insert into public.ai_audit_events',
    "set search_path = ''",
    'for update',
    'grant execute on function public.create_ai_task_with_audit',
    'grant execute on function public.record_ai_task_analysis'
  ]) assert.ok(aiRuntimeMigration.includes(fragment),fragment);
  assert.match(aiRuntimeMigration,/^\s*(?:--[^\n]*\n\s*)*begin;/i);
  assert.match(aiRuntimeMigration,/commit;\s*$/i);
  assert.doesNotMatch(aiRuntimeMigration,/\b(drop table|truncate|delete from)\b/i);
});

test('AI approval RPC refuses tainted tasks and requires independent review evidence before approval',()=>{
  assert.match(aiRuntimeMigration,/if v_task\.tainted then raise exception 'Tainted tasks cannot be approved'/i);
  assert.match(aiRuntimeMigration,/Task is not waiting for implementation approval/);
  assert.match(aiRuntimeMigration,/Task is not ready for human review/);
  assert.match(aiRuntimeMigration,/review\.agent\s*=\s*'security'/);
  assert.match(aiRuntimeMigration,/review\.agent\s*=\s*'verifier'/);
  assert.match(aiRuntimeMigration,/review\.agent\s*=\s*'test'/);
});
