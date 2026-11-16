import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Parse and validate the Supabase build credentials exposed through `env`.
 *
 * Returns `{ url, anonKey, origin }` when both credentials are present and valid.
 * Throws when the credentials are partial (only one of the two) or when the URL
 * is not a bare HTTP(S) origin. Returns `{ url: undefined, anonKey: undefined,
 * origin: undefined }` when neither credential is configured (caller decides
 * whether that is acceptable for the current build mode).
 */
export function resolveSupabaseCredentials(env = process.env) {
  const rawUrl = env.SUPABASE_URL == null ? undefined : String(env.SUPABASE_URL).trim();
  const rawAnonKey = env.SUPABASE_ANON_KEY == null ? undefined : String(env.SUPABASE_ANON_KEY).trim();

  const hasUrl = rawUrl !== undefined && rawUrl !== '';
  const hasAnonKey = rawAnonKey !== undefined && rawAnonKey !== '';

  if (hasUrl !== hasAnonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured together.');
  }

  if (!hasUrl) {
    return { url: undefined, anonKey: undefined, origin: undefined };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTP(S) origin.');
  }

  if (
    !['https:', 'http:'].includes(parsedUrl.protocol) ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error('SUPABASE_URL must be an HTTP(S) origin without credentials or a path.');
  }

  return { url: rawUrl, anonKey: rawAnonKey, origin: parsedUrl.origin };
}

/**
 * A production build is one that must never ship an empty or stale Supabase
 * configuration. Opt in explicitly with SUPABASE_BUILD_REQUIRED=1, or rely on
 * NODE_ENV=production. Local development and test builds stay in the
 * placeholder/dev path so they can build without real production credentials.
 */
export function isProductionBuild(env = process.env) {
  return (
    String(env.NODE_ENV || '') === 'production' ||
    String(env.SUPABASE_BUILD_REQUIRED || '') === '1'
  );
}

/**
 * Write a real, non-empty Supabase runtime configuration to `localConfig`.
 */
export async function writeSupabaseConfigFile(localConfig, config) {
  await writeFile(
    localConfig,
    `window.AHL_SUPABASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
    'utf8'
  );
}

/**
 * Development/test fallback: ensure a placeholder config exists without real
 * credentials. Never overwrites an existing config; only creates one from the
 * example when the file is absent.
 */
export async function ensurePlaceholderConfig(localConfig, exampleConfig) {
  try {
    await access(localConfig);
    return;
  } catch {
    // file does not exist yet: fall through to copy the example
  }
  await copyFile(exampleConfig, localConfig);
}

const defaultAppDirectory = resolve(repoRoot, 'app');

export async function buildAuth(options = {}) {
  const env = options.env || process.env;
  const root = options.root || repoRoot;
  const appDirectory = options.appDirectory || defaultAppDirectory;
  const vendorDirectory = resolve(appDirectory, 'vendor');
  const localConfig = resolve(appDirectory, 'supabase-config.js');
  const exampleConfig = resolve(root, 'src', 'supabase-config.example.js');

  const { url, anonKey, origin } = resolveSupabaseCredentials(env);
  const hasCredentials = Boolean(url);

  if (hasCredentials) {
    // Production-ready build: write the real config (overwrites any stale/empty
    // tracked artifact so it can never silently ship as production config).
    await writeSupabaseConfigFile(localConfig, { url: origin, anonKey });
  } else if (isProductionBuild(env)) {
    // Fail closed: refuse to emit a production artifact backed by an empty or
    // stale Supabase configuration.
    throw new Error(
      'Refusing to build production Supabase client: SUPABASE_URL and ' +
        'SUPABASE_ANON_KEY are required for production builds. Set them, or ' +
        'build without SUPABASE_BUILD_REQUIRED/NODE_ENV=production for local ' +
        'development and test.'
    );
  } else {
    // Development/test path: keep building without real credentials by using a
    // placeholder config. The app degrades gracefully when unconfigured.
    await ensurePlaceholderConfig(localConfig, exampleConfig);
  }

  await mkdir(vendorDirectory, { recursive: true });

  await build({
    entryPoints: [resolve(root, 'src', 'auth-client.js')],
    outfile: resolve(appDirectory, 'auth-client.js'),
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    legalComments: 'eof'
  });

  await copyFile(
    resolve(root, 'node_modules', '@supabase', 'supabase-js', 'LICENSE'),
    resolve(vendorDirectory, 'SUPABASE-LICENSE.txt')
  );

  return {
    supabaseConfig: localConfig,
    hasCredentials,
    production: isProductionBuild(env)
  };
}

// CLI entry point: only runs when this file is executed directly.
const isMain =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      await buildAuth({ env: process.env });
      console.log('Supabase auth build complete.');
    } catch (error) {
      console.error(`Supabase auth build failed: ${error.message}`);
      process.exit(1);
    }
  })();
}
