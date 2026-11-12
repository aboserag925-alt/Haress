import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { Command } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

// Import the ACTUAL Maestro graph module. There is no local graph definition
// in this worker: every process below compiles the canonical factory.
const require = createRequire(import.meta.url);
const maestroModule = require('./maestro-graph.js');
const { createMaestroGraph } = maestroModule;

const [dbPath, mode, threadId, sensitiveLog] = process.argv.slice(2);

if (!dbPath || !mode || !threadId || !sensitiveLog) {
  console.error('usage: m9-worker.mjs <dbPath> <mode> <threadId> <sensitiveLog>');
  process.exit(2);
}

mkdirSync(dirname(sensitiveLog), { recursive: true });

function countLines(filePath) {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, 'utf8').split('\n').filter(Boolean).length;
}

function countCheckpointRows(path, thread) {
  // Read-only inspection of the official checkpointer's own store.
  const Database = require('better-sqlite3');
  const db = new Database(path, { readonly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM checkpoints WHERE thread_id = ?').get(thread);
    return row ? Number(row.c) : 0;
  } finally {
    db.close();
  }
}

async function performSensitiveExecution(context) {
  // The real, observable side effect. The graph itself owns the persisted
  // execution counter; this appends the side-effect record exactly once.
  appendFileSync(
    sensitiveLog,
    JSON.stringify({
      taskId: context.taskId,
      approvalId: context.approvalId,
      risk: context.risk,
      pid: process.pid,
      at: new Date().toISOString()
    }) + '\n',
    'utf8'
  );
  return { written: true };
}

const checkpointer = SqliteSaver.fromConnString(dbPath);
const app = createMaestroGraph({ checkpointer, dependencies: { performSensitiveExecution } });
const config = { configurable: { thread_id: threadId } };

function initialHighRiskState() {
  return {
    taskId: '550e8400-e29b-41d4-a716-4466554400a9',
    category: 'DEVELOPMENT',
    description: 'Deploy production database migration for M9 durability',
    status: 'PENDING',
    currentRole: null,
    evidence: [],
    history: [],
    verdict: 'NOT_VERIFIED',
    gates: {
      security: { required: true, approved: false },
      qa: { required: true, approved: false },
      auditor: { required: true, approved: false },
      owner: { required: false, approved: false }
    },
    governance: { state: 'CANDIDATE', version: '1.0.0' }
  };
}

function summarize(values) {
  const evidence = Array.isArray(values.evidence) ? values.evidence : [];
  return {
    pid: process.pid,
    threadId,
    mode,
    taskId: values.taskId ?? null,
    description: values.description ?? null,
    graphModule: require.resolve('./maestro-graph.js'),
    factory: typeof createMaestroGraph,
    status: values.status,
    verdict: values.verdict,
    risk: values.risk,
    ownerRequired: Boolean(values.gates && values.gates.owner && values.gates.owner.required),
    ownerApproved: Boolean(values.gates && values.gates.owner && values.gates.owner.approved),
    executionCount: values.executionCount ?? 0,
    sensitiveExecuted: values.sensitiveExecuted === true,
    hitlState: values.hitl ? values.hitl.state : null,
    approval: values.approval ?? null,
    approvalId: values.approval ? values.approval.approvalId : null,
    audit: values.audit ?? null,
    auditVerified: Boolean(values.audit && values.audit.verified === true),
    auditEvidenceRefs: values.audit && Array.isArray(values.audit.evidenceRefs)
      ? values.audit.evidenceRefs
      : [],
    evidenceIds: evidence.map((item) => item.id),
    history: (values.history || []).map((item) => item.action),
    checkpointRows: countCheckpointRows(dbPath, threadId),
    sensitiveLogLines: countLines(sensitiveLog)
  };
}

async function readState() {
  const snapshot = await app.getState(config);
  return snapshot.values || {};
}

async function main() {
  if (mode === 'init' || mode === 'init-wait') {
    const result = await app.invoke(initialHighRiskState(), config);
    const interrupted = Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0;
    const values = await readState();
    const evidence = summarize(values);
    console.log(JSON.stringify({ ...evidence, interrupted }));
    if (mode === 'init-wait') {
      // Stay alive so the parent can SIGKILL this exact PID after the durable
      // interrupt boundary has been reached.
      setInterval(() => {}, 1000);
      return;
    }
    return;
  }

  if (mode === 'resume-approve' || mode === 'resume-reject') {
    const approved = mode === 'resume-approve';
    const restoredBeforeResume = summarize(await readState());
    const result = await app.invoke(
      new Command({
        resume: {
          approved,
          approver: 'owner',
          approvalId: `owner-${threadId}`,
          reason: approved ? 'Owner approved M9 durability run' : 'Owner rejected M9 durability run'
        }
      }),
      config
    );
    const values = (result && result.values) || (await readState());
    console.log(JSON.stringify({ ...summarize(values), interrupted: false, restoredBeforeResume }));
    return;
  }

  if (mode === 'reload') {
    const values = await readState();
    console.log(JSON.stringify({ ...summarize(values), interrupted: false }));
    return;
  }

  if (mode === 'duplicate') {
    const before = await readState();
    let duplicateError = null;
    try {
      await app.invoke(
        new Command({ resume: { approved: true, approver: 'owner', approvalId: `owner-${threadId}` } }),
        config
      );
    } catch (error) {
      duplicateError = error.message;
    }
    const after = await readState();
    console.log(JSON.stringify({
      ...summarize(after),
      beforeExecutionCount: before.executionCount ?? 0,
      duplicateError
    }));
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main().catch((error) => {
  console.error(JSON.stringify({ pid: process.pid, mode, error: error.message }));
  process.exit(1);
});
