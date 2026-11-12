const test = require('node:test');
const assert = require('node:assert');
const RoleWrappers = require('./index.js');

test('RoleWrappers execute CEO role successfully', async () => {
  const state = { taskId: '123', category: 'RESEARCH', description: 'Test CEO' };
  const res = await RoleWrappers.executeCEORole(state);
  assert.strictEqual(res.role, 'CEO');
  assert.ok(res.summary);
});

test('RoleWrappers execute COO role successfully', async () => {
  const state = { taskId: '123', category: 'RESEARCH', description: 'Test COO' };
  const res = await RoleWrappers.executeCOORole(state);
  assert.strictEqual(res.role, 'COO');
});

test('RoleWrappers execute Research role successfully', async () => {
  const state = { taskId: '123', category: 'RESEARCH', description: 'Test Research' };
  const res = await RoleWrappers.executeResearchRole(state);
  assert.strictEqual(res.role, 'RESEARCH');
});

test('RoleWrappers execute Developer role successfully', async () => {
  const state = { taskId: '123', category: 'DEVELOPMENT', description: 'Test Dev' };
  const res = await RoleWrappers.executeDeveloperRole(state);
  assert.strictEqual(res.role, 'DEVELOPER');
});

test('RoleWrappers execute QA/Security role successfully', async () => {
  const state = { taskId: '123', category: 'SECURITY', description: 'Test QA' };
  const res = await RoleWrappers.executeQASecurityRole(state);
  assert.strictEqual(res.role, 'QA_SECURITY');
  assert.strictEqual(res.pass, true);
});

test('RoleWrappers execute Auditor role successfully', async () => {
  const state = { taskId: '123', category: 'AUDIT', description: 'Test Auditor', verdict: 'PASS' };
  const res = await RoleWrappers.executeAuditorRole(state);
  assert.strictEqual(res.role, 'AUDITOR');
  assert.strictEqual(res.auditVerdict, 'PASS');
});
