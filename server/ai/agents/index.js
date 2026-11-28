'use strict';
const {result}=require('../agent-result');
function createAgent(name,handler) {
  return Object.freeze({name,async run(context) {
    try { return result(name,'PASS',await handler(context)); }
    catch(error) { return result(name,'NEEDS_REVIEW',{},[String(error.message||'Agent failed').slice(0,240)]); }
  }});
}
const reportOnly=(name)=>Object.freeze({name,async run({task={},input={}}={}) {
  return result(name,'NEEDS_REVIEW',{
    taskId:task.id||null,
    summary:'This agent is report-only; no independent checks or repository changes were performed.',
    inputType:input.type||'suggestion'
  },['Automated execution is not implemented for this agent.']);
}});
module.exports={createAgent,reportOnly};
