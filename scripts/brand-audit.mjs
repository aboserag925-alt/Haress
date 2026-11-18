import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appDir = path.join(root, 'app');
const v3Dir = path.join(appDir, 'v3');

const targets = [];

// app/*.css و app/*.html (جذر المجلد app فقط)
if (fs.existsSync(appDir)) {
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(css|html)$/i.test(entry.name)) continue;
    targets.push(path.join(appDir, entry.name));
  }
}

// index.html في جذر المستودع
const rootIndex = path.join(root, 'index.html');
if (fs.existsSync(rootIndex)) targets.push(rootIndex);

// app/v3/*.css فقط
if (fs.existsSync(v3Dir)) {
  for (const entry of fs.readdirSync(v3Dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.css$/i.test(entry.name)) continue;
    targets.push(path.join(v3Dir, entry.name));
  }
}

const excluded = new Set(['app/brand-tokens.css', 'app/tailwind.css']);

const files = [...new Set(targets)]
  .filter(file => fs.existsSync(file))
  .filter(file => !excluded.has(path.relative(root, file)))
  .sort();

const HEX_RE = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g;
const IMPORTANT_RE = /!important/g;

const results = files.map((file) => {
  const content = fs.readFileSync(file, 'utf8');
  const colors = content.match(HEX_RE) || [];
  const important = (content.match(IMPORTANT_RE) || []).length;

  const colorCounts = {};
  for (const c of colors) {
    const key = c.toUpperCase();
    colorCounts[key] = (colorCounts[key] || 0) + 1;
  }
  const uniqueColors = Object.keys(colorCounts).length;

  return {
    file: path.relative(root, file),
    important,
    hexColors: colors.length,
    uniqueColors,
    colorCounts
  };
});

const totals = results.reduce(
  (sum, row) => ({
    important: sum.important + row.important,
    hexColors: sum.hexColors + row.hexColors
  }),
  { important: 0, hexColors: 0 }
);

console.log('\nBRAND AUDIT');
console.table(
  results.map((row) => ({
    file: row.file,
    important: row.important,
    hexColors: row.hexColors,
    uniqueColors: row.uniqueColors,
    colorCounts: JSON.stringify(row.colorCounts)
  }))
);

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
