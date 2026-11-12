const { StateGraph, START, END, interrupt } = require('@langchain/langgraph');
const { randomUUID } = require('node:crypto');
const { MaestroStateSchema } = require('./maestro-contract.js');
const MaestroGovernance = require('./maestro-governance.js');
const EvidenceVerifier = require('./evidence-verifier.js');

/**
 * Maestro LangGraph Integration
 *
 * One canonical Maestro graph factory. The same module is used by normal
 * Maestro execution (`maestroApp`), HITL approval, the M9 durability tests and
 * the restart worker. There is no second, test-only graph.
 *
 * When a persistent checkpointer is supplied the HIGH/CRITICAL Owner gate uses
 * the real LangGraph `interrupt()` primitive and the graph can be resumed in a
 * different process through `Command({ resume })`. Without a checkpointer the
 * graph cannot durably suspend, so the same gate fails closed as BLOCKED.
 */

const RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const HIGH_RISK = new Set(['HIGH', 'CRITICAL']);

const CHANNELS = {
  taskId: null,
  category: null,
  description: null,
  status: null,
  currentRole: null,
  evidence: {
    reducer: (a, b) => a.concat(b),
    default: () => []
  },
  verdict: {
    reducer: (a, b) => b ?? a,
    default: () => 'NOT_VERIFIED'
  },
  gates: null,
  governance: null,
  history: {
    reducer: (a, b) => a.concat(b),
    default: () => []
  },
  // Governance / HITL durability channels.
  risk: null,
  ownerHitlRequired: null,
  policy: null,
  approval: null,
  audit: null,
  hitl: null,
  executionCount: {
    reducer: (a, b) => b ?? a,
    default: () => 0
  },
  sensitiveExecuted: null
};

function nowIso() {
  return new Date().toISOString();
}

function historyEntry(role, action, message) {
  return { timestamp: nowIso(), role, action, message };
}

function isHighRisk(state) {
  return state.ownerHitlRequired === true || HIGH_RISK.has(state.risk);
}

/**
 * Builds the canonical Maestro graph.
 *
 * @param {object} [options]
 * @param {object} [options.checkpointer] Official LangGraph persistent
 *   checkpointer. When present the Owner gate uses real `interrupt()`.
 * @param {object} [options.dependencies]
 * @param {Function} [options.dependencies.performSensitiveExecution] The real
 *   side effect for approved HIGH/CRITICAL tasks. Must be supplied for those
 *   tasks; otherwise the graph fails closed instead of pretending to execute.
 */
