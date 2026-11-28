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

test('analysis plan, source provenance, reviews, status and audit metadata persist through one RPC',async()=>{
  const calls=[];
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      const payload=JSON.parse(init.body);
      calls.push({url,payload});
      return {ok:true,status:200,json:async()=>[{
        task_id:'task-analysis-1',
        artifact_id:'artifact-1',
        artifact_sha256:payload.p_artifact_sha256,
        task_status:payload.p_status
      }]};
    }
  });
  const result=await service.recordAnalysis({
    taskId:'task-analysis-1',
    actorUserId:'preview-admin',
    status:'ANALYZED',
    source:{type:'security',title:'مراجعة الصلاحيات',description:'فحص حدود الصلاحيات',affectedAreas:['auth','rls']},
    plan:[{step:'review',requiresHumanApproval:true}],
    reports:[{agent:'security',status:'PASS',data:{checks:3},warnings:['reviewed']}]
  });
  assert.equal(calls.length,1);
  assert.ok(calls[0].url.endsWith('/rpc/record_ai_task_analysis'));
  assert.equal(calls[0].payload.p_task_id,'task-analysis-1');
  assert.equal(calls[0].payload.p_actor_user_id,'preview-admin');
  assert.equal(calls[0].payload.p_artifact.source.type,'security');
  assert.equal(calls[0].payload.p_artifact.plan[0].requiresHumanApproval,true);
  assert.equal(calls[0].payload.p_artifact.reports[0].agent,'security');
  assert.match(calls[0].payload.p_artifact_sha256,/^[0-9a-f]{64}$/);
  assert.equal(result.artifact_id,'artifact-1');
  assert.equal(result.task_status,'ANALYZED');
});

test('analysis persistence rejects oversized plans before contacting storage',async()=>{
  let called=false;
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async()=>{called=true;throw new Error('must not call storage');}
  });
  await assert.rejects(service.recordAnalysis({
    taskId:'task-1',actorUserId:'admin-1',status:'ANALYZED',
    source:{},plan:Array.from({length:41},()=>({step:'x'})),reports:[]
  }),/Invalid AI analysis artifact/);
  assert.equal(called,false);
});

test('analysis artifact retrieval verifies the stored SHA-256 digest',async()=>{
  const crypto=require('node:crypto');
  const artifact={a:1,b:2};
  const digest=crypto.createHash('sha256').update(JSON.stringify(artifact),'utf8').digest('hex');
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url)=>({
      ok:true,status:200,
      json:async()=>[{id:'artifact-1',task_id:'task-1',artifact,sha256:digest}]
    })
  });
  const row=await service.getAnalysisArtifact('task-1');
  assert.equal(row.id,'artifact-1');
  assert.equal(row.sha256,digest);
});

test('analysis artifact retrieval fails closed when its digest does not match',async()=>{
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async()=>({
      ok:true,status:200,
      json:async()=>[{id:'artifact-1',task_id:'task-1',artifact:{a:1},sha256:'0'.repeat(64)}]
    })
  });
  await assert.rejects(service.getAnalysisArtifact('task-1'),/integrity check failed/);
});


test('analysis persistence propagates an RPC failure without attempting a non-atomic fallback',async()=>{
  const calls=[];
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async(url,init)=>{
      calls.push({url,body:JSON.parse(init.body)});
      return {ok:false,status:500,json:async()=>({message:'transaction rejected'})};
    }
  });
  await assert.rejects(service.recordAnalysis({
    taskId:'task-rollback-1',actorUserId:'preview-admin',status:'FAILED',
    source:{type:'security'},plan:[],reports:[]
  }),/AI task storage request failed/);
  assert.equal(calls.length,1);
  assert.ok(calls[0].url.endsWith('/rpc/record_ai_task_analysis'));
  assert.equal(Object.hasOwn(calls[0].body,'p_fallback'),false);
});

test('analysis persistence fails closed when the RPC response does not match the submitted digest and status',async()=>{
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async()=>({ok:true,status:200,json:async()=>[{
      task_id:'task-mismatch',artifact_id:'artifact-mismatch',
      artifact_sha256:'f'.repeat(64),task_status:'ANALYZED'
    }]})
  });
  await assert.rejects(service.recordAnalysis({
    taskId:'task-mismatch',actorUserId:'preview-admin',status:'ANALYZED',
    source:{type:'security'},plan:[],reports:[]
  }),/could not be verified/);
});

test('artifact retrieval verifies SHA-256 after recursively canonicalizing object key order',async()=>{
  const crypto=require('node:crypto');
  const artifact={z:0,a:{z:1,a:2}};
  const canonical='{"a":{"a":2,"z":1},"z":0}';
  const digest=crypto.createHash('sha256').update(canonical,'utf8').digest('hex');
  const service=createTaskService({
    env:{SUPABASE_URL:'https://preview.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},
    fetch:async()=>({ok:true,status:200,json:async()=>[{
      id:'artifact-canonical',task_id:'task-canonical',artifact,sha256:digest
    }]})
  });
  const row=await service.getAnalysisArtifact('task-canonical');
  assert.equal(row.id,'artifact-canonical');
  assert.equal(row.sha256,digest);
});
