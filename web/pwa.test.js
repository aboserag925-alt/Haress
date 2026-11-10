// Stage-1 PWA asset test (mirrors app/pwa-assets.test.js conventions).
// Plain node:test over the new Next.js app's static PWA contract.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(join(HERE, p), "utf8");

test("manifest keeps the Arabic RTL standalone contract", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.dir, "rtl");
  assert.equal(manifest.lang, "ar");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.background_color, "#050505");
  assert.ok(manifest.name.includes("أهل الأثر"));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1);
});

test("service worker ships a NEW cache version, offline fallback, and never caches /api/*", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /CACHE_NAME\s*=\s*'ahl-athar-web-v\d+'/);
  assert.doesNotMatch(sw, /ahl-athar-v2/); // must not collide with legacy cache
  assert.match(sw, /\/offline\//);
  assert.match(sw, /\/api\//); // explicit network-only guard exists
  assert.match(sw, /fetch|match/, "uses standard Cache API surface");
});

test("layout is RTL Arabic and points at the manifest", async () => {
  const layout = await read("app/layout.tsx");
  assert.match(layout, /dir="rtl"/);
  assert.match(layout, /lang="ar"/);
  assert.match(layout, /manifest\.webmanifest/);
  assert.match(layout, /Tajawal/);
  assert.match(layout, /#050505/);
});

test("offline page exists and offers a way back", async () => {
  const offline = await read("app/offline/page.tsx");
  assert.match(offline, /لا يوجد اتصال/);
  assert.match(offline, /href="\//);
});

test("live route is fail-closed on missing backend config", async () => {
  const route = await read("app/api/live/route.ts");
  assert.match(route, /AHL_API_BASE_URL/);
  assert.match(route, /live:\s*false|live:\s*Boolean/);
  assert.match(route, /cache:\s*"no-store"/);
});

test("old legacy entry URL is redirected", async () => {
  const cfg = await read("next.config.ts");
  assert.match(cfg, /index\.html/);
  assert.match(cfg, /destination:\s*"\/"/);
});

test("arch-framed doctor photo asset is present", async () => {
  await assert.doesNotReject(() => readFile(join(HERE, "public/images/logo.jpg")));
  const hero = await read("components/Hero.tsx");
  assert.match(hero, /arch-frame/);
  assert.match(hero, /images\/logo\.jpg/);
});
