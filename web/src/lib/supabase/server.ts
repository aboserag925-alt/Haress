import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { baseClientOptions, parseSupabaseEnv, SUPABASE_ANON_KEY_VAR, SUPABASE_URL_VAR } from "./config";

/**
 * Server-side Supabase client (Node / route handlers / server components).
 * Uses the SAME variable names as the browser (AHL_SUPABASE_URL /
 * AHL_SUPABASE_ANON_KEY) and the anon key only.
 *
 * Lazy singleton; returns `null` when Supabase is not configured — callers
 * must handle `null` (fail closed), mirroring the legacy client behavior.
 */

let cached: SupabaseClient | null | undefined;

function readEnv(): { url: string | undefined; key: string | undefined } {
  let url: string | undefined;
  let key: string | undefined;
  try {
    url = process.env[SUPABASE_URL_VAR];
    key = process.env[SUPABASE_ANON_KEY_VAR];
  } catch {
    // No Node env available (e.g. Edge) — treat as unconfigured.
  }
  return { url, key };
}

export function getSupabaseServerClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const { url, key } = readEnv();
  const env = parseSupabaseEnv(() => url, () => key);
  if (!env) {
    console.error(`Supabase is not configured: set ${SUPABASE_URL_VAR} and ${SUPABASE_ANON_KEY_VAR} (server-side values, https + anon key required).`);
    cached = null;
    return cached;
  }
  cached = createClient(env.url, env.anonKey, baseClientOptions());
  return cached;
}

/** Test-only helper: clears the singleton between tests. */
export function resetSupabaseServerClientForTests(): void {
  cached = undefined;
}
