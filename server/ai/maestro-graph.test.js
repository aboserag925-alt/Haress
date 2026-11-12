const test = require('node:test');
const assert = require('node:assert');
const { maestroApp } = require('./maestro-graph.js');

test('MaestroGraph Auditor fails if required gates are missing', async () => {
  const initialState = {
    taskId: '550e8400-e29b-41d4-a716-446655440003',
    category: 'DEVELOPMENT',
    description: 'Test Audit Failure',
    status: 'PENDING',
    evidence: [],
    history: [],
    verdict: 'NOT_VERIFIED',
    gates: {
      security: { required: true, approved: false }, // REQUIRED BUT NOT APPROVED
      qa: { required: true, approved: false },
      auditor: { required: true, approved: false },
      owner: { required: false, approved: false }
    },
    governance: { state: 'CANDIDATE', version: '1.0.0' }
  };

  const result = await maestroApp.invoke(initialState);

  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.history.some(h => h.action === 'AUDIT_FAILURE'));
});

test('MaestroGraph Auditor fails closed when no evidence exists even if gates are approved', async () => {
  const initialState = {
    taskId: '550e8400-e29b-41d4-a716-446655440006',
    category: 'DEVELOPMENT',
    description: 'Test Audit Without Evidence',
    status: 'PENDING',
    evidence: [],
    history: [],
    verdict: 'NOT_VERIFIED',
    gates: {
      security: { required: true, approved: true },
      qa: { required: true, approved: true },
      auditor: { required: true, approved: true },
      owner: { required: false, approved: false }
    },
    governance: { state: 'CANDIDATE', version: '1.0.0' }
  };

  const result = await maestroApp.invoke(initialState);

  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.history.some(h => h.action === 'AUDIT_FAILURE'));
});

test('MaestroGraph Auditor passes if gates and evidence are valid', async () => {
  const initialState = {
    taskId: '550e8400-e29b-41d4-a716-446655440004',
    category: 'RESEARCH',
    description: 'Test Audit Success',
    status: 'PENDING',
    evidence: [{
      id: '550e8400-e29b-41d4-a716-446655440005',
      type: 'TEST_RESULT',
      source: 'test-agent',
      content: { pass: true },
      timestamp: new Date().toISOString()
    }],
    history: [],
    verdict: 'NOT_VERIFIED',
    gates: {
      security: { required: true, approved: true }, // APPROVED
      qa: { required: true, approved: true },
      auditor: { required: true, approved: false },
      owner: { required: false, approved: false }
    },
    governance: { state: 'CANDIDATE', version: '1.0.0' }
  };

  const result = await maestroApp.invoke(initialState);

  assert.strictEqual(result.verdict, 'PASS');
  assert.ok(result.history.some(h => h.action === 'AUDIT_SUCCESS'));
});
