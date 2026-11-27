'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const migration=fs.readFileSync(path.join(__dirname,'migrations','202611140001_suggestions_ai_storage.sql'),'utf8');
const approvalGuard=fs.readFileSync(path.join(__dirname,'migrations','20261127123000_restore_ai_approval_rpc_guards.sql'),'utf8');
const approvalSchema=fs.readFileSync(path.join(__dirname,'migrations','20261118172423_haress_ai_workflow_storage_hardening.sql'),'utf8');
const approvalAlignment=fs.readFileSync(path.join(__dirname,'migrations','20261118172518_haress_ai_approval_state_alignment.sql'),'utf8');

test('approval guard rejects repeated decisions without assuming a task/action unique constraint',()=>{
  assert.match(approvalSchema,/Recovered verbatim from Production PostgreSQL statement logs/i);
  assert.match(approvalSchema,/Applied at 2026-11-18 17:24:23 UTC; SQLSTATE 00000/i);
  assert.match(approvalGuard,/from public\.ai_approvals a[\s\S]*?where a\.task_id = p_task_id[\s\S]*?and a\.action = p_action[\s\S]*?order by a\.created_at desc, a\.id desc[\s\S]*?limit 1[\s\S]*?for update/i);
  assert.match(approvalGuard,/if found then[\s\S]*?raise exception 'Approval already recorded for this task and action'[\s\S]*?insert into public\.ai_approvals/i);
  assert.doesNotMatch(approvalGuard,/on conflict \(task_id, action\)/i);
});

test('approval_id and human_approval_id columns exist before the guarded RPC writes them',()=>{
  assert.match(approvalAlignment,/add column if not exists approval_id uuid references public\.ai_approvals\(id\)/i);
  assert.match(approvalSchema,/human_approval_id uuid/i);
  assert.match(approvalGuard,/approval_id = v_approval_id/i);
  assert.match(approvalGuard,/human_approval_id = v_approval_id/i);
});

test('latest AI approval RPC enforces taint, administrator, and task-state guards in the database',()=>{
  assert.match(approvalGuard,/security definer\s+set search_path = ''/i);
  assert.match(approvalGuard,/v_task\.tainted is distinct from false/i);
  assert.match(approvalGuard,/from public\.admin_users/i);
  assert.match(approvalGuard,/for update/i);
  assert.match(approvalGuard,/p_action = 'IMPLEMENT' and v_task\.status <> 'WAITING_APPROVAL'/i);
  assert.match(approvalGuard,/p_action = 'MERGE' and v_task\.status <> 'READY_FOR_REVIEW'/i);
  assert.match(approvalGuard,/p_decision = 'REJECTED' and pg_catalog\.char_length\(pg_catalog\.btrim\(v_reason\)\) = 0/i);
});

test('latest AI approval RPC clears stale approval booleans and writes an audit event for each decision',()=>{
  assert.match(approvalGuard,/insert into public\.ai_approvals\(task_id, actor_user_id, action, decision, reason\)/i);
  assert.match(approvalGuard,/if found then[\s\S]*?raise exception 'Approval already recorded for this task and action'/i);
  assert.match(approvalGuard,/insert into public\.ai_audit_events\(event_type, actor_user_id, metadata\)/i);
  assert.match(approvalGuard,/approved = \(p_decision = 'APPROVED'\)/i);
  assert.match(approvalGuard,/human_approved = \(p_decision = 'APPROVED'\)/i);
  assert.match(approvalGuard,/insert into public\.ai_approvals\(task_id, actor_user_id, action, decision, reason\)/i);
  assert.match(approvalGuard,/ai\.approval\.rejected/i);
  assert.match(approvalGuard,/ai\.approval\.granted/i);
});

test('latest AI approval RPC remains service-role-only and transactional',()=>{
  assert.match(approvalGuard,/^\s*(?:--[^\n]*\n\s*)*begin;/i);
  assert.match(approvalGuard,/commit;\s*$/i);
  assert.match(approvalGuard,/revoke all on function public\.record_ai_approval[\s\S]*?from public, anon, authenticated/i);
  assert.match(approvalGuard,/grant execute on function public\.record_ai_approval[\s\S]*?to service_role/i);
  assert.doesNotMatch(approvalGuard,/\b(drop table|truncate|delete from)\b/i);
});


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
  for(const [name,sql] of [['AI storage',migration],['AI approval guard',approvalGuard],['question cap',questionCap],['suggestion cap',suggestionCap]]){
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
    assert.match(source,/https:\/\/hares\.aboserag925\.workers\.dev/);
  }
});

test('approval audit event is recorded once by the guarded database RPC',()=>{
  assert.doesNotMatch(adminOperations,/ai\.approval\.recorded/);
  assert.match(migration,/ai\.approval\.granted/);
  assert.match(migration,/ai\.approval\.rejected/);
});
