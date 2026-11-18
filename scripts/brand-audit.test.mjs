import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const baselinePath = path.join(root, 'scripts/brand-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

test('brand baseline files still exist and match recorded counts', () => {
  assert.ok(baseline.files.length > 0);

  for (const row of baseline.files) {
    const file = path.join(root, row.file);
    assert.ok(fs.existsSync(file), `Missing file: ${row.file}`);

    const content = fs.readFileSync(file, 'utf8');
    const colors = content.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) || [];
    const important = (content.match(/!important/g) || []).length;

    assert.equal(important, row.important, `${row.file}: !important changed`);
    assert.equal(colors.length, row.hexColors, `${row.file}: HEX count changed`);
    assert.equal(
      new Set(colors.map(c => c.toUpperCase())).size,
      row.uniqueColors,
      `${row.file}: unique color count changed`
    );
  }
});

test('all seven central brand color tokens exist', () => {
  const css = fs.readFileSync(path.join(root, 'app/brand-tokens.css'), 'utf8');

  for (const token of [
    '--brand-green-deep',
    '--brand-green',
    '--brand-gold',
    '--brand-gold-light',
    '--brand-cream',
    '--brand-charcoal',
    '--brand-alert'
  ]) {
    assert.match(css, new RegExp(token));
  }
});

test('all font tokens use the normal system font', () => {
  const css = fs.readFileSync(path.join(root, 'app/brand-tokens.css'), 'utf8');

  for (const token of ['--font-display', '--font-body', '--font-quote']) {
    assert.match(css, new RegExp(`${token}:\\s*system-ui,\\s*sans-serif`));
  }
});
