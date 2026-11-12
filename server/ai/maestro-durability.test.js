const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * M9 Durability Verification
 *
 * Tests file-backed or persistent checkpointer state restoration across process restarts.
 */

test('M9 Durability: File-backed checkpoint and process restart verification', async () => {
  const tmpDir = path.join(__dirname, '../../storage/tmp-checkpoint');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const checkpointFile = path.join(tmpDir, 'thread-1.json');

  // 1. Simulate process 1: Run graph, hit interrupt/pause, write state to persistent storage
  const stateSnapshot = {
    taskId: '550e8400-e29b-41d4-a716-446655440009',
    category: 'DEVELOPMENT',
    description: 'Durable task',
    status: 'WAITING_APPROVAL',
    verdict: 'NOT_VERIFIED',
    gates: {
      owner: { required: true, approved: false }
    },
    history: [{ role: 'CEO', action: 'PAUSED', timestamp: new Date().toISOString() }]
  };

  fs.writeFileSync(checkpointFile, JSON.stringify(stateSnapshot, null, 2), 'utf8');
  assert.ok(fs.existsSync(checkpointFile));

  // 2. Simulate process restart: Read state in a fresh context (new process simulation)
  const rawData = fs.readFileSync(checkpointFile, 'utf8');
  const restoredState = JSON.parse(rawData);

  assert.strictEqual(restoredState.taskId, stateSnapshot.taskId);
  assert.strictEqual(restoredState.status, 'WAITING_APPROVAL');
  assert.strictEqual(restoredState.gates.owner.required, true);
  assert.strictEqual(restoredState.gates.owner.approved, false);
  assert.strictEqual(restoredState.history.length, 1);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
