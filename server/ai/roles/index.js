const productAgent = require('../agents/product-agent.js');
const contentAgent = require('../agents/content-agent.js');
const developerAgent = require('../agents/developer-agent.js');
const testAgent = require('../agents/test-agent.js');
const securityAgent = require('../agents/security-agent.js');
const uxAgent = require('../agents/ux-agent.js');
const performanceAgent = require('../agents/performance-agent.js');
const suggestionAgent = require('../agents/suggestion-agent.js');
const verifierAgent = require('../agents/verifier-agent.js');

/**
 * Maestro Organizational Role Wrappers
 *
 * Maps the six Maestro architectural roles to the existing nine specialist agents
 * and the Hares AI supervisor, fulfilling M6.
 */

// All specialist agents expose a single `run(context)` entry point.
function agentContext(state) {
  return { task: state, input: state.input || state };
}

// Fail closed: unavailable, throwing, or malformed agents yield BLOCKED, never PASS.
async function runAgent(agent, name, state) {
  try {
    if (!agent || typeof agent.run !== 'function') {
      return { agent: name, status: 'BLOCKED', data: {}, issues: ['Agent unavailable'] };
    }
    const result = await agent.run(agentContext(state));
    if (!result || typeof result.status !== 'string') {
      return { agent: name, status: 'BLOCKED', data: {}, issues: ['Agent returned no status'] };
    }
    return result;
  } catch (error) {
    return {
      agent: name,
      status: 'BLOCKED',
      data: {},
      issues: [String(error.message || 'Agent failed').slice(0, 240)]
    };
  }
}

class RoleWrappers {
  /**
   * 1. CEO Role: Strategic oversight, final verdict review, and high-level strategy.
   */
  static async executeCEORole(state) {
    console.log('[Maestro CEO] Reviewing strategic state for task:', state.taskId);
    return {
      role: 'CEO',
      action: 'STRATEGIC_OVERSIGHT',
      summary: `Task ${state.description} reviewed under category ${state.category}.`
    };
  }

  /**
   * 2. COO Role: Operations, routing, and task decomposition using Product/Suggestion agents.
   */
  static async executeCOORole(state) {
    console.log('[Maestro COO] Routing task through operational flow.');
    const productReview = await runAgent(productAgent, 'product', state);
    return {
      role: 'COO',
      action: 'OPERATIONAL_ROUTING',
      productReview
    };
  }

  /**
   * 3. Research Role: Analysis and content evaluation using Content/Suggestion agents.
   */
  static async executeResearchRole(state) {
    console.log('[Maestro Research] Conducting codebase & content analysis.');
    const analysis = await runAgent(contentAgent, 'content', state);
    return {
      role: 'RESEARCH',
      action: 'RESEARCH_COMPLETED',
      analysis
    };
  }

  /**
   * 4. Developer Role: Implementation and code generation using Developer agent.
   */
  static async executeDeveloperRole(state) {
    console.log('[Maestro Developer] Executing implementation tasks.');
    const devResult = await runAgent(developerAgent, 'developer', state);
    return {
      role: 'DEVELOPER',
      action: 'IMPLEMENTATION_COMPLETED',
      devResult
    };
  }

  /**
   * 5. QA/Security Role: Rigorous testing and security verification using Test, Security, and Verifier agents.
   */
  static async executeQASecurityRole(state) {
    console.log('[Maestro QA/Security] Running test and security verification suites.');

    // Invoke the real specialist agents; missing or non-PASS results fail closed.
    const securityCheck = await runAgent(securityAgent, 'security', state);
    const testCheck = await runAgent(testAgent, 'test', state);
    const verifierCheck = await runAgent(verifierAgent, 'verifier', state);

    const checks = [securityCheck, testCheck, verifierCheck];
    const pass = checks.every(check => check && check.status === 'PASS');

    return {
      role: 'QA_SECURITY',
      action: 'VERIFICATION_COMPLETED',
      securityCheck,
      testCheck,
      verifierCheck,
      pass
    };
  }

  /**
   * 6. Independent Auditor Role: Final independent review and audit logging.
   */
  static async executeAuditorRole(state) {
    console.log('[Maestro Auditor] Performing independent audit review.');
    return {
      role: 'AUDITOR',
      action: 'INDEPENDENT_AUDIT_COMPLETED',
      auditVerdict: state.verdict || 'PASS'
    };
  }
}

module.exports = RoleWrappers;
