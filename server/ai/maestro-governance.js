const RiskEngine = require('./risk-engine.js');
const Policy = require('./policy.js');
const ApprovalGate = require('./approval-gate.js');

/**
 * Maestro Governance Service
 *
 * Integrates Risk Engine, Policy, and Approval Gates into Maestro.
 * Handles HIGH/CRITICAL Owner HITL requirements.
 */

class MaestroGovernance {
  /**
   * Evaluates a task and returns governance requirements.
   */
  static async evaluateTask(state) {
    const { category, description } = state;

    // Simplistic mapping of description to affectedAreas for existing RiskEngine
    const affectedAreas = [];
    const lowerDesc = description.toLowerCase();
    if (lowerDesc.includes('database') || lowerDesc.includes('db')) affectedAreas.push('production_database');
    if (lowerDesc.includes('auth') || lowerDesc.includes('rls')) affectedAreas.push('authentication');
    if (lowerDesc.includes('deploy') || lowerDesc.includes('workflow')) affectedAreas.push('deployment');
    if (lowerDesc.includes('secret') || lowerDesc.includes('key')) affectedAreas.push('secrets');

    // 1. Evaluate Risk using existing Hares AI RiskEngine
    const assessment = RiskEngine.assess({
      affectedAreas,
      risk: category === 'SECURITY' ? 'high' : 'low'
    });

    // 2. Determine if Owner HITL is required using existing Hares AI Policy
    const ownerHitlRequired = Policy.requiresHumanApproval(assessment.risk);

    return {
      risk: { level: assessment.risk.toUpperCase(), reasons: assessment.reasons },
      ownerHitlRequired,
      blocked: false // Legacy policy doesn't have explicit BLOCKS for general tasks yet
    };
  }

  /**
   * Checks if a required approval has been granted.
   */
  static async checkApproval(state, gateName) {
    const gate = state.gates[gateName];
    if (!gate || !gate.required) return true;
    if (gate.approved) return true;

    // Here we would typically check the database/approval service
    // For now, we rely on the state being updated by an external approval event
    return false;
  }
}

module.exports = MaestroGovernance;
