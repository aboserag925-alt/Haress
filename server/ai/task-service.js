'use strict';
const crypto=require('node:crypto');
const {assess}=require('./risk-engine');
function canonicalize(value){
  if(Array.isArray(value)) return value.map(canonicalize);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));
  return value;
}
function normalizeReport(report={}){
  return {
    agent:String(report.agent||'unknown').slice(0,40),
    status:['PASS','FAIL','NEEDS_REVIEW','BLOCKED'].includes(report.status)?report.status:'NEEDS_REVIEW',
    data:report.data&&typeof report.data==='object'&&!Array.isArray(report.data)?report.data:{},
    warnings:Array.isArray(report.warnings)?report.warnings.map(x=>String(x).slice(0,240)).slice(0,10):[]
  };
}
function createTaskService({env,fetch:fetchImpl=global.fetch}) {
  async function request(path,init={}) {
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('AI task storage is not configured');
    const key=env.SUPABASE_SERVICE_ROLE_KEY;
    const response=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+path,{...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error('AI task storage request failed');
    return response.status===204?null:response.json();
  }
  return Object.freeze({
    async create(input={}) {
      const risk=assess({affectedAreas:Array.isArray(input.affectedAreas)?input.affectedAreas:[]});
      const rows=await request('/rest/v1/rpc/create_ai_task_with_audit',{method:'POST',body:JSON.stringify({
        p_suggestion_id:input.suggestionId||null,
        p_actor_user_id:input.actorUserId||null,
        p_source:input.source==='suggestion'?'suggestion':'internal',
        p_task_type:['suggestion','security','implementation','ux','content','performance','product'].includes(input.type)?input.type:null,
        p_title:typeof input.title==='string'?input.title.slice(0,120):null,
        p_description:typeof input.description==='string'?input.description.slice(0,3000):null,
        p_risk:risk.risk,
        p_requires_approval:risk.requiresApproval,
        p_affected_areas:Array.isArray(input.affectedAreas)?input.affectedAreas.filter(x=>typeof x==='string').slice(0,30):[]
      })});
      const task=rows[0];
      return task;
    },
    async get(id) {
      const rows=await request('/rest/v1/ai_tasks?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');
      return rows[0]||null;
    },
    async updateStatus(id,status) {
      const allowed=new Set(['ANALYZED','FAILED']);
      if(!allowed.has(status)) throw new TypeError('Invalid AI task status update');
      const rows=await request('/rest/v1/ai_tasks?id=eq.'+encodeURIComponent(id)+'&select=*',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status,updated_at:new Date().toISOString()})});
      return rows[0]||null;
    },
    async recordAnalysis({taskId,actorUserId,status,source,plan=[],reports=[]}={}) {
      if(!taskId||!actorUserId||!['ANALYZED','FAILED'].includes(status)||!Array.isArray(plan)||plan.length>40||!Array.isArray(reports)||reports.length>12) {
        throw new TypeError('Invalid AI analysis artifact');
      }
      const artifact={
        schemaVersion:1,
        taskId,
        createdBy:actorUserId,
        status,
        source:{
          type:String(source?.type||'').slice(0,40),
          title:String(source?.title||'').slice(0,120),
          description:String(source?.description||'').slice(0,3000),
          affectedAreas:Array.isArray(source?.affectedAreas)?source.affectedAreas.filter(x=>typeof x==='string').slice(0,30):[]
        },
        plan,
        reports:reports.map(normalizeReport)
      };
      const canonical=JSON.stringify(canonicalize(artifact));
      if(Buffer.byteLength(canonical,'utf8')>65536) throw new TypeError('AI analysis artifact exceeds storage limit');
      const sha256=crypto.createHash('sha256').update(canonical,'utf8').digest('hex');
      const rows=await request('/rest/v1/rpc/record_ai_task_analysis',{method:'POST',body:JSON.stringify({
        p_task_id:taskId,
        p_actor_user_id:actorUserId,
        p_status:status,
        p_artifact:artifact,
        p_artifact_sha256:sha256
      })});
      const result=Array.isArray(rows)?rows[0]:rows;
      if(!result?.artifact_id||result.artifact_sha256!==sha256||result.task_status!==status) throw new Error('AI analysis artifact persistence could not be verified');
      return {...result,artifact};
    },
    async recordHumanApproval({taskId,actorUserId,action,decision,reason=''}) {
      if(!taskId||!actorUserId||!['IMPLEMENT','MERGE'].includes(action)||!['APPROVED','REJECTED'].includes(decision)) throw new TypeError('Invalid approval request');
      const rows=await request('/rest/v1/rpc/record_ai_approval',{method:'POST',body:JSON.stringify({p_task_id:taskId,p_actor_user_id:actorUserId,p_action:action,p_decision:decision,p_reason:String(reason).slice(0,1000)})});
      return rows;
    }
  });
}
module.exports={createTaskService};
