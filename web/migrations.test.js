// Stage-2 static contract tests (plain node:test, same style as pwa.test.js).
// They verify the unified Supabase client naming and the idempotency/safety
// guarantees of the migration file. No database access ever happens here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

test("unified client uses only variable names that exist in this repository", async () => {
  const config = await readFile(join(HERE, "src/lib/supabase/config.ts"), "utf8");
  assert.match(config, /AHL_SUPABASE_URL/);
  assert.match(config, /AHL_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(config, /NEXT_PUBLIC_SUPABASE_URL/); // repo-consistent names only
  assert.doesNotMatch(config, /service_role/i); // anon-only module
  const server = await readFile(join(HERE, "src/lib/supabase/server.ts"), "utf8");
  assert.doesNotMatch(server, /SERVICE_ROLE|service_role/);
  const browser = await readFile(join(HERE, "src/lib/supabase/client.ts"), "utf8");
  assert.doesNotMatch(browser, /SERVICE_ROLE|service_role/);
});

test("server and browser clients share the same option factory", async () => {
  const server = await readFile(join(HERE, "src/lib/supabase/server.ts"), "utf8");
  const browser = await readFile(join(HERE, "src/lib/supabase/client.ts"), "utf8");
  assert.match(server, /baseClientOptions/);
  assert.match(browser, /baseClientOptions/);
  assert.match(browser, /getSupabaseBrowserClient/);
  assert.match(server, /getSupabaseServerClient/);
});

test("migration is idempotent and covers every Stage-2 table", async () => {
  const files = await readdir(join(HERE, "..", "supabase/migrations"));
  assert.ok(files.length >= 1, "migration file exists");
  const sql = await readFile(join(HERE, "..", "supabase/migrations/0001_stage2_data_layer.sql"), "utf8");

  for (const table of ["series", "articles", "books", "quran_items", "forum_threads", "forum_posts", "site_settings"]) {
    assert.match(sql, new RegExp(`create table if not exists public.${table}\\b`),
      `idempotent create for ${table}`);
    assert.match(sql, new RegExp(`on public.${table} for select`), `select policy for ${table}`);
  }
  // Existing tables are treated additively, never destructively.
  assert.match(sql, /add column series_id/);
  assert.match(sql, /raise notice 'lectures\.series_id already exists — skipped'/);
});

test("migration never breaks existing RLS or runs destructive/data statements", async () => {
  const sql = await readFile(join(HERE, "..", "supabase/migrations/0001_stage2_data_layer.sql"), "utf8");
  // Evaluate statements only: drop comment-only lines so documentation text
  // can never satisfy (or defeat) a safety pattern.
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(code, /drop\s+table/i);
  assert.doesNotMatch(code, /(?:delete\s+from|truncate\s+(?:table\s+)?\S)/i);
  assert.doesNotMatch(code, /update\s+[\w".]+\s+set/i);
  // Existing policy names on live tables are never dropped/recreated.
  const drops = sql.match(/drop policy[^;]+on public\.lectures|drop policy[^;]+on public\.admin_users|drop policy[^;]+on public\.user_data/gi);
  assert.equal(drops, null, "no policy churn on existing tables");
  // Existing grants/revokes are untouched.
  assert.doesNotMatch(code, /revoke[^;]*public\.user_data/i);
  assert.doesNotMatch(code, /grant[^;]*public\.user_data/i);
  // audience_questions is checked but explicitly not touched here.
  assert.match(sql, /audience_questions/); // documented inside a comment
  const lines = sql.split("\n").filter((l) => l.includes("audience_questions"));
  assert.ok(lines.every((l) => l.trim().startsWith("--")), "audience_questions only in comments");
});

test("migration documents the admin/service-role write boundary", async () => {
  const sql = await readFile(join(HERE, "..", "supabase/migrations/0001_stage2_data_layer.sql"), "utf8");
  assert.match(sql, /grant all on public\.\w+ to service_role/);
  assert.doesNotMatch(sql, /for insert to authenticated|for update to authenticated|for delete to authenticated|with check/);
});
