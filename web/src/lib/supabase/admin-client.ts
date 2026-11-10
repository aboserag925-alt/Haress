import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { baseClientOptions } from "./config";

/**
 * Server-only Supabase client using the SERVICE ROLE key (SUPABASE_SERVICE_ROLE_KEY).
 * Used exclusively by server-side admin/server logic to authorize admins and to
 * write content. NEVER import this from any browser-reachable module — the
 * service key must never appear in browser bundles or client files.
 */

export type SupabaseAdminClient = SupabaseClient<any, "public", any>;

const SERVICE_KEY_VAR = "SUPABASE_SERVICE_ROLE_KEY";

function hasServiceKey(value: string | undefined): value is string {
  if (!value) return false;
  return value.startsWith("sb_secret_") || value.startsWith("eyJ");
}

export function getSupabaseAdminClient(): SupabaseAdminClient | null {
  const url = process.env.AHL_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !hasServiceKey(key)) return null;
  let parsed: { url: string; anonKey: string } | null = null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    parsed = { url, anonKey: key };
  } catch {
    return null;
  }
  // `any` schema until generated typed Database lands (later stage).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createClient<any>(parsed!.url, parsed!.anonKey, {
    ...baseClientOptions(),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as never) as SupabaseAdminClient;
  return client;
}
