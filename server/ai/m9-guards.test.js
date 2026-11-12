const test = require('node:test');
const assert = require('node:assert');
const { MemorySaver } = require('@langchain/langgraph');
const { createMaestroGraph } = require('./maestro-graph.js');

// Direct guard tests for the developer (sensitive execution) node. They place
// the thread so that `developer` is the next node, then check the side effect
// callback. These kill mutations that the cross-process tests cannot reach.

function baseValues(overrides = {}) {
  return {
    taskId: '550e8400-e29b-41d4-a716-4466554400b1',
    category: 'DEVELOPMENT',
    description: 'Deploy production database migration for guard test',
    status: 'PENDING',
    currentRole: null,
    evidence: [],
    history: [],
    verdict: 'NOT_VERIFIED',
    risk: 'CRITICAL',
    ownerHitlRequired: true,
    governance: { state: 'CANDIDATE', version: '1.0.0' },
    ...overrides
  };
}

async function runDeveloperNode(values) {
  let calls = 0;
  const app = createMaestroGraph({
    checkpointer: new MemorySaver(),
    dependencies: { performSensitiveExecution: async () => { calls += 1; return { written: true }; } }
  });
  const config = { configurable: { thread_id: `guard-${Math.random().toString(16).slice(2)}` } };
  // Next node after `research` is `developer`.
  await app.updateState(config, values, 'research');
  await app.invoke(null, config);
  const state = (await app.getState(config)).values;
  return { calls, state };
}

const gates = (ownerApproved) => ({
  security: { required: true, approved: false },
  qa: { required: true, approved: false },
  auditor: { required: true, approved: false },
  owner: { required: true, approved: ownerApproved }
});

test('guard: high-risk execution without approved Owner gate never executes', async () => {
  const { calls, state } = await runDeveloperNode(baseValues({ gates: gates(false) }));
  assert.strictEqual(calls, 0, 'sensitive action must not run without Owner approval');
  assert.notStrictEqual(state.verdict, 'PASS');
  assert.ok(!state.executionCount, 'executionCount must stay 0');
});

test('guard: already-executed task is not executed again (idempotency)', async () => {
  const { calls, state } = await runDeveloperNode(
    baseValues({ gates: gates(true), executionCount: 1, sensitiveExecuted: true })
  );
  assert.strictEqual(calls, 0, 'sensitive action must not run a second time');
  assert.strictEqual(state.executionCount, 1);
});

test('control: approved and not yet executed runs exactly once', async () => {
  const { calls, state } = await runDeveloperNode(baseValues({ gates: gates(true) }));
  assert.strictEqual(calls, 1);
  assert.strictEqual(state.executionCount, 1);
});
