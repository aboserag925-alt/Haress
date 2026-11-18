'use strict';
const {assess}=require('./risk-engine');
const {createAuditLogger}=require('./audit-log');
function createTaskService({env,fetch:fetchImpl=global.fetch}) {
  const audit=createAuditLogger({env,fetch:fetchImpl});
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
      const rows=await request('/rest/v1/ai_tasks?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
        suggestion_id:input.suggestionId||null,status:'PROPOSED',risk:risk.risk,confidence:null,
        requires_approval:risk.requiresApproval,approved:false,tainted:true,
        source:input.source==='suggestion'?'suggestion':'internal',
        affected_areas:Array.isArray(input.affectedAreas)?input.affectedAreas.filter(x=>typeof x==='string').slice(0,30):[]
      })});
      const task=rows[0];
      try{await audit.record({event:'ai.task.created',suggestionId:task.suggestion_id,metadata:{task_id:task.id,risk:task.risk,affected_areas:task.affected_areas}});}catch{console.error('AI task audit event could not be recorded');}
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
    async recordReviews(taskId,reports=[]) {
      if(!Array.isArray(reports)||reports.length>12) throw new TypeError('Invalid AI review reports');
      if(!reports.length) return [];
      const rows=reports.map(report=>({
        task_id:taskId,
        agent:String(report.agent||'unknown').slice(0,40),
        result:['PASS','FAIL','NEEDS_REVIEW','BLOCKED'].includes(report.status)?report.status:'NEEDS_REVIEW',
        report:{data:report.data&&typeof report.data==='object'?report.data:{},warnings:Array.isArray(report.warnings)?report.warnings.map(x=>String(x).slice(0,240)).slice(0,10):[]}
      }));
      return request('/rest/v1/ai_reviews?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(rows)});
    },
    async recordHumanApproval({taskId,actorUserId,action,decision,reason=''}) {
      if(!taskId||!actorUserId||!['IMPLEMENT','MERGE'].includes(action)||!['APPROVED','REJECTED'].includes(decision)) throw new TypeError('Invalid approval request');
      const rows=await request('/rest/v1/rpc/record_ai_approval',{method:'POST',body:JSON.stringify({p_task_id:taskId,p_actor_user_id:actorUserId,p_action:action,p_decision:decision,p_reason:String(reason).slice(0,1000)})});
      return rows;
    }
  });
}
module.exports={createTaskService};
