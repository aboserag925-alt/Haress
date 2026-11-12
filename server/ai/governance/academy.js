const { z } = require('zod');

/**
 * Hardened Academy Governance (M11)
 *
 * Manages skill lifecycle with strict finite-state transition maps,
 * separation of duties, self-approval prevention, and auditable metadata:
 * CANDIDATE -> SANDBOX -> EVAL -> REVIEW -> SECURITY_CHECK -> APPROVED -> PROMOTED -> MONITORING -> ROLLED_BACK
 */

const SkillStateSchema = z.enum([
  'CANDIDATE',
  'SANDBOX',
  'EVAL',
  'REVIEW',
  'SECURITY_CHECK',
  'APPROVED',
  'PROMOTED',
  'MONITORING',
  'ROLLED_BACK'
]);

const VALID_TRANSITIONS = {
  CANDIDATE: ['SANDBOX', 'ROLLED_BACK'],
  SANDBOX: ['EVAL', 'ROLLED_BACK'],
  EVAL: ['REVIEW', 'ROLLED_BACK'],
  REVIEW: ['SECURITY_CHECK', 'ROLLED_BACK'],
  SECURITY_CHECK: ['APPROVED', 'ROLLED_BACK'],
  APPROVED: ['PROMOTED', 'ROLLED_BACK'],
  PROMOTED: ['MONITORING', 'ROLLED_BACK'],
  MONITORING: ['ROLLED_BACK'],
  ROLLED_BACK: []
};

class AcademyGovernance {
  static transitionSkill(skill, targetState, actor = { id: 'unknown', role: 'agent' }, options = {}) {
    const currentState = skill.state || 'CANDIDATE';

    // 1. Check finite-state transition validity
    const allowedNextStates = VALID_TRANSITIONS[currentState] || [];
    if (!allowedNextStates.includes(targetState)) {
      return {
        success: false,
        error: `Governance Violation: Invalid state transition from '${currentState}' to '${targetState}'`
      };
    }

    // 2. Prevent self-approval / separation of duties for SECURITY_CHECK -> APPROVED or APPROVED -> PROMOTED
    if (['APPROVED', 'PROMOTED', 'ROLLED_BACK'].includes(targetState)) {
      if (skill.author && skill.author === actor.id && actor.role !== 'owner') {
        return {
          success: false,
          error: `Governance Violation: Separation of duties breach. Skill author '${actor.id}' cannot approve or promote their own skill.`
        };
      }
    }

    // 3. Enforce Owner/HITL approval for PROMOTED or ROLLED_BACK
    if (['PROMOTED', 'ROLLED_BACK'].includes(targetState)) {
      if (!options.approved || !options.approvalId) {
        return {
          success: false,
          error: `Governance Violation: Transition to '${targetState}' requires recorded Owner HITL approval and approvalId.`
        };
      }
    }

    // 4. Create auditable transition metadata
    const transitionRecord = {
      from: currentState,
      to: targetState,
      actor: actor.id,
      role: actor.role,
      timestamp: new Date().toISOString(),
      approvalId: options.approvalId || null
    };

    const auditTrail = [...(skill.auditTrail || []), transitionRecord];

    return {
      success: true,
      skill: {
        ...skill,
        state: targetState,
        updatedAt: new Date().toISOString(),
        auditTrail
      }
    };
  }
}

module.exports = {
  SkillStateSchema,
  AcademyGovernance
};
