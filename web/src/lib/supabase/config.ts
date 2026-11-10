import type { SupabaseClientOptions } from "@supabase/supabase-js";

/**
 * Unified Supabase configuration — the SAME variable names are used for both
 * the server and the browser clients (AHL_SUPABASE_URL / AHL_SUPABASE_ANON_KEY),
 * matching the names that already exist in this repository
 * (.github/workflows/android-build.yml injects the same names for the app).
 *
 * The anon key is public-safe by design; the service-role key is a
 * server-only variable and is intentionally NOT part of this module.
 */

export const SUPABASE_URL_VAR = "AHL_SUPABASE_URL";
export const SUPABASE_ANON_KEY_VAR = "AHL_SUPABASE_ANON_KEY";
/** Same browser storage key the legacy app already uses. */
export const AUTH_STORAGE_KEY = "ahl-athar-auth";

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

function isValidHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isValidAnonKey(value: string): boolean {
  return value.length > 0 && /^(?:eyJ|sb_publishable_)/.test(value);
}

/**
 * Reads the env from a getter (browser: window globals; server: process.env).
 * Returns `null` (never throws) when configuration is missing/malformed —
 * callers must fail safe, no secrets ever flow through this module.
 */
export function parseSupabaseEnv(
  getUrl: () => string | undefined,
  getKey: () => string | undefined
): SupabaseEnv | null {
  const url = (getUrl() ?? "").trim();
  const anonKey = (getKey() ?? "").trim();
  if (!url || !anonKey) return null;
  if (!isValidHttpsUrl(url) || !isValidAnonKey(anonKey)) return null;
  return { url, anonKey };
}

/** Shared client options (kept identical for server and browser).
 *  Generic schema until generated typed Database lands (later stage/data types). */
export function baseClientOptions(): SupabaseClientOptions<any> {
  return {
    global: { headers: { "Accept-Charset": "utf-8" } },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY },
    db: { schema: "public" }
  };
}
