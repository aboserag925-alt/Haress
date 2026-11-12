const test = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// These tests mechanically exercise the ACTUAL Maestro graph. Every worker
// process imports `server/ai/maestro-graph.js`; there is no substitute graph.
const WORKER = path.join(__dirname, 'm9-worker.mjs');
const GRAPH_MODULE = require.resolve('./maestro-graph.js');

function createWorkspace(label) {
  const dir = path.join(
    __dirname,
    '../../storage/tmp-m9',
    `${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return {
    db: path.join(dir, 'checkpoints.sqlite'),
    log: path.join(dir, 'sensitive.log'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function runWorker(args) {
  const result = spawnSync(process.execPath, [WORKER, ...args], {
    encoding: 'utf8',
    timeout: 120000
  });
  assert.strictEqual(
    result.status,
    0,
    `worker mode=${args[1]} failed: ${result.stderr || result.stdout}`
  );
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, `worker mode=${args[1]} produced no evidence`);
  return JSON.parse(lines[lines.length - 1]);
}

function checkpointRows(dbPath, threadId) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM checkpoints WHERE thread_id = ?').get(threadId);
    return Number(row.c);
  } finally {
    db.close();
  }
}

function sensitiveLines(logPath) {
  if (!fs.existsSync(logPath)) return 0;
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
}

function waitForFirstJson(child) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      child.stdout.off('data', onData);
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    };
    child.stdout.on('data', onData);
    child.once('error', reject);
  });
}

test('M9 approve: durable interrupt, cross-process resume, and reload', () => {
  const workspace = createWorkspace('approve');
  const threadId = `m9-approve-${process.pid}-${Date.now()}`;

  try {
    // Process A: actual Maestro graph, file-backed checkpointer, real interrupt.
    const a = runWorker([workspace.db, 'init', threadId, workspace.log]);
    assert.strictEqual(a.graphModule, GRAPH_MODULE, 'worker must import the actual Maestro graph module');
    assert.strictEqual(a.factory, 'function');
    assert.ok(a.pid > 0);
    assert.strictEqual(a.interrupted, true, 'graph must reach a real LangGraph interrupt');
    assert.strictEqual(a.risk, 'CRITICAL');
    assert.strictEqual(a.ownerRequired, true);
    assert.strictEqual(a.ownerApproved, false);
    assert.strictEqual(a.hitlState, 'WAITING_OWNER_APPROVAL');
    assert.strictEqual(a.executionCount, 0, 'no sensitive execution before Owner approval');
    assert.strictEqual(a.sensitiveExecuted, false);
    assert.ok(a.checkpointRows > 0, 'checkpoint records must exist at the interrupt boundary');
    assert.ok(checkpointRows(workspace.db, threadId) > 0);
    assert.strictEqual(sensitiveLines(workspace.log), 0);

    // Process B: fresh PID, same thread, real Command resume.
    const b = runWorker([workspace.db, 'resume-approve', threadId, workspace.log]);
    assert.notStrictEqual(b.pid, a.pid, 'resume must happen in a different process');

    // The persisted state must be restored BEFORE the resume command runs.
    const restored = b.restoredBeforeResume;
    assert.ok(restored, 'process B must read the persisted graph state before resuming');
    assert.strictEqual(restored.taskId, a.taskId);
    assert.strictEqual(restored.risk, 'CRITICAL');
    assert.strictEqual(restored.hitlState, 'WAITING_OWNER_APPROVAL');
    assert.strictEqual(restored.executionCount, 0);
    assert.deepStrictEqual(restored.evidenceIds, []);
    assert.strictEqual(restored.audit, null);
    assert.ok(restored.checkpointRows > 0);

    assert.strictEqual(b.threadId, threadId);
    assert.strictEqual(b.executionCount, 1, 'approved execution must run exactly once');
    assert.strictEqual(b.verdict, 'PASS');
    assert.strictEqual(b.ownerApproved, true);
    assert.strictEqual(b.approval.decision, 'APPROVE');
    assert.strictEqual(b.hitlState, 'OWNER_APPROVED');
    assert.ok(b.evidenceIds.length >= 1, 'audit requires real evidence');
    assert.strictEqual(b.auditVerified, true);
    assert.deepStrictEqual(b.auditEvidenceRefs, b.evidenceIds);
    assert.ok(b.checkpointRows > a.checkpointRows);
    assert.strictEqual(b.sensitiveLogLines, 1);
    assert.strictEqual(sensitiveLines(workspace.log), 1);

    // Process C: fresh PID, reload only. No sensitive re-execution.
    const c = runWorker([workspace.db, 'reload', threadId, workspace.log]);
    assert.notStrictEqual(c.pid, b.pid);
    assert.strictEqual(c.executionCount, 1, 'reload must not re-execute the sensitive action');
    assert.strictEqual(c.verdict, 'PASS');
    assert.deepStrictEqual(c.evidenceIds, b.evidenceIds);
    assert.deepStrictEqual(c.auditEvidenceRefs, b.auditEvidenceRefs);
    assert.deepStrictEqual(c.approval, b.approval);
    assert.strictEqual(c.sensitiveLogLines, 1);
    assert.strictEqual(checkpointRows(workspace.db, threadId), c.checkpointRows);
  } finally {
    workspace.cleanup();
  }
});

test('M9 SIGKILL: recover a hard-killed process from the durable interrupt', async () => {
  const workspace = createWorkspace('sigkill');
  const threadId = `m9-sigkill-${process.pid}-${Date.now()}`;
  const child = spawn(process.execPath, [WORKER, workspace.db, 'init-wait', threadId, workspace.log], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const a = await waitForFirstJson(child);
    assert.strictEqual(a.pid, child.pid);
    assert.strictEqual(a.graphModule, GRAPH_MODULE);
    assert.strictEqual(a.interrupted, true);
    assert.strictEqual(a.executionCount, 0);
    assert.strictEqual(a.hitlState, 'WAITING_OWNER_APPROVAL');
    assert.ok(checkpointRows(workspace.db, threadId) > 0);
    assert.strictEqual(sensitiveLines(workspace.log), 0);

    // Abnormally terminate the process from the parent, after the durable
    // interrupt boundary has already been reached.
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGKILL');
    const termination = await exited;
    assert.strictEqual(termination.signal, 'SIGKILL');
    assert.strictEqual(child.signalCode, 'SIGKILL');
    assert.throws(() => process.kill(a.pid, 0), /ESRCH/, 'killed process must no longer exist');

    // Fresh process resumes the killed thread from the persistent store.
    const b = runWorker([workspace.db, 'resume-approve', threadId, workspace.log]);
    assert.notStrictEqual(b.pid, a.pid);
    assert.strictEqual(b.executionCount, 1);
    assert.strictEqual(b.verdict, 'PASS');
    assert.strictEqual(b.sensitiveLogLines, 1);
    assert.strictEqual(sensitiveLines(workspace.log), 1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    workspace.cleanup();
  }
});

test('M9 reject: Owner rejection survives restart and never executes', () => {
  const workspace = createWorkspace('reject');
  const threadId = `m9-reject-${process.pid}-${Date.now()}`;

  try {
    const a = runWorker([workspace.db, 'init', threadId, workspace.log]);
    assert.strictEqual(a.interrupted, true);
    assert.strictEqual(a.executionCount, 0);
    assert.strictEqual(a.hitlState, 'WAITING_OWNER_APPROVAL');

    const b = runWorker([workspace.db, 'resume-reject', threadId, workspace.log]);
    assert.notStrictEqual(b.pid, a.pid);
    assert.strictEqual(b.restoredBeforeResume.hitlState, 'WAITING_OWNER_APPROVAL');
    assert.strictEqual(b.restoredBeforeResume.executionCount, 0);
    assert.strictEqual(b.restoredBeforeResume.risk, 'CRITICAL');
    assert.strictEqual(b.executionCount, 0, 'rejection must never execute the sensitive action');
    assert.strictEqual(b.verdict, 'BLOCKED');
    assert.notStrictEqual(b.verdict, 'PASS');
    assert.strictEqual(b.approval.decision, 'REJECT');
    assert.strictEqual(b.hitlState, 'OWNER_REJECTED');
    assert.ok(b.audit && b.audit.rejection, 'audit must record the rejection');
    assert.strictEqual(b.sensitiveLogLines, 0);
    assert.strictEqual(sensitiveLines(workspace.log), 0);

    const c = runWorker([workspace.db, 'reload', threadId, workspace.log]);
    assert.notStrictEqual(c.pid, b.pid);
    assert.strictEqual(c.executionCount, 0);
    assert.strictEqual(c.verdict, 'BLOCKED');
    assert.ok(c.audit && c.audit.rejection);
    assert.strictEqual(sensitiveLines(workspace.log), 0);
  } finally {
    workspace.cleanup();
  }
});

test('M9 duplicate resume: idempotent, no second sensitive execution', () => {
  const workspace = createWorkspace('duplicate');
  const threadId = `m9-duplicate-${process.pid}-${Date.now()}`;

  try {
    const a = runWorker([workspace.db, 'init', threadId, workspace.log]);
    assert.strictEqual(a.interrupted, true);
    assert.strictEqual(a.executionCount, 0);

    const b = runWorker([workspace.db, 'resume-approve', threadId, workspace.log]);
    assert.strictEqual(b.executionCount, 1);
    assert.strictEqual(b.verdict, 'PASS');
    assert.strictEqual(sensitiveLines(workspace.log), 1);

    // Duplicate recovery attempt after completion. It must either be a no-op
    // or fail closed, but it must never execute the sensitive action again.
    const d = runWorker([workspace.db, 'duplicate', threadId, workspace.log]);
    assert.notStrictEqual(d.pid, b.pid);
    assert.strictEqual(d.beforeExecutionCount, 1);
    assert.strictEqual(d.executionCount, 1, 'duplicate resume must not increment the execution counter');
    assert.strictEqual(d.sensitiveLogLines, 1);
    assert.strictEqual(sensitiveLines(workspace.log), 1);
  } finally {
    workspace.cleanup();
  }
});