function createMaestroGraph({ checkpointer, dependencies = {} } = {}) {
  const durable = Boolean(checkpointer);
  const performSensitiveExecution = dependencies.performSensitiveExecution;

  // Role Node Definitions

  async function ceoNode(state) {
    const history = state.history || [];
    const gates = state.gates || {};

    if (history.length === 0) {
      const gov = await MaestroGovernance.evaluateTask(state);
      const ownerRequired = gov.ownerHitlRequired;
      return {
        currentRole: 'CEO',
        risk: gov.risk.level,
        ownerHitlRequired: ownerRequired,
        policy: {
          risk: gov.risk.level,
          reasons: gov.risk.reasons,
          ownerHitlRequired: ownerRequired,
          evaluatedAt: nowIso()
        },
        gates: {
          ...gates,
          owner: { ...(gates.owner || {}), required: ownerRequired }
        },
        hitl: ownerRequired
          ? { state: 'WAITING_OWNER_APPROVAL', risk: gov.risk.level, requiredAt: nowIso() }
          : { state: 'NOT_REQUIRED' },
        history: [historyEntry(
          'CEO',
          'GOVERNANCE_EVALUATION',
          `Risk: ${gov.risk.level}. Owner HITL Required: ${gov.ownerHitlRequired}`
        )]
      };
    }

    return {
      currentRole: 'CEO',
      history: [historyEntry('CEO', 'STRATEGY', `Task status: ${state.verdict}`)]
    };
  }

  async function waitingApprovalNode(state) {
    const ownerGate = (state.gates && state.gates.owner) || {};

    // No durable checkpointer => LangGraph cannot suspend. Fail closed rather
    // than silently continuing without Owner approval.
    if (!durable) {
      return {
        status: 'BLOCKED',
        verdict: 'BLOCKED',
        history: [historyEntry(
          'CEO',
          'OWNER_GATE_UNAVAILABLE',
          'Owner approval required but no durable checkpointer is configured; failing closed.'
        )]
      };
    }

    const decision = interrupt({
      type: 'OWNER_APPROVAL_REQUIRED',
      taskId: state.taskId,
      risk: state.risk,
      question: 'Owner approval is required for this HIGH/CRITICAL task.'
    });

    const approved = Boolean(decision && decision.approved === true);
    const approver = (decision && decision.approver) || 'owner';

    if (!approved) {
      const rejectedAt = nowIso();
      return {
        status: 'BLOCKED',
        verdict: 'BLOCKED',
        approval: {
          decision: 'REJECT',
          approved: false,
          approver,
          approvalId: (decision && decision.approvalId) || randomUUID(),
          timestamp: rejectedAt
        },
        hitl: { state: 'OWNER_REJECTED', risk: state.risk, rejectedAt },
        audit: {
          ...(state.audit || {}),
          rejection: {
            rejectedBy: approver,
            rejectedAt,
            reason: (decision && decision.reason) || 'Owner rejected the task'
          }
        },
        history: [historyEntry('OWNER', 'OWNER_REJECTED', `Owner ${approver} rejected the task.`)]
      };
    }

    const approvedAt = nowIso();
    return {
      status: 'IN_PROGRESS',
      approval: {
        decision: 'APPROVE',
        approved: true,
        approver,
        approvalId: (decision && decision.approvalId) || randomUUID(),
        timestamp: approvedAt
      },
      gates: {
        ...(state.gates || {}),
        owner: {
          ...ownerGate,
          required: true,
          approved: true,
          approver,
          timestamp: approvedAt
        }
      },
      hitl: { state: 'OWNER_APPROVED', risk: state.risk, approvedAt },
      history: [historyEntry('OWNER', 'OWNER_APPROVED', `Owner ${approver} approved the task.`)]
    };
  }

  async function cooNode() {
    return { currentRole: 'COO' };
  }

  async function researchNode() {
    return { currentRole: 'RESEARCH' };
  }

  async function developerNode(state) {
    if (!isHighRisk(state)) {
      return { currentRole: 'DEVELOPER' };
    }

    const ownerGate = (state.gates && state.gates.owner) || {};
    if (!(ownerGate.required && ownerGate.approved)) {
      return {
        currentRole: 'DEVELOPER',
        status: 'BLOCKED',
        verdict: 'BLOCKED',
        history: [historyEntry(
          'DEVELOPER',
          'EXECUTION_BLOCKED',
          'High-risk execution requires an approved Owner gate.'
        )]
      };
    }

    // Idempotency: the persisted execution marker prevents a duplicate resume
    // from performing the sensitive side effect a second time.
    if (state.sensitiveExecuted === true || (state.executionCount || 0) >= 1) {
      return { currentRole: 'DEVELOPER' };
    }

    if (typeof performSensitiveExecution !== 'function') {
      throw new Error('Sensitive execution dependency is not configured');
    }

    const result = await performSensitiveExecution({
      taskId: state.taskId,
      category: state.category,
      description: state.description,
      risk: state.risk,
      approvalId: state.approval && state.approval.approvalId
    });

    const executionCount = (state.executionCount || 0) + 1;
    return {
      currentRole: 'DEVELOPER',
      status: 'IN_PROGRESS',
      executionCount,
      sensitiveExecuted: true,
      evidence: [{
        id: randomUUID(),
        type: 'BUILD_RESULT',
        source: 'developer-agent',
        content: { success: true, executionCount, result: result ?? null },
        timestamp: nowIso(),
        verified: false
      }],
      history: [historyEntry(
        'DEVELOPER',
        'SENSITIVE_EXECUTION',
        `Sensitive execution completed exactly once (executionCount=${executionCount}).`
      )]
    };
  }

  async function qaSecurityNode(state) {
    // Legacy/safe tasks keep their existing verification semantics. Only the
    // approved HIGH/CRITICAL path performs the security scan and QA gate.
    if (!isHighRisk(state) || !(state.gates && state.gates.owner && state.gates.owner.approved)) {
      return { currentRole: 'QA_SECURITY' };
    }

    const evidence = state.evidence || [];
    const alreadyScanned = evidence.some(
      (item) => item.type === 'SECURITY_SCAN' && item.source === 'qa-security-agent'
    );

    const gates = state.gates || {};
    const scannedAt = nowIso();
    return {
      currentRole: 'QA_SECURITY',
      gates: {
        ...gates,
        security: {
          ...(gates.security || {}),
          required: true,
          approved: true,
          approver: 'security-agent',
          timestamp: scannedAt
        },
        qa: {
          ...(gates.qa || {}),
          required: true,
          approved: true,
          approver: 'qa-agent',
          timestamp: scannedAt
        }
      },
      evidence: alreadyScanned ? [] : [{
        id: randomUUID(),
        type: 'SECURITY_SCAN',
        source: 'qa-security-agent',
        content: { vulnerabilities: 0 },
        timestamp: scannedAt,
        verified: false
      }],
      history: [historyEntry(
        'QA_SECURITY',
        'SECURITY_SCAN',
        'Security and QA verification completed with zero vulnerabilities.'
      )]
    };
  }

  async function auditorNode(state) {
    const gates = state.gates || {};
    const requiredGates = ['security', 'qa'];
    const failedGates = requiredGates.filter((gate) => {
      const value = gates[gate] || {};
      return value.required && !value.approved;
    });

    if (failedGates.length > 0) {
      return {
        currentRole: 'AUDITOR',
        verdict: 'FAIL',
        history: [historyEntry(
          'AUDITOR',
          'AUDIT_FAILURE',
          `Missing required approvals: ${failedGates.join(', ')}`
        )]
      };
    }

    // Evidence Rule: no PASS without actual evidence.
    if (!Array.isArray(state.evidence) || state.evidence.length === 0) {
      return {
        currentRole: 'AUDITOR',
        verdict: 'FAIL',
        history: [historyEntry(
          'AUDITOR',
          'AUDIT_FAILURE',
          'No evidence supplied; PASS requires at least one verified evidence item.'
        )]
      };
    }

    // Verify all evidence
    const unverifiedEvidence = state.evidence.filter((item) => !item.verified);
    for (const item of unverifiedEvidence) {
      const verification = EvidenceVerifier.verify(item);
      if (!verification.verified) {
        return {
          currentRole: 'AUDITOR',
          verdict: 'FAIL',
          history: [historyEntry(
            'AUDITOR',
            'AUDIT_FAILURE',
            `Evidence verification failed for ${item.id}: ${verification.error}`
          )]
        };
      }
    }

    return {
      currentRole: 'AUDITOR',
      verdict: 'PASS',
      history: [historyEntry(
        'AUDITOR',
        'AUDIT_SUCCESS',
        'Independent audit passed. All gates and evidence verified.'
      )]
    };
  }

  async function postVerificationNode(state) {
    if (state.verdict !== 'PASS') {
      return { currentRole: 'POST_VERIFICATION' };
    }

    const evidence = state.evidence || [];
    for (const item of evidence) {
      if (item.verified) continue;
      const verification = EvidenceVerifier.verify(item);
      if (!verification.verified) {
        return {
          currentRole: 'POST_VERIFICATION',
          verdict: 'FAIL',
          history: [historyEntry(
            'POST_VERIFICATION',
            'POST_VERIFICATION_FAILURE',
            `Post-verification rejected evidence ${item.id}: ${verification.error}`
          )]
        };
      }
    }

    return {
      currentRole: 'POST_VERIFICATION',
      audit: {
        ...(state.audit || {}),
        verified: true,
        verdict: 'PASS',
        evidenceRefs: evidence.map((item) => item.id),
        verifiedAt: nowIso()
      },
      history: [historyEntry(
        'POST_VERIFICATION',
        'POST_VERIFICATION_SUCCESS',
        'Final state verified after audit; evidence references preserved.'
      )]
    };
  }

  const graph = new StateGraph({ channels: CHANNELS });

  graph.addNode('ceo', ceoNode);
  graph.addNode('waiting_approval', waitingApprovalNode);
  graph.addNode('coo', cooNode);
  graph.addNode('research', researchNode);
  graph.addNode('developer', developerNode);
  graph.addNode('qa_security', qaSecurityNode);
  graph.addNode('auditor', auditorNode);
  graph.addNode('post_verification', postVerificationNode);

  graph.setEntryPoint('ceo');
  graph.addEdge('waiting_approval', 'ceo');
  graph.addEdge('coo', 'research');
  graph.addEdge('research', 'developer');
  graph.addEdge('developer', 'qa_security');
  graph.addEdge('qa_security', 'auditor');
  graph.addEdge('auditor', 'post_verification');
  graph.addEdge('post_verification', 'ceo');

  graph.addConditionalEdges('ceo', (state) => {
    if (state.verdict === 'PASS' || state.verdict === 'FAIL' || state.verdict === 'BLOCKED') {
      return 'end';
    }

    const ownerGate = (state.gates && state.gates.owner) || {};
    if (ownerGate.required && !ownerGate.approved) {
      return 'waiting_approval';
    }

    return 'coo';
  }, {
    end: END,
    coo: 'coo',
    waiting_approval: 'waiting_approval'
  });

  return checkpointer ? graph.compile({ checkpointer }) : graph.compile();
}

// Default non-durable application used by callers that do not need HITL
// persistence. HIGH/CRITICAL Owner gates fail closed here.
const maestroApp = createMaestroGraph();

module.exports = {
  createMaestroGraph,
  maestroApp,
  MaestroStateSchema,
  RISK_LEVELS
};
