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

const secureDefaults = fs.readFileSync(path.join(__dirname,'migrations','20261119060213_haress_ai_task_secure_defaults.sql'),'utf8');

test('production AI task defaults require approval and mark new tasks as tainted',()=>{
  assert.match(secureDefaults,/alter column requires_approval set default true/i);
  assert.match(secureDefaults,/alter column tainted set default true/i);
  assert.match(secureDefaults,/alter column source set default 'suggestion'/i);
  assert.match(secureDefaults,/existing rows are intentionally unchanged/i);
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

test('all Supabase Edge Functions allow only the approved Preview and Production origins',()=>{
  for(const file of [
    path.join(__dirname,'functions','submit-suggestion','index.ts'),
    path.join(__dirname,'functions','lectures-admin','index.ts'),
    path.join(__dirname,'functions','admin-operations','index.ts')
  ]){
    const source=fs.readFileSync(file,'utf8');
    assert.match(source,/https:\/\/hares-preview\.aboserag925\.workers\.dev/);
    assert.match(source,/https:\/\/feat-visual-identity-v2-mainline-20261119-hares\.aboserag925\.workers\.dev/);
    assert.match(source,/https:\/\/hares\.aboserag925\.workers\.dev/);
  }
});


const taskContext = fs.readFileSync(path.join(__dirname,'migrations','20261119000200_ai_task_request_context.sql'),'utf8');
const taskCreation = fs.readFileSync(path.join(__dirname,'migrations','20261119000300_atomic_ai_task_creation.sql'),'utf8');
const reviewStorage = fs.readFileSync(path.join(__dirname,'migrations','20261119000350_ai_reviews_storage.sql'),'utf8');
const artifactStorage = fs.readFileSync(path.join(__dirname,'migrations','20261119000400_ai_task_analysis_artifacts.sql'),'utf8');

test('AI task request context is additive and validates task types',()=>{
  assert.match(taskContext,/add column if not exists task_type text/i);
  assert.match(taskContext,/add column if not exists title text/i);
  assert.match(taskContext,/add column if not exists description text/i);
  assert.match(taskContext,/ai_tasks_task_type_check/i);
  assert.doesNotMatch(taskContext,/drop table|truncate|delete from/i);
});

test('AI task creation is atomic and its SECURITY DEFINER RPC is service-only',()=>{
  assert.match(taskCreation,/insert into public\.ai_tasks/i);
  assert.match(taskCreation,/insert into public\.ai_audit_events/i);
  assert.match(taskCreation,/security definer\s+set search_path = ''/i);
  assert.match(taskCreation,/revoke all on function public\.create_ai_task_with_audit[\s\S]*?from public, anon, authenticated/i);
  assert.match(taskCreation,/grant execute on function public\.create_ai_task_with_audit[\s\S]*?to service_role/i);
  assert.match(taskCreation,/tainted,source,affected_areas/i);
});

test('AI reviews and immutable artifacts remain closed to browser roles',()=>{
  assert.match(reviewStorage,/alter table public\.ai_reviews enable row level security/i);
  assert.match(reviewStorage,/revoke all on public\.ai_reviews from public, anon, authenticated/i);
  assert.match(artifactStorage,/alter table public\.ai_task_artifacts enable row level security/i);
  assert.match(artifactStorage,/revoke all on public\.ai_task_artifacts from public, anon, authenticated, service_role/i);
  assert.match(artifactStorage,/grant select on public\.ai_task_artifacts to service_role/i);
  assert.match(artifactStorage,/sha256 text not null check/i);
});

test('AI analysis persistence validates admin, task provenance and artifact integrity atomically',()=>{
  assert.match(artifactStorage,/create or replace function public\.record_ai_task_analysis/i);
  assert.match(artifactStorage,/Administrator authorization required/i);
  assert.match(artifactStorage,/p_artifact_sha256/i);
  assert.match(artifactStorage,/ai\.analysis\.completed/i);
  assert.match(artifactStorage,/revoke all on function public\.record_ai_task_analysis[\s\S]*?from public, anon, authenticated/i);
  assert.match(artifactStorage,/grant execute on function public\.record_ai_task_analysis[\s\S]*?to service_role/i);
});

test('admin Edge Function creates and retrieves AI analysis artifacts through guarded RPCs',()=>{
  assert.match(adminOperations,/create_ai_task_with_audit/);
  assert.match(adminOperations,/record_ai_task_analysis/);
  assert.match(adminOperations,/allowTaskRequest/);
  assert.match(adminOperations,/auth\.getUser/);
  assert.match(adminOperations,/from\("admin_users"\)/);
});

const mediaIndex = fs.readFileSync(path.join(__dirname,'migrations','20261119070000_media_library_durable_index.sql'),'utf8');
const mediaKind = fs.readFileSync(path.join(__dirname,'migrations','20261119070010_media_library_document_kind.sql'),'utf8');
const questionFunction = fs.readFileSync(path.join(__dirname,'functions','submit-question','index.ts'),'utf8');
const mediaFunction = fs.readFileSync(path.join(__dirname,'functions','media-library','index.ts'),'utf8');

test('durable media index keeps object storage private and closes metadata to browser roles',()=>{
  for(const table of ['media_library_items','media_library_state']){
    assert.match(mediaIndex,new RegExp('create table if not exists public\\\\.'+table+'\\\\b','i'));
    assert.match(mediaIndex,new RegExp('alter table public\\\\.'+table+' enable row level security','i'));
    assert.match(mediaIndex,new RegExp('revoke all on public\\\\.'+table+' from public, anon, authenticated','i'));
  }
  assert.match(mediaIndex,/file_unique_id text not null unique/i);
  assert.match(mediaIndex,/object_key text not null unique/i);
  assert.match(mediaIndex,/status in \\('pending','approved','rejected','removed'\\)/i);
  assert.match(mediaKind,/kind in \\('audio','video','document','image','other'\\)/i);
  assert.doesNotMatch(mediaIndex,/drop table|truncate|delete from/i);
});

test('public question function validates Turnstile and reserves the atomic Cairo daily cap before sending',()=>{
  assert.match(questionFunction,/submit_question/);
  assert.match(questionFunction,/consume_question_daily_cap/);
  assert.match(questionFunction,/timeZone: "Africa\\/Cairo"/);
  assert.match(questionFunction,/GEMINI_API_KEY/);
  assert.match(questionFunction,/TELEGRAM_BOT_TOKEN/);
  assert.match(questionFunction,/telegramSent: false/);
  assert.match(questionFunction,/ALLOWED_ORIGINS/);
});

test('media library API lists only approved rows and signs private object URLs',()=>{
  assert.match(mediaFunction,/eq\\("status", "approved"\\)/);
  assert.match(mediaFunction,/createSignedUrl/);
  assert.match(mediaFunction,/SUPABASE_STORAGE_BUCKET/);
  assert.match(mediaFunction,/Cache-Control/);
});

test('approval audit event is recorded once by the guarded database RPC',()=>{
  assert.doesNotMatch(adminOperations,/ai\.approval\.recorded/);
  assert.match(migration,/ai\.approval\.granted/);
  assert.match(migration,/ai\.approval\.rejected/);
});
