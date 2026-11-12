import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSuite } from './run-all-tests.mjs';

function withFixture(name, source, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-wrapper-'));
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  try {
    return callback(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('wrapper propagates a failing test', () => {
  withFixture('fail.test.mjs', `
    import test from 'node:test';
    import assert from 'node:assert';
    test('failing probe', () => { assert.strictEqual(1, 2); });
  `, (file) => {
    const result = runSuite('fixture-fail', [file]);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.counts.fail, 1);
  });
});

test('wrapper rejects a suite with skipped tests', () => {
  withFixture('skip.test.mjs', `
    import test from 'node:test';
    test('skipped probe', (t) => { t.skip('probe'); });
  `, (file) => {
    const result = runSuite('fixture-skip', [file]);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.counts.skipped, 1);
  });
});

test('wrapper rejects a suite with pending tests', () => {
  withFixture('todo.test.mjs', `
    import test from 'node:test';
    test.todo('pending probe');
  `, (file) => {
    const result = runSuite('fixture-todo', [file]);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.counts.todo, 1);
  });
});

test('wrapper accepts a clean passing suite', () => {
  withFixture('pass.test.mjs', `
    import test from 'node:test';
    import assert from 'node:assert';
    test('passing probe', () => { assert.strictEqual(1, 1); });
  `, (file) => {
    const result = runSuite('fixture-pass', [file]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.counts.tests, 1);
    assert.strictEqual(result.counts.pass, 1);
    assert.strictEqual(result.counts.fail, 0);
    assert.strictEqual(result.counts.skipped, 0);
    assert.strictEqual(result.counts.todo, 0);
  });
});
