'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTaskService}=require('./task-service');

test('task creation fails closed when its audit event cannot be persisted',async()=>{
  const calls=[];
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      calls.push({url,init});
      if(url.includes('/ai_tasks?')){
        return {ok:true,status:201,json:async()=>[{id:'task-1',suggestion_id:null,risk:'low',affected_areas:[]}]};
      }
      return {ok:false,status:503,json:async()=>({})};
    }
  });
  await assert.rejects(
    service.create({source:'suggestion',actorUserId:'preview-admin'}),
    /Audit event could not be recorded/
  );
  assert.equal(calls.length,2);
  const audit=JSON.parse(calls[1].init.body);
  assert.equal(audit.event_type,'ai.task.created');
  assert.equal(audit.actor_user_id,'preview-admin');
});

test('task creation persists provenance actor on the audit event',async()=>{
  let auditPayload;
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      if(url.includes('/ai_tasks?')) return {ok:true,status:201,json:async()=>[{id:'task-2',suggestion_id:null,risk:'low',affected_areas:[]}]};
      auditPayload=JSON.parse(init.body);
      return {ok:true,status:201,json:async()=>[]};
    }
  });
  const task=await service.create({source:'suggestion',actorUserId:'preview-admin'});
  assert.equal(task.id,'task-2');
  assert.equal(auditPayload.actor_user_id,'preview-admin');
});

test('task creation stores the validated request context without changing taint',async()=>{
  let taskPayload;
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      if(url.includes('/ai_tasks?')){
        taskPayload=JSON.parse(init.body);
        return {ok:true,status:201,json:async()=>[{id:'task-context',tainted:true}]};
      }
      return {ok:true,status:201,json:async()=>[]};
    }
  });
  await service.create({
    type:'security',
    title:'مراجعة الصلاحيات',
    description:'فحص حدود صلاحيات المشرفين',
    actorUserId:'preview-admin'
  });
  assert.equal(taskPayload.task_type,'security');
  assert.equal(taskPayload.title,'مراجعة الصلاحيات');
  assert.equal(taskPayload.description,'فحص حدود صلاحيات المشرفين');
  assert.equal(taskPayload.tainted,true);
  assert.equal(taskPayload.approved,false);
});
