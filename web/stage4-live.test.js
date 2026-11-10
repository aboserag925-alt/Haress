// Stage 4 — live/broadcast contract tests (plain node:test, same style as
// web/pwa.test.js, web/migrations.test.js and web/admin-stage3.test.js).
// Covers:
//   - /api/live legacy compatibility shape: { live, videoId } (live from
//     live_state, videoId null),
//   - live state / next broadcast helpers source contracts,
//   - admin live toggle action: admin self-verification + URL validation
//     (https only, allowlisted domains),
//   - /admin/live panel wiring,
//   - live_state + broadcast_schedule migrations RLS contracts,
//   - admin entity registry includes the new entities.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

test("/api/live legacy compatibility returns { live, videoId } with live from live_state", async () => {
  const route = await readFile(join(HERE, "app/api/live/route.ts"), "utf8");
  assert.match(route, /export async function GET/);
  assert.match(route, /getLiveState/);
  assert.match(route, /live_state/);
  assert.match(route, /videoId:\s*null/);
  assert.match(route, /live:\s*true/);
  assert.match(route, /live:\s*false/);
  assert.match(route, /cache:\s*"no-store"/);
});

test("live state helpers read live_state and broadcast_schedule; default offline state", async () => {
  const lib = await readFile(join(HERE, "src/lib/live-state.ts"), "utf8");
  assert.match(lib, /live_state/);
  assert.match(lib, /broadcast_schedule/);
  assert.match(lib, /is_live/);
  assert.match(lib, /DEFAULT_LIVE_STATE/);
  assert.match(lib, /providerFromStreamUrl/);
});

test("admin live action self-verifies admin, checks same-origin, audits, and validates stream URL", async () => {
  const actions = await readFile(join(HERE, "src/actions/admin.ts"), "utf8");
  assert.match(actions, /adminSetLiveState/);
  assert.match(actions, /adminActor/);
  assert.match(actions, /isSameOrigin/);
  assert.match(actions, /audit_log/);
  // https-only + allowlist validation before any write.
  assert.match(actions, /parsed\.protocol !== "https:"/);
  assert.match(actions, /const allowed =/);
  assert.match(actions, /allowed\.includes\(host\)/);
});

test("live screen renders iframe only when the provider is embeddable", async () => {
  const screen = await readFile(join(HERE, "src/components/LiveScreen.tsx"), "utf8");
  assert.match(screen, /iframe/);
  assert.match(screen, /canEmbedProvider/);
  assert.match(screen, /embedAllowed \?/);
  assert.match(screen, /target="_blank"/);
  assert.match(screen, /rel="noopener noreferrer"/);
});

test("admin live panel is wired to the dedicated live-state toggle action", async () => {
  const page = await readFile(join(HERE, "app/admin/live/page.tsx"), "utf8");
  assert.match(page, /adminSetLiveState/);
  assert.match(page, /is_live/);
  assert.match(page, /stream_url/);
  assert.match(page, /stream_title/);
});

test("live_state migration: idempotent create, RLS public-read-only via service-role writes", async () => {
  const sql = await readFile(join(HERE, "..", "supabase/migrations/0003_stage4_live_state.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.live_state/);
  assert.match(sql, /is_live boolean not null default false/);
  assert.match(sql, /stream_url text/);
  assert.match(sql, /alter table public\.live_state enable row level security/);
  assert.match(sql, /revoke all on public\.live_state from anon, authenticated, public/);
  assert.match(sql, /grant all on public\.live_state to service_role/);
  assert.match(sql, /create policy/);
  assert.doesNotMatch(sql, /for all|using[^\n]*insert|using[^\n]*update/i);
});

test("broadcast_schedule migration: idempotent create, public read published-only, admin writes", async () => {
  const sql = await readFile(join(HERE, "..", "supabase/migrations/0004_stage4_broadcast_schedule.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.broadcast_schedule/);
  assert.match(sql, /status text not null default 'draft'/);
  assert.match(sql, /starts_at_utc timestamptz not null/);
  assert.match(sql, /alter table public\.broadcast_schedule enable row level security/);
  assert.match(sql, /revoke all on public\.broadcast_schedule from anon, authenticated, public/);
  assert.match(sql, /grant all on public\.broadcast_schedule to service_role/);
  assert.match(sql, /status = 'published/);
});

test("admin entity registry includes live_state and broadcast_schedule", async () => {
  const reg = await readFile(join(HERE, "src/lib/admin-entities.ts"), "utf8");
  assert.match(reg, /live_state/);
  assert.match(reg, /broadcast_schedule/);
});
