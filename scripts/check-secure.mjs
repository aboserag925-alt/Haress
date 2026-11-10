import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Stage 0 security gate (owner-approved addition):
// 1) scan every git-tracked file for secret-shaped credentials;
// 2) fail if production dependencies (@omit=dev) have known high/critical CVEs.
// Secrets must only live in hosting-provider env config, never in Git.

const SECRET_PATTERNS = [
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/sb_secret_[A-Za-z0-9_\-=]{20,}/, 'Supabase secret key'],
  [/sk-[A-Za-z0-9]{20,}/, 'OpenAI-style secret key'],
  [/gsk_[A-Za-z0-9]{20,}/, 'Groq API key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/AIza[0-9A-Za-z\-_]{35}/, 'Google API key'],
  [/xox[baprs]-[A-Za-z0-9\-]{10,}/, 'Slack token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [
    /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9+/=_\-]{32,}["']/i,
    'hardcoded credential assignment'
  ]
];

const output = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
const files = output.split('\n').filter(Boolean);

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable
  }
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      findings.push(`${file}: ${label}`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error('check:secure FAILED — secret-shaped values found in tracked files:');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(`check:secure: no secret-shaped values in ${files.length} tracked files.`);

let audit;
try {
  audit = JSON.parse(
    execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit']
    })
  );
} catch (error) {
  console.error('check:secure FAILED — `npm audit --omit=dev --json` exited nonzero (see error output above).');
  process.exit(1);
}

const vulnerabilities = audit?.metadata?.vulnerabilities ?? {};
const high = vulnerabilities.high ?? 0;
const critical = vulnerabilities.critical ?? 0;

if (high > 0 || critical > 0) {
  console.error(
    `check:secure FAILED — production dependency audit found ${high} high and ${critical} critical vulnerabilities.`
  );
  process.exit(1);
}
console.log(
  `check:secure: production dependency audit clean (high=0, critical=0; moderate=${vulnerabilities.moderate ?? 0}, low=${vulnerabilities.low ?? 0}).`
);
