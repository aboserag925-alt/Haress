/**
 * Maestro Studio Data Adapter (M3, M4, M5, M6, M10, M11)
 *
 * Provides centralized data boundary for Maestro Studio shell.
 * MOCK DATA is visibly labeled with [MOCK].
 * All mutations conceptually flow through Studio -> Maestro Policy -> Risk -> Verifier -> Audit.
 */

class MaestroStudioAdapter {
  constructor() {
    this._subscribers = new Set();
    this._state = {
      activeTab: 'mission',
      tasks: [
        { id: 't-1', category: 'DEVELOPMENT', description: '[MOCK] Migrate database schema', status: 'WAITING_APPROVAL', risk: 'HIGH', verdict: 'NOT_VERIFIED' },
        { id: 't-2', category: 'RESEARCH', description: '[MOCK] Analyze system architecture', status: 'COMPLETED', risk: 'LOW', verdict: 'PASS' }
      ],
      agents: [
        { role: 'CEO', name: 'Strategic Supervisor', status: 'ACTIVE' },
        { role: 'COO', name: 'Operations & Router', status: 'ACTIVE' },
        { role: 'RESEARCH', name: 'Content / Code Analyzer', status: 'ACTIVE' },
        { role: 'DEVELOPER', name: 'Implementation Agent', status: 'ACTIVE' },
        { role: 'QA_SECURITY', name: 'Test & Security Verifier', status: 'ACTIVE' },
        { role: 'AUDITOR', name: 'Independent Auditor', status: 'ACTIVE' }
      ],
      evidence: [
        { id: 'ev-1', type: 'TEST_RESULT', source: 'test-agent', content: { pass: true }, verified: true, timestamp: new Date().toISOString() }
      ],
      tests: {
        mock: true,
        note: 'Static demo data only; not execution evidence',
        original: 85,
        maestro: 32,
        total: 117,
        pass: 117,
        fail: 0
      },
      gates: {
        security: { required: true, approved: true },
        qa: { required: true, approved: true },
        owner: { required: true, approved: false }
      }
    };
  }

  getState() {
    return JSON.parse(JSON.stringify(this._state));
  }

  dispatch(action) {
    console.log('[Studio Dispatch]', action.type, action.payload);
    switch (action.type) {
      case 'SET_TAB':
        this._state.activeTab = action.payload;
        break;
      case 'APPROVE_OWNER_GATE':
        this._state.gates.owner.approved = true;
        this._state.tasks.forEach(t => { if (t.status === 'WAITING_APPROVAL') t.status = 'IN_PROGRESS'; });
        break;
      case 'ADD_TASK':
        this._state.tasks.push({
          id: `t-${Date.now()}`,
          category: action.payload.category || 'DEVELOPMENT',
          description: `[MOCK] ${action.payload.description}`,
          status: 'PENDING',
          risk: action.payload.risk || 'MEDIUM',
          verdict: 'NOT_VERIFIED'
        });
        break;
      default:
        break;
    }
    this._notify();
    return this.getState();
  }

  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  _notify() {
    const state = this.getState();
    for (const sub of this._subscribers) {
      sub(state);
    }
  }

  getEvidence() {
    return this._state.evidence;
  }

  getTests() {
    return this._state.tests;
  }
}

module.exports = {
  MaestroStudioAdapter
};
