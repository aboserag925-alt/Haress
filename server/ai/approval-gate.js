'use strict';
function assertApproval(task, action) {
  if (!['analyze','plan','implement','test','verify','merge'].includes(action)) {
    throw new Error('Prohibited AI action');
  }
  if (!task || task.tainted===true) throw new Error('AI task is missing or tainted');
  if (action==='implement') {
    if (task.status!=='APPROVED') throw new Error('AI task must be in APPROVED state before implementation');
    if (task.approved!==true) throw new Error('Human approval is required before implementation');
    if (!(task.approvalId||task.approval_id)) throw new Error('Recorded human approval is required');
  }
  if (action==='merge') {
    if (task.status!=='HUMAN_APPROVED') throw new Error('AI task must be in HUMAN_APPROVED state before merge');
    if (!((task.humanApproved===true||task.human_approved===true) && (task.humanApprovalId||task.human_approval_id))) {
      throw new Error('Explicit human merge approval is required');
    }
  }
  return true;
}
module.exports={assertApproval};
