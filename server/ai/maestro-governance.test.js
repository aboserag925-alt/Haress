const test = require('node:test');
const assert = require('node:assert');
const MaestroGovernance = require('./maestro-governance.js');

test('MaestroGovernance evaluates risk and policy', async () => {
  const state = {
    category: 'DEVELOPMENT',
    description: 'Update production database'
  };

  const evaluation = await MaestroGovernance.evaluateTask(state);

  assert.ok(evaluation.risk);
  assert.strictEqual(evaluation.risk.level, 'CRITICAL');
  // Development on production should be critical/high risk
  assert.strictEqual(evaluation.ownerHitlRequired, true);
});

test('MaestroGovernance identifies safe tasks', async () => {
  const state = {
    category: 'RESEARCH',
    description: 'Read documentation'
  };

  const evaluation = await MaestroGovernance.evaluateTask(state);
  assert.strictEqual(evaluation.ownerHitlRequired, false);
  assert.strictEqual(evaluation.risk.level, 'LOW');
});

test('MaestroGovernance identifies high risk security tasks', async () => {
  const state = {
    category: 'SECURITY',
    description: 'Audit authentication'
  };

  const evaluation = await MaestroGovernance.evaluateTask(state);
  assert.strictEqual(evaluation.ownerHitlRequired, true);
  assert.strictEqual(evaluation.risk.level, 'HIGH');
});
