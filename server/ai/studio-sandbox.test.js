const test = require('node:test');
const assert = require('node:assert');
const { MaestroStudioAdapter } = require('./studio-adapter.js');
const { MockSandboxProvider } = require('./sandbox-provider.js');

test('MaestroStudioAdapter initializes with mock data and supports dispatch', () => {
  const adapter = new MaestroStudioAdapter();
  const state = adapter.getState();

  assert.ok(state.tasks);
  assert.match(state.tasks[0].description, /\[MOCK\]/);
  assert.strictEqual(state.tests.original, 85);

  const updated = adapter.dispatch({ type: 'ADD_TASK', payload: { category: 'DEVELOPMENT', description: 'New mock task', risk: 'HIGH' } });
  assert.strictEqual(updated.tasks.length, 3);
  assert.match(updated.tasks[2].description, /\[MOCK\]/);
});

test('MockSandboxProvider enforces policy command allowlist and returns untrusted output', async () => {
  const provider = new MockSandboxProvider();
  const sandboxId = await provider.createSandbox({
    commandAllowlist: ['npm test']
  });

  // Allowed command
  const res1 = await provider.execute(sandboxId, 'npm test');
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.untrusted, true);

  // Disallowed command
  const res2 = await provider.execute(sandboxId, 'rm -rf /');
  assert.strictEqual(res2.success, false);
  assert.match(res2.error, /Policy Violation/);

  await provider.destroy(sandboxId);
});
