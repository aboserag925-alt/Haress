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
  assert.match(migration,/^\s*(?:--[^\n]*\n\s*)*begin;/i);
  assert.match(migration,/commit;\s*$/i);
  assert.doesNotMatch(migration,/\b(drop table|truncate|delete from)\b/i);
});

const taskContextMigration = fs.readFileSync(path.join(__dirname,'migrations','20261119000200_ai_task_request_context.sql'),'utf8');

test('AI task context migration adds request fields without rewriting existing rows',()=>{
  assert.match(taskContextMigration,/add column if not exists task_type text/i);
  assert.match(taskContextMigration,/add column if not exists title text/i);
  assert.match(taskContextMigration,/add column if not exists description text/i);
  assert.match(taskContextMigration,/ai_tasks_task_type_check/i);
  assert.match(taskContextMigration,/begin;[\s\S]*commit;/i);
  assert.doesNotMatch(taskContextMigration,/\b(drop table|truncate|delete from|update public\.ai_tasks)\b/i);
});

const previewHardening = fs.readFileSync(path.join(__dirname,'migrations','20261119000100_preview_ai_fk_index_and_rpc_hardening.sql'),'utf8');

test('Preview follow-up hardens legacy quota RPC and removes duplicate index safely',()=>{
  assert.ok(previewHardening.includes('create index if not exists ai_tasks_approval_id_idx'));
  assert.ok(previewHardening.includes('create index if not exists ai_tasks_human_approval_id_idx'));
  assert.ok(previewHardening.includes('drop index if exists public.suggestions_created_at_idx'));
  assert.ok(previewHardening.includes("alter function public.consume_suggestion_daily_cap(date, integer)\n  set search_path = ''"));
  assert.ok(previewHardening.includes('revoke all on function public.consume_suggestion_daily_cap(date, integer)'));
  assert.ok(previewHardening.includes('grant execute on function public.consume_suggestion_daily_cap(date, integer)'));
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


test('AI migration reconciles an existing partial Preview schema without dropping data',()=>{
  assert.match(migration,/create table if not exists public\.ai_reviews/i);
  assert.match(migration,/add column if not exists approval_id uuid/i);
  assert.match(migration,/add column if not exists human_approved boolean/i);
  assert.match(migration,/add column if not exists human_approval_id uuid/i);
  assert.match(migration,/alter column tainted set default true/i);
  assert.match(migration,/alter column requires_approval set default true/i);
  assert.match(migration,/alter column source set default 'suggestion'/i);
  assert.match(migration,/update public\.ai_tasks set tainted = true where approved = false and tainted = false/i);
  assert.match(migration,/set search_path = ''/i);
  assert.match(migration,/for update/i);
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

test('all Supabase Edge Functions allow only the approved Preview and Production origins',()=>{
  for(const file of [
    path.join(__dirname,'functions','submit-suggestion','index.ts'),
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


const atomicTaskCreation = fs.readFileSync(path.join(__dirname,'migrations','20261119000300_atomic_ai_task_creation.sql'),'utf8');

test('AI task creation and provenance audit are committed atomically by a service-only RPC',()=>{
  assert.match(atomicTaskCreation,/create or replace function public\.create_ai_task_with_audit/i);
  assert.match(atomicTaskCreation,/returns setof public\.ai_tasks/i);
  assert.match(atomicTaskCreation,/security definer\s+set search_path = ''/i);
  assert.match(atomicTaskCreation,/insert into public\.ai_tasks[\s\S]*?returning \* into v_task/i);
  assert.match(atomicTaskCreation,/insert into public\.ai_audit_events[\s\S]*?return next v_task/i);
  assert.match(atomicTaskCreation,/revoke all on function public\.create_ai_task_with_audit[\s\S]*?from public, anon, authenticated/i);
  assert.match(atomicTaskCreation,/grant execute on function public\.create_ai_task_with_audit[\s\S]*?to service_role/i);
  assert.match(atomicTaskCreation,/tainted,source,affected_areas/i);
  assert.match(atomicTaskCreation,/false,true,v_source/i);
  assert.match(atomicTaskCreation,/^\s*(?:--[^\n]*\n\s*)*begin;/i);
  assert.match(atomicTaskCreation,/commit;\s*$/i);
  assert.doesNotMatch(atomicTaskCreation,/\b(drop table|truncate|delete from|update public\.ai_tasks)\b/i);
});

const analysisArtifactMigration = fs.readFileSync(path.join(__dirname,'migrations','20261119000400_ai_task_analysis_artifacts.sql'),'utf8');

test('Maestro analysis artifacts are immutable to browser roles and persisted atomically with reviews, status and audit',()=>{
  for(const fragment of [
    'create table if not exists public.ai_task_artifacts',
    'task_id uuid not null references public.ai_tasks(id) on delete restrict',
    "sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$')",
    'alter table public.ai_task_artifacts enable row level security',
    'revoke all on public.ai_task_artifacts from public, anon, authenticated, service_role',
    'grant select on public.ai_task_artifacts to service_role',
    'create or replace function public.record_ai_task_analysis',
    'insert into public.ai_reviews',
    'insert into public.ai_task_artifacts',
    'update public.ai_tasks',
    'insert into public.ai_audit_events',
    'revoke all on function public.record_ai_task_analysis',
    'grant execute on function public.record_ai_task_analysis',
    'from public, anon, authenticated',
    'to service_role',
    "set search_path = ''",
    'for update',
    'begin;',
    'commit;'
  ]) assert.ok(analysisArtifactMigration.includes(fragment),fragment);
  for(const forbidden of ['drop table','truncate','delete from']) assert.equal(analysisArtifactMigration.includes(forbidden),false,forbidden);
});


test('Maestro artifact RPC validates all writes inside one locked database transaction',()=>{
  const fn=analysisArtifactMigration.slice(
    analysisArtifactMigration.indexOf('create or replace function public.record_ai_task_analysis'),
    analysisArtifactMigration.indexOf('$record_analysis$;',analysisArtifactMigration.indexOf('create or replace function public.record_ai_task_analysis'))+'$record_analysis$;'.length
  );
  assert.match(fn,/where id = p_task_id[\\s\\S]*?for update/i);
  assert.match(fn,/if v_task\.status <> 'PROPOSED'[\\s\\S]*?raise exception/i);
  assert.match(fn,/insert into public\.ai_reviews[\\s\\S]*?insert into public\.ai_task_artifacts[\\s\\S]*?update public\.ai_tasks[\\s\\S]*?insert into public\.ai_audit_events/i);
  assert.match(fn,/raise exception 'Invalid AI review report'/i);
  assert.match(fn,/raise exception 'Invalid AI review warning'/i);
  assert.match(analysisArtifactMigration,/revoke all on function public\.record_ai_task_analysis\\([\\s\\S]*?from public, anon, authenticated/i);
  assert.match(analysisArtifactMigration,/grant execute on function public\.record_ai_task_analysis\\([\\s\\S]*?to service_role/i);
});
