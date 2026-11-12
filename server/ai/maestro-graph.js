const { StateGraph } = require('@langchain/langgraph');
const { MaestroStateSchema } = require('./maestro-contract.js');
const MaestroGovernance = require('./maestro-governance.js');
const EvidenceVerifier = require('./evidence-verifier.js');

/**
 * Maestro LangGraph Integration
 *
 * Defines the StateGraph for Maestro orchestration.
 * Wraps existing specialist agents into six organizational roles.
 */

// Define the StateGraph using the MaestroStateSchema
const MaestroGraph = new StateGraph({
  channels: {
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
    }
  }
});

// Role Node Definitions
async function ceoNode(state) {
  console.log(`CEO Node: Strategic Oversight. Current Verdict: ${state.verdict}`);

  // M4: Evaluate Governance on first run
  if (state.history.length === 0) {
    const gov = await MaestroGovernance.evaluateTask(state);
    return {
      currentRole: 'CEO',
      gates: {
        ...state.gates,
        owner: { ...state.gates.owner, required: gov.ownerHitlRequired }
      },
      history: [{
        timestamp: new Date().toISOString(),
        role: 'CEO',
        action: 'GOVERNANCE_EVALUATION',
        message: `Risk: ${gov.risk.level}. Owner HITL Required: ${gov.ownerHitlRequired}`
      }]
    };
  }

  return {
    currentRole: 'CEO',
    history: [{ timestamp: new Date().toISOString(), role: 'CEO', action: 'STRATEGY', message: `Task status: ${state.verdict}` }]
  };
}

async function waitingApprovalNode(state) {
  console.log('CEO Node: WAITING FOR OWNER APPROVAL');
  return { status: 'BLOCKED', verdict: 'BLOCKED' };
}

async function cooNode(state) {
  console.log('COO Node: Operations & Routing');
  return { currentRole: 'COO' };
}

async function researchNode(state) {
  console.log('Research Node: Analysis');
  return { currentRole: 'RESEARCH' };
}

async function developerNode(state) {
  console.log('Developer Node: Implementation');
  return { currentRole: 'DEVELOPER' };
}

async function qaSecurityNode(state) {
  console.log('QA/Security Node: Verification');
  // In M6, this will call security-agent/test-agent
  return { currentRole: 'QA_SECURITY' };
}

async function auditorNode(state) {
  console.log('Auditor Node: Independent Audit');

  // M5: Independent Audit Logic
  const requiredGates = ['security', 'qa'];
  const failedGates = requiredGates.filter(g => state.gates[g].required && !state.gates[g].approved);

  if (failedGates.length > 0) {
    return {
      currentRole: 'AUDITOR',
      verdict: 'FAIL',
      history: [{
        timestamp: new Date().toISOString(),
        role: 'AUDITOR',
        action: 'AUDIT_FAILURE',
        message: `Missing required approvals: ${failedGates.join(', ')}`
      }]
    };
  }

  // Evidence Rule: no PASS without actual evidence.
  if (!Array.isArray(state.evidence) || state.evidence.length === 0) {
    return {
      currentRole: 'AUDITOR',
      verdict: 'FAIL',
      history: [{
        timestamp: new Date().toISOString(),
        role: 'AUDITOR',
        action: 'AUDIT_FAILURE',
        message: 'No evidence supplied; PASS requires at least one verified evidence item.'
      }]
    };
  }

  // Verify all evidence
  const unverifiedEvidence = state.evidence.filter(e => !e.verified);
  for (const e of unverifiedEvidence) {
    const verification = EvidenceVerifier.verify(e);
    if (!verification.verified) {
      return {
        currentRole: 'AUDITOR',
        verdict: 'FAIL',
        history: [{
          timestamp: new Date().toISOString(),
          role: 'AUDITOR',
          action: 'AUDIT_FAILURE',
          message: `Evidence verification failed for ${e.id}: ${verification.error}`
        }]
      };
    }
  }

  return {
    currentRole: 'AUDITOR',
    verdict: 'PASS',
    history: [{
      timestamp: new Date().toISOString(),
      role: 'AUDITOR',
      action: 'AUDIT_SUCCESS',
      message: 'Independent audit passed. All gates and evidence verified.'
    }]
  };
}

// Add nodes to the graph
MaestroGraph.addNode('ceo', ceoNode);
MaestroGraph.addNode('waiting_approval', waitingApprovalNode);
MaestroGraph.addNode('coo', cooNode);
MaestroGraph.addNode('research', researchNode);
MaestroGraph.addNode('developer', developerNode);
MaestroGraph.addNode('qa_security', qaSecurityNode);
MaestroGraph.addNode('auditor', auditorNode);

// Define Edges
MaestroGraph.setEntryPoint('ceo');
MaestroGraph.addEdge('coo', 'research');
MaestroGraph.addEdge('research', 'developer');
MaestroGraph.addEdge('developer', 'qa_security');
MaestroGraph.addEdge('qa_security', 'auditor');
MaestroGraph.addEdge('auditor', 'ceo');

// Conditional edge for final exit and governance gates
MaestroGraph.addConditionalEdges('ceo', (state) => {
  if (state.verdict === 'PASS' || state.verdict === 'FAIL' || state.verdict === 'BLOCKED') {
    console.log(`CEO Node: Terminating with verdict ${state.verdict}`);
    return 'end';
  }

  // M4: Owner HITL Check
  if (state.gates.owner.required && !state.gates.owner.approved) {
    console.log('CEO Node: Redirecting to waiting_approval');
    return 'waiting_approval';
  }

  console.log('CEO Node: Continuing to COO');
  return 'coo';
}, {
  end: '__end__',
  coo: 'coo',
  waiting_approval: 'waiting_approval'
});

const maestroApp = MaestroGraph.compile();

module.exports = {
  MaestroGraph,
  maestroApp
};
