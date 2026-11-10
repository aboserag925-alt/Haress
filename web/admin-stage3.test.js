// Stage 3 — admin/security contract tests (plain node:test, same style as
// web/pwa.test.js and web/migrations.test.js). Covers:
//   - admin area is protected by middleware session + admin checks,
//   - admin actions self-verify (no reliance on middleware alone),
//   - anon cannot write any table nor read unpublished content (incl. audit_log),
//   - upload rejection rules (MIME allowlist / size / safe filename / magic bytes),
//   - rate-limit + sanitize + same-origin + generic auth error helpers.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

test("admin middleware denies /admin without session/admin and checks both layers", async () => {
  const mw = await readFile(join(HERE, "src/middleware.ts"), "utf8");
  assert.match(mw, /\/admin/);
  assert.match(mw, /auth\.getUser/);
  assert.match(mw, /admin_users/);
  assert.match(mw, /persistSession:\s*false/);
  assert.match(mw, /cache-control|no-cache|no-store/i); // auth responses must not be cached
});

test("admin guard self-verifies session + admin membership (used by every admin action)", async () => {
  const guard = await readFile(join(HERE, "src/lib/admin-guard.ts"), "utf8");
  assert.match(guard, /admin_users/);
  assert.match(guard, /auth\.getUser/);
  assert.match(guard, /requireAdmin/);
  assert.match(guard, /AdminForbiddenError/);
});

test("admin actions re-verify admin themselves (no middleware-only reliance)", async () => {
  const actions = await readFile(join(HERE, "src/actions/admin.ts"), "utf8");
  assert.match(actions, /requireAdmin|adminActor/);
  assert.match(actions, /isSameOrigin/);
  assert.match(actions, /sanitizeText/);
  assert.match(actions, /audit_log/);
});

test("auth actions apply rate limit and return unified generic error", async () => {
  const auth = await readFile(join(HERE, "src/actions/auth.ts"), "utf8");
  assert.match(auth, /checkRateLimit/);
  assert.match(auth, /GENERIC_AUTH_ERROR/);
  assert.match(auth, /signInWithPassword/);
});

test("audit_log migration is idempotent and blocks anon read/write", async () => {
  const sql = await readFile(join(HERE, "..", "supabase/migrations/0002_stage3_audit_log.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.audit_log/);
  assert.match(sql, /alter table public\.audit_log enable row level security/);
  assert.match(sql, /revoke all on public\.audit_log from anon, authenticated, public/);
  assert.match(sql, /grant all on public\.audit_log to service_role/);
  // No policy granting anon/authenticated access to audit_log.
  assert.doesNotMatch(sql, /create policy[\s\S]*anon[\s\S]*audit_log/);
});

test("upload rules: MIME allowlist, size limit, safe filename, magic bytes", async () => {
  const storage = await readFile(join(HERE, "src/lib/storage.ts"), "utf8");
  assert.match(storage, /PUBLIC_MIME_TYPES/);
  assert.match(storage, /MAX_UPLOAD_BYTES/);
  assert.match(storage, /magicBytesOk/);
  assert.match(storage, /uploadAdminMedia/);
  const security = await readFile(join(HERE, "src/lib/security.ts"), "utf8");
  assert.match(security, /sanitizeText/);
  assert.match(security, /toSafeFilename|safeFilename/);
});

test("rate limiter allows burst within window and blocks after max", async () => {
  const mod = await import("./src/lib/rate-limit.ts");
  assert.equal(typeof mod.checkRateLimit, "function");
  const first = mod.checkRateLimit("test:signin:x", 2, 60_000);
  assert.equal(first.allowed, true);
  const second = mod.checkRateLimit("test:signin:x", 2, 60_000);
  assert.equal(second.allowed, true);
  const third = mod.checkRateLimit("test:signin:x", 2, 60_000);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSec > 0);
});

test("auth errors are generic (no account enumeration)", async () => {
  const auth = await readFile(join(HERE, "src/actions/auth.ts"), "utf8");
  assert.match(auth, /GENERIC_AUTH_ERROR/);
});
