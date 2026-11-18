import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [];

function collect(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collect(full);
    } else if (/\.(css|html)$/.test(entry.name)) {
      files.push(full);
    }
  }
}

collect(path.join(root, 'app'));
collect(path.join(root, 'scripts'));

files.push(path.join(root, 'index.html'));

const targets = [...new Set(files)]
  .filter(file => fs.existsSync(file))
  .filter(file => !file.endsWith('brand-tokens.css'))
  .filter(file => !file.endsWith('tailwind.css'));

const results = targets.map(file => {
  const content = fs.readFileSync(file, 'utf8');
  const colors = content.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) || [];

  return {
    file: path.relative(root, file),
    important: (content.match(/!important/g) || []).length,
    hexColors: colors.length,
    uniqueColors: [...new Set(colors.map(c => c.toUpperCase()))].length
  };
});

console.log('\nBRAND AUDIT');
console.table(results);

const totals = results.reduce((sum, row) => ({
  important: sum.important + row.important,
  hexColors: sum.hexColors + row.hexColors
}), { important: 0, hexColors: 0 });

console.log('\nTOTALS');
console.table([totals]);

const baseline = {
  generatedAt: new Date().toISOString(),
  files: results,
  totals
};

fs.writeFileSync(
  path.join(root, 'scripts/brand-baseline.json'),
  JSON.stringify(baseline, null, 2) + '\n'
);

console.log('\nBaseline saved: scripts/brand-baseline.json');
