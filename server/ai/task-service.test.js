'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTaskService}=require('./task-service');

test('task creation uses one atomic RPC for the task row and provenance audit event',async()=>{
  const calls=[];
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      calls.push({url,init});
      return {ok:true,status:200,json:async()=>[{id:'task-atomic',status:'PROPOSED',tainted:true,approved:false}]};
    }
  });
  const task=await service.create({
    source:'suggestion',
    type:'security',
    title:'مراجعة الصلاحيات',
    description:'فحص حدود صلاحيات المشرفين',
    affectedAreas:['auth','rls'],
    actorUserId:'preview-admin'
  });
  assert.equal(task.id,'task-atomic');
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/rpc\/create_ai_task_with_audit$/);
  const payload=JSON.parse(calls[0].init.body);
  assert.equal(payload.p_actor_user_id,'preview-admin');
  assert.equal(payload.p_source,'suggestion');
  assert.equal(payload.p_task_type,'security');
  assert.equal(payload.p_title,'مراجعة الصلاحيات');
  assert.equal(payload.p_description,'فحص حدود صلاحيات المشرفين');
  assert.deepEqual(payload.p_affected_areas,['auth','rls']);
  assert.equal(task.tainted,true);
  assert.equal(task.approved,false);
});

test('task creation rejects when atomic task-and-audit RPC fails',async()=>{
  const calls=[];
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      calls.push({url,init});
      return {ok:false,status:503,json:async()=>({})};
    }
  });
  await assert.rejects(service.create({actorUserId:'preview-admin'}),/AI task storage request failed/);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/rpc\/create_ai_task_with_audit$/);
});

test('task creation keeps user-controlled provenance and trust flags out of the RPC payload',async()=>{
  let payload;
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      payload=JSON.parse(init.body);
      return {ok:true,status:200,json:async()=>[{id:'task-safe',tainted:true,approved:false}]};
    }
  });
  const task=await service.create({
    source:'untrusted-source',
    type:'suggestion',
    trustedSource:true,
    tainted:false,
    approved:true,
    status:'APPROVED',
    actorUserId:'preview-admin'
  });
  assert.equal(payload.p_source,'internal');
  assert.equal(Object.hasOwn(payload,'p_trusted_source'),false);
  assert.equal(Object.hasOwn(payload,'p_tainted'),false);
  assert.equal(Object.hasOwn(payload,'p_approved'),false);
  assert.equal(Object.hasOwn(payload,'p_status'),false);
  assert.equal(task.tainted,true);
  assert.equal(task.approved,false);
});
