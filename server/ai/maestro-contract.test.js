const test = require('node:test');
const assert = require('node:assert');
const { MaestroStateSchema } = require('./maestro-contract.js');

test('MaestroStateSchema validates a valid state', () => {
  const validState = {
    taskId: '550e8400-e29b-41d4-a716-446655440000',
    category: 'DEVELOPMENT',
    description: 'Implement Maestro M1',
    status: 'IN_PROGRESS',
    evidence: [],
    history: []
  };

  const result = MaestroStateSchema.safeParse(validState);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.verdict, 'NOT_VERIFIED');
  assert.strictEqual(result.data.gates.security.required, true);
});

test('MaestroStateSchema rejects invalid task ID', () => {
  const invalidState = {
    taskId: 'not-a-uuid',
    category: 'DEVELOPMENT',
    description: 'Test',
    status: 'PENDING'
  };

  const result = MaestroStateSchema.safeParse(invalidState);
  assert.strictEqual(result.success, false);
});

test('MaestroStateSchema rejects invalid category', () => {
  const invalidState = {
    taskId: '550e8400-e29b-41d4-a716-446655440000',
    category: 'INVALID_CATEGORY',
    description: 'Test',
    status: 'PENDING'
  };

  const result = MaestroStateSchema.safeParse(invalidState);
  assert.strictEqual(result.success, false);
});

test('MaestroStateSchema enforces default governance state', () => {
  const state = {
    taskId: '550e8400-e29b-41d4-a716-446655440000',
    category: 'RESEARCH',
    description: 'Test',
    status: 'PENDING'
  };

  const result = MaestroStateSchema.parse(state);
  assert.strictEqual(result.governance.state, 'CANDIDATE');
});

test('MaestroStateSchema validates evidence objects', () => {
  const stateWithEvidence = {
    taskId: '550e8400-e29b-41d4-a716-446655440000',
    category: 'QA',
    description: 'Testing',
    status: 'COMPLETED',
    evidence: [{
      id: '550e8400-e29b-41d4-a716-446655440001',
      type: 'TEST_RESULT',
      source: 'test-agent',
      content: { pass: true },
      timestamp: new Date().toISOString(),
      verified: true
    }]
  };

  const result = MaestroStateSchema.safeParse(stateWithEvidence);
  assert.strictEqual(result.success, true);
});
