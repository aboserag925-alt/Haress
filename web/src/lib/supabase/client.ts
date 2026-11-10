"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AUTH_STORAGE_KEY,
  baseClientOptions,
  parseSupabaseEnv,
  SUPABASE_ANON_KEY_VAR,
  SUPABASE_URL_VAR
} from "./config";

/**
 * Browser-side Supabase client. Uses the SAME variable names as the server
 * (AHL_SUPABASE_URL / AHL_SUPABASE_ANON_KEY) — the browser copies of these
 * public-safe values are injected at build/deploy time (owner action), the
 * same way the legacy site receives `window.AHL_SUPABASE_CONFIG` via CI.
 *
 * The values are NOT read from process.env in the browser (Next strips nothing
 * here): we read the provider-exposed `window` config when present, else the
 * NEXT_PUBLIC copies of the same names when the owner chooses that route.
 * Returns `null` when not configured — callers fail safe.
 *
 * Only the ANON key may ever live here; the service-role key is server-only.
 */

type WindowSupabaseConfig = {
  url?: unknown;
  anonKey?: unknown;
};

let cached: SupabaseClient | null | undefined;

function readBrowserEnv(): { url: string | undefined; key: string | undefined } {
  if (typeof window === "undefined") return { url: undefined, key: undefined };
  const injected = (window as unknown as { AHL_SUPABASE_CONFIG?: WindowSupabaseConfig }).AHL_SUPABASE_CONFIG;
  const envUrl =
    typeof process !== "undefined" && process.env?.[`NEXT_PUBLIC_${SUPABASE_URL_VAR}`]
      ? process.env[`NEXT_PUBLIC_${SUPABASE_URL_VAR}`]
      : undefined;
  const envKey =
    typeof process !== "undefined" && process.env?.[`NEXT_PUBLIC_${SUPABASE_ANON_KEY_VAR}`]
      ? process.env[`NEXT_PUBLIC_${SUPABASE_ANON_KEY_VAR}`]
      : undefined;
  return {
    url: typeof injected?.url === "string" ? injected.url : envUrl,
    key: typeof injected?.anonKey === "string" ? injected.anonKey : envKey
  };
}

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const { url, key } = readBrowserEnv();
  const env = parseSupabaseEnv(() => url, () => key);
  if (!env) {
    cached = null;
    return cached;
  }
  cached = createClient(env.url, env.anonKey, baseClientOptions());
  return cached;
}

/** Test-only helper. */
export function resetSupabaseBrowserClientForTests(): void {
  cached = undefined;
}

export { AUTH_STORAGE_KEY };
