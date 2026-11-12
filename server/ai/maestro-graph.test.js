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

test('MaestroGraph blocks a missing QA approval even when evidence is valid', async () => {
  const initialState = {
    taskId: '550e8400-e29b-41d4-a716-446655440007',
    category: 'DEVELOPMENT',
    description: 'Test Missing QA Approval',
    status: 'PENDING',
    evidence: [{
      id: '550e8400-e29b-41d4-a716-446655440008',
      type: 'TEST_RESULT',
      source: 'test-agent',
      content: { pass: true },
      timestamp: new Date().toISOString()
    }],
    history: [],
    verdict: 'NOT_VERIFIED',
    gates: {
      security: { required: true, approved: true },
      qa: { required: true, approved: false }, // REQUIRED BUT NOT APPROVED
      auditor: { required: true, approved: false },
      owner: { required: false, approved: false }
    },
    governance: { state: 'CANDIDATE', version: '1.0.0' }
  };

  const result = await maestroApp.invoke(initialState);

  // Fail closed: the missing gate can never produce a PASS.
  assert.notStrictEqual(result.verdict, 'PASS');
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.history.some(
    h => h.action === 'AUDIT_FAILURE' && /Missing required approvals/.test(h.message)
  ));
});

test('MaestroGraph stops at waiting_approval when the owner gate is unapproved', async () => {
  const initialState = {
    taskId: '550e8400-e29b-41d4-a716-446655440009',
    category: 'DEVELOPMENT',
    description: 'Test Owner Gate',
    status: 'PENDING',
    evidence: [{
      id: '550e8400-e29b-41d4-a716-446655440010',
      type: 'TEST_RESULT',
      source: 'test-agent',
      content: { pass: true },
      timestamp: new Date().toISOString()
    }],
    // Pre-existing history keeps the CEO node from re-evaluating the owner gate.
    history: [{
      timestamp: new Date().toISOString(),
      role: 'CEO',
      action: 'SEEDED',
      message: 'Existing history'
    }],
    verdict: 'NOT_VERIFIED',
    gates: {
      security: { required: true, approved: true },
      qa: { required: true, approved: true },
      auditor: { required: true, approved: true },
      owner: { required: true, approved: false } // OWNER APPROVAL MISSING
    },
    governance: { state: 'CANDIDATE', version: '1.0.0' }
  };

  const result = await maestroApp.invoke(initialState);

  assert.strictEqual(result.status, 'BLOCKED');
  assert.strictEqual(result.verdict, 'BLOCKED');
  assert.ok(!result.history.some(h => h.action === 'AUDIT_SUCCESS'));
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
