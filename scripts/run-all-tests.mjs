import { spawnSync } from 'node:child_process';

console.log('==================================================');
console.log('MAESTRO COMPREHENSIVE UNIFIED TEST SUITE');
console.log('==================================================\n');

// 1. Original Regression Suite
console.log('--- 1. RUNNING ORIGINAL_TESTS ---');
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

const res1 = spawnSync('node', ['--test', ...originalTests], { stdio: 'inherit' });
const originalPass = res1.status === 0;

// 2. Maestro Tests
console.log('\n--- 2. RUNNING MAESTRO_TESTS ---');
const maestroTests = [
  'server/ai/maestro-contract.test.js',
  'server/ai/evidence-verifier.test.js',
  'server/ai/maestro-graph.test.js',
  'server/ai/maestro-governance.test.js',
  'server/ai/roles/roles.test.js',
  'server/ai/governance/governance.test.js',
  'server/ai/maestro-durability.test.js',
  'server/ai/maestro-m9-audit.test.js'
];

const res2 = spawnSync('node', ['--test', ...maestroTests], { stdio: 'inherit' });
const maestroPass = res2.status === 0;

// 3. Studio & Sandbox Tests
console.log('\n--- 3. RUNNING STUDIO_TESTS ---');
const studioTests = [
  'server/ai/studio-sandbox.test.js'
];

const res3 = spawnSync('node', ['--test', ...studioTests], { stdio: 'inherit' });
const studioPass = res3.status === 0;

console.log('\n==================================================');
console.log('UNIFIED EXECUTION SUMMARY');
console.log('==================================================');
console.log(`ORIGINAL_TESTS: ${originalPass ? 'PASS' : 'FAIL'}`);
console.log(`MAESTRO_TESTS:  ${maestroPass ? 'PASS' : 'FAIL'}`);
console.log(`STUDIO_TESTS:   ${studioPass ? 'PASS' : 'FAIL'}`);
console.log(`COMBINED:       ${originalPass && maestroPass && studioPass ? 'PASS' : 'FAIL'}`);
console.log('==================================================');

if (!originalPass || !maestroPass || !studioPass) {
  process.exit(1);
}
