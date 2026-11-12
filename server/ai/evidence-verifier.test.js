const test = require('node:test');
const assert = require('node:assert');
const EvidenceVerifier = require('./evidence-verifier.js');

test('EvidenceVerifier.verify validates and verifies TEST_RESULT', () => {
  const evidence = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'TEST_RESULT',
    source: 'test-agent',
    content: { pass: true, failures: 0 },
    timestamp: new Date().toISOString()
  };

  const result = EvidenceVerifier.verify(evidence);
  assert.strictEqual(result.verified, true);
});

test('EvidenceVerifier.verify rejects failing TEST_RESULT', () => {
  const evidence = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'TEST_RESULT',
    source: 'test-agent',
    content: { pass: false, failures: 1 },
    timestamp: new Date().toISOString()
  };

  const result = EvidenceVerifier.verify(evidence);
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.error, 'Test results did not indicate a pass');
});

test('EvidenceVerifier.verify validates LINT_RESULT', () => {
  const evidence = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'LINT_RESULT',
    source: 'developer-agent',
    content: { errorCount: 0 },
    timestamp: new Date().toISOString()
  };

  const result = EvidenceVerifier.verify(evidence);
  assert.strictEqual(result.verified, true);
});

test('EvidenceVerifier.verify rejects LINT_RESULT with errors', () => {
  const evidence = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'LINT_RESULT',
    source: 'developer-agent',
    content: { errorCount: 5 },
    timestamp: new Date().toISOString()
  };

  const result = EvidenceVerifier.verify(evidence);
  assert.strictEqual(result.verified, false);
});

test('EvidenceVerifier.verify rejects invalid schema', () => {
  const invalidEvidence = {
    type: 'TEST_RESULT',
    content: { pass: true }
  };

  const result = EvidenceVerifier.verify(invalidEvidence);
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.error, 'Invalid evidence schema');
});
