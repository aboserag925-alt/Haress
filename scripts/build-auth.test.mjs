import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import {
  resolveSupabaseCredentials,
  isProductionBuild,
  writeSupabaseConfigFile,
  buildAuth
} from './build-auth.mjs';

const SYNTHETIC_URL = 'https://example-haress.supabase.co';
const SYNTHETIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic.test.key.placeholder';
const EMPTY_MATCHER = /url:\s*['"]['"]/;

function hasEmptyValues(content) {
  return EMPTY_MATCHER.test(content) && /anonKey:\s*['"]['"]/.test(content);
}

test('resolveSupabaseCredentials rejects partial configuration (URL only)', () => {
  assert.throws(() => resolveSupabaseCredentials({ SUPABASE_URL: SYNTHETIC_URL }), /configured together/);
});

test('resolveSupabaseCredentials rejects partial configuration (anon key only)', () => {
  assert.throws(() => resolveSupabaseCredentials({ SUPABASE_ANON_KEY: SYNTHETIC_KEY }), /configured together/);
});

test('resolveSupabaseCredentials accepts valid synthetic configuration', () => {
  const creds = resolveSupabaseCredentials({ SUPABASE_URL: SYNTHETIC_URL, SUPABASE_ANON_KEY: SYNTHETIC_KEY });
  assert.equal(creds.url, SYNTHETIC_URL);
  assert.equal(creds.anonKey, SYNTHETIC_KEY);
  assert.equal(creds.origin, 'https://example-haress.supabase.co');
});

test('isProductionBuild is true for NODE_ENV=production', () => {
  assert.equal(isProductionBuild({ NODE_ENV: 'production' }), true);
});

test('isProductionBuild is true for SUPABASE_BUILD_REQUIRED=1', () => {
  assert.equal(isProductionBuild({ SUPABASE_BUILD_REQUIRED: '1' }), true);
});

test('isProductionBuild is false for local development and test', () => {
  assert.equal(isProductionBuild({}), false);
  assert.equal(isProductionBuild({ NODE_ENV: 'development' }), false);
  assert.equal(isProductionBuild({ NODE_ENV: 'test' }), false);
});

test('writeSupabaseConfigFile generates a non-empty config from valid synthetic config', async () => {
  const dir = mkdtempSync(pathJoin(osTmpdir(), 'haress-config-'));
  try {
    const configFile = pathJoin(dir, 'supabase-config.js');
    await writeSupabaseConfigFile(configFile, { url: SYNTHETIC_URL, anonKey: SYNTHETIC_KEY });
    const content = readFileSync(configFile, 'utf8');
    assert.ok(content.trim().length > 0, 'generated config must be non-empty');
    assert.ok(content.includes(SYNTHETIC_URL), 'config must contain the synthetic URL');
    assert.ok(content.includes(SYNTHETIC_KEY), 'config must contain the synthetic anon key');
    assert.ok(/window\.AHL_SUPABASE_CONFIG\s*=/.test(content), 'config must assign the global');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('valid configuration overwrites a stale config with a non-empty config', async () => {
  const dir = mkdtempSync(pathJoin(osTmpdir(), 'haress-stale-'));
  try {
    const configFile = pathJoin(dir, 'supabase-config.js');
    writeFileSync(configFile, 'window.AHL_SUPABASE_CONFIG = { url: "", anonKey: "" };\n', 'utf8');
    assert.ok(hasEmptyValues(readFileSync(configFile, 'utf8')), 'fixture starts stale/empty');
    await writeSupabaseConfigFile(configFile, { url: SYNTHETIC_URL, anonKey: SYNTHETIC_KEY });
    const content = readFileSync(configFile, 'utf8');
    assert.ok(!hasEmptyValues(content), 'stale empty values must be overwritten');
    assert.ok(content.includes(SYNTHETIC_URL), 'config must contain the synthetic URL');
    assert.ok(content.includes(SYNTHETIC_KEY), 'config must contain the synthetic anon key');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('production build without required Supabase configuration fails closed (NODE_ENV=production)', async () => {
  const root = mkdtempSync(pathJoin(osTmpdir(), 'haress-prod-'));
  const appDir = pathJoin(root, 'app');
  mkdirSync(appDir, { recursive: true });
  const configFile = pathJoin(appDir, 'supabase-config.js');
  writeFileSync(configFile, 'window.AHL_SUPABASE_CONFIG = { url: "", anonKey: "" };\n', 'utf8');
  assert.ok(hasEmptyValues(readFileSync(configFile, 'utf8')), 'fixture starts stale/empty');
  try {
    const env = { ...process.env, NODE_ENV: 'production', SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined };
    await assert.rejects(
      () => buildAuth({ root, appDirectory: appDir, env }),
      /required for production builds/
    );
    // The stale file must remain empty/placeholder: it was not promoted to a real artifact.
    const stale = readFileSync(configFile, 'utf8');
    assert.ok(hasEmptyValues(stale), 'stale config must not be promoted to production artifact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production build without required Supabase configuration fails closed (SUPABASE_BUILD_REQUIRED=1)', async () => {
  const root = mkdtempSync(pathJoin(osTmpdir(), 'haress-req-'));
  const appDir = pathJoin(root, 'app');
  mkdirSync(appDir, { recursive: true });
  const configFile = pathJoin(appDir, 'supabase-config.js');
  writeFileSync(configFile, 'window.AHL_SUPABASE_CONFIG = { url: "", anonKey: "" };\n', 'utf8');
  try {
    const env = { ...process.env, SUPABASE_BUILD_REQUIRED: '1', SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined };
    await assert.rejects(
      () => buildAuth({ root, appDirectory: appDir, env }),
      /required for production builds/
    );
    const stale = readFileSync(configFile, 'utf8');
    assert.ok(hasEmptyValues(stale), 'stale config must not be promoted to production artifact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
