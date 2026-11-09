'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const verifier = require('./verifier-agent');

test('Verifier: fails when evidence is missing', async () => {
  const result = await verifier.run({ task: { id: 't1' }, input: {} });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Evidence contract missing')));
});

test('Verifier: fails when executionSha is missing', async () => {
  const result = await verifier.run({
    task: { id: 't1' },
    input: { evidence: { testResults: [{ name: 'unit', status: 'PASS' }], securitySignoff: true, approvals: [{ id: 'a1' }] } }
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Execution SHA missing')));
});

test('Verifier: fails when executionSha mismatches (simulated)', async () => {
  // In a real scenario, the verifier might re-calculate the SHA or compare against a target
  // For Phase 1, we expect the evidence to have a valid SHA and maybe match the task's target if provided.
  const result = await verifier.run({
    task: { id: 't1', targetSha: 'expected-sha' },
    input: { evidence: { executionSha: 'wrong-sha', testResults: [{ name: 'unit', status: 'PASS' }], securitySignoff: true, approvals: [{ id: 'a1' }] } }
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Execution SHA mismatch')));
});

test('Verifier: fails when test results are missing or empty', async () => {
  const result = await verifier.run({
    task: { id: 't1' },
    input: { evidence: { executionSha: 'sha1', testResults: [], securitySignoff: true, approvals: [{ id: 'a1' }] } }
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Test results missing or empty')));
});

test('Verifier: fails when any test failed', async () => {
  const result = await verifier.run({
    task: { id: 't1' },
    input: { evidence: { executionSha: 'sha1', testResults: [{ name: 't1', status: 'PASS' }, { name: 't2', status: 'FAIL' }], securitySignoff: true, approvals: [{ id: 'a1' }] } }
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Test failures detected')));
});

test('Verifier: fails when security signoff is missing', async () => {
  const result = await verifier.run({
    task: { id: 't1' },
    input: { evidence: { executionSha: 'sha1', testResults: [{ name: 'unit', status: 'PASS' }], approvals: [{ id: 'a1' }] } }
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Security signoff missing')));
});

test('Verifier: fails when required approvals are missing', async () => {
  const result = await verifier.run({
    task: { id: 't1' },
    input: { evidence: { executionSha: 'sha1', testResults: [{ name: 'unit', status: 'PASS' }], securitySignoff: true, approvals: [] } }
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Required approvals missing')));
});

test('Verifier: fails on execution failure signal', async () => {
  const result = await verifier.run({
    task: { id: 't1' },
    input: { evidence: { executionSha: 'sha1', testResults: [{ name: 'unit', status: 'PASS' }], securitySignoff: true, approvals: [{ id: 'a1' }], executionFailed: true } }
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(i => i.includes('Execution failure signaled')));
});

test('Verifier: passes when all evidence is valid', async () => {
  const result = await verifier.run({
    task: { id: 't1', targetSha: 'sha1' },
    input: {
      evidence: {
        executionSha: 'sha1',
        testResults: [{ name: 'unit', status: 'PASS' }],
        securitySignoff: true,
        approvals: [{ id: 'a1' }]
      }
    }
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.issues.length, 0);
});

test('Verifier: fails closed on exception', async () => {
  // We can't easily force an internal exception without mocking,
  // but we can test that any unexpected structure or type error results in FAIL.
  const result = await verifier.run({
    task: { id: 't1' },
    input: { evidence: null } // should throw if not handled, but we want it to FAIL
  });
  assert.equal(result.status, 'FAIL');
});
