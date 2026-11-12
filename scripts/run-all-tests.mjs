import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Audit policy: a suite is clean only when it has tests and zero
// failures, zero skipped tests, and zero pending (todo) tests.
const COUNT_KEYS = ['tests', 'pass', 'fail', 'skipped', 'todo'];

export function parseTapCounts(output) {
  const counts = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
  for (const line of String(output).split('\n')) {
    const match = line.match(/^#\s+(tests|pass|fail|skipped|todo)\s+(\d+)\s*$/);
    if (match) counts[match[1]] = Number(match[2]);
  }
  return counts;
}

export function runSuite(label, files) {
  // A nested `node --test` must not inherit the outer runner's child context.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;

  const result = spawnSync('node', ['--test', '--test-reporter=tap', ...files], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const counts = parseTapCounts(stdout);
  const clean = counts.tests > 0 &&
    counts.fail === 0 &&
    counts.skipped === 0 &&
    counts.todo === 0;
  return {
    label,
    status: result.status,
    counts,
    ok: result.status === 0 && clean,
    stdout,
    stderr
  };
}

function formatCounts(counts) {
  return COUNT_KEYS.map(key => `${key}=${counts[key]}`).join(' ');
}

function addCounts(total, counts) {
  for (const key of COUNT_KEYS) total[key] += counts[key];
}

function main() {
  const originalTests = [
    'server/index.test.js',
    'server/media-library.test.js',
    'server/media-storage.test.js',
    'server/lecture-api.test.js',
    'server/suggestions/suggestion.test.js',
    'server/ai/ai.test.js',
    'server/ai/approval-api.test.js',
    'app/pwa-assets.test.js',
    'scripts/smoke-check.test.mjs',
    'worker/live.test.mjs'
  ];

  const maestroTests = [
    'server/ai/maestro-contract.test.js',
    'server/ai/evidence-verifier.test.js',
    'server/ai/maestro-graph.test.js',
    'server/ai/maestro-governance.test.js',
    'server/ai/roles/roles.test.js',
    'server/ai/governance/governance.test.js',
    'server/ai/m9-json-roundtrip-NOT-EVIDENCE.test.js',
    'server/ai/maestro-m9-audit.test.js'
  ];

  const studioTests = [
    'server/ai/studio-sandbox.test.js'
  ];

  const toolingTests = [
    'scripts/run-all-tests.test.mjs'
  ];

  const suites = [
    ['ORIGINAL_TESTS', originalTests],
    ['MAESTRO_TESTS', maestroTests],
    ['STUDIO_TESTS', studioTests],
    ['TOOLING_TESTS', toolingTests]
  ];

  console.log('==================================================');
  console.log('MAESTRO COMPREHENSIVE UNIFIED TEST SUITE');
  console.log('==================================================\n');

  const results = suites.map(([label, files]) => runSuite(label, files));
  const total = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };

  for (const result of results) {
    console.log(`${result.label}: ${result.ok ? 'PASS' : 'FAIL'} (${formatCounts(result.counts)})`);
    addCounts(total, result.counts);
  }

  const failed = results.filter(result => !result.ok);
  for (const result of failed) {
    console.log(`\n----- ${result.label} OUTPUT -----`);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
  }

  console.log('\n==================================================');
  console.log('UNIFIED EXECUTION SUMMARY');
  console.log('==================================================');
  for (const result of results) {
    console.log(`${result.label}: ${result.ok ? 'PASS' : 'FAIL'}`);
  }
  console.log(`TOTAL: ${formatCounts(total)}`);
  console.log(`COMBINED: ${failed.length === 0 ? 'PASS' : 'FAIL'}`);
  console.log('SKIPPED=0 AND PENDING=0 REQUIRED');
  console.log('==================================================');

  if (failed.length > 0) {
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main();
}
