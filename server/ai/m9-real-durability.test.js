const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

test('M9 Real Cross-Process SqliteSaver Durability & Execution Count', (t) => {
  // M9 remains NOT_VERIFIED unless real cross-process resume can actually execute here.
  const probe = spawnSync('node', ['-e', "new (require('better-sqlite3'))(':memory:')"], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('M9_DURABILITY=NOT_VERIFIED: better-sqlite3 native bindings unavailable in this environment');
    return;
  }

  // Runtime artifacts stay inside the gitignored storage/ directory.
  const tmpDir = path.join(__dirname, '../../storage/tmp-m9');
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, 'm9-test-db.sqlite');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  // Committed helper script runs inside child processes (Process A, B, C).
  // It is read-only here: the test must never mutate the candidate.
  const workerScript = path.join(__dirname, 'm9-worker.mjs');

  const threadId = 'thread-m9-real';

  // --- Process A: Init & reach interrupt ---
  const procA = spawnSync('node', [workerScript, dbPath, 'init', threadId], { encoding: 'utf8' });
  assert.strictEqual(procA.status, 0);
  const linesA = procA.stdout.trim().split('\n');
  const outA = JSON.parse(linesA[linesA.length - 1]);
  const pidA = outA.pid;
  assert.ok(pidA);
  // Before approval, execution ran once up to interrupt
  assert.strictEqual(outA.values.executionRuns, 1);

  // --- Process B: Resume with approval (Fresh PID) ---
  const procB = spawnSync('node', [workerScript, dbPath, 'resume-approve', threadId], { encoding: 'utf8' });
  assert.strictEqual(procB.status, 0);
  const linesB = procB.stdout.trim().split('\n');
  const outB = JSON.parse(linesB[linesB.length - 1]);
  const pidB = outB.pid;
  assert.ok(pidB);
  assert.notStrictEqual(pidA, pidB);
  assert.strictEqual(outB.res.verdict, 'PASS');
  assert.strictEqual(outB.res.executionRuns, 1); // Exactly 1 execution count before completion

  // --- Process C: Reload/Verify final state (Fresh PID) ---
  const procC = spawnSync('node', [workerScript, dbPath, 'verify', threadId], { encoding: 'utf8' });
  assert.strictEqual(procC.status, 0);
  const linesC = procC.stdout.trim().split('\n');
  const outC = JSON.parse(linesC[linesC.length - 1]);
  const pidC = outC.pid;
  assert.ok(pidC);
  assert.notStrictEqual(pidB, pidC);
  assert.strictEqual(outC.values.verdict, 'PASS');
  assert.strictEqual(outA.values.executionRuns, 1);

  // Clean up runtime artifacts only; never the committed worker script.
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
