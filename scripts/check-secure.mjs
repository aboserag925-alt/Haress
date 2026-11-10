// Local secret scan (check:secure). Read-only; never prints matched secret values.
// Heuristic patterns only — CI additionally runs Gitleaks over full history.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  ".git", "node_modules", "_site", "screens", "storage", ".next",
  ".open-next", ".wrangler", "assets", "vendor"
]);
const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "skills-lock.json", "opencode.json"
]);
const SKIP_EXT = /\.(png|jpe?g|webp|ico|gif|woff2?|ttf|eot|otf|mp3|pdf)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

// Each pattern fires only on credential-shaped literal values. Placeholder
// values ("your-…", "REPLACE_", "example", "<…>") are excluded per-line.
const PATTERNS = [
  { name: "supabase secret key", re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
  { name: "pem private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/ },
  { name: "aws access key id", re: /(?:^|[^A-Z0-9])AKIA[0-9A-Z]{16}(?:$|[^A-Z0-9])/ },
  { name: "github token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: "openai-style sk key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/ },
  { name: "anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{30,}\b/ },
  { name: "google/gemini api key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "telegram bot token", re: /\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b/ },
  { name: "slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  {
    name: "hardcoded password/bearer literal",
    re: /(?:password|passwd|pwd|bearer|token|secret)\s*[:=]\s*["'][^"'\s]{10,}["']/i,
    exclude: /process\.env|getenv|placeholder|example|REPLACE|your[-_]|<[^>]*>|\{\{|\$\{/i
  }
];

let scanned = 0;
const findings = [];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      yield* walk(p);
    } else if (entry.isFile()) {
      yield p;
    }
  }
}

for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const base = rel.split("/").pop();
  if (SKIP_FILES.has(base) || SKIP_EXT.test(base)) continue;
  // Test fixtures intentionally use fake credentials; Gitleaks in CI still
  // scans every file including tests.
  if (/(?:^|\.)test\.[^.]+$/.test(base) || /(?:^|\.)spec\.[^.]+$/.test(base) || /SmokeCheck/i.test(base)) continue;
  const info = await stat(file).catch(() => null);
  if (!info || info.size > MAX_BYTES) continue;
  const text = await readFile(file, "utf8").catch(() => "");
  if (!text || text.includes("\u0000")) continue; // binary guard
  scanned += 1;
  const lines = text.split("\n");
  for (const { name, re, exclude } of PATTERNS) {
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = rx.exec(text)) !== null) {
      const lineNo = text.slice(0, m.index).split("\n").length;
      const lineText = lines[lineNo - 1] ?? "";
      if (exclude && exclude.test(lineText)) continue;
      findings.push({ file: rel, line: lineNo, name });
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("check:secure FAILED — possible secrets found (values not printed):");
  for (const f of findings) console.error(`  - ${f.file}:${f.line}  (${f.name})`);
  console.error("If a finding is a false positive, narrow the pattern instead of bypassing the scan.");
  process.exit(1);
}
console.log(`check:secure OK — ${scanned} files scanned, no secret-shaped literals found.`);
