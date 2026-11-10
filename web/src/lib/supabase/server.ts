import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AUTH_STORAGE_KEY, parseSupabaseEnv, SUPABASE_ANON_KEY_VAR, SUPABASE_URL_VAR } from "./config";

/**
 * SSR server client (cookie-based sessions) using the SAME variable names as
 * the browser client (AHL_SUPABASE_URL / AHL_SUPABASE_ANON_KEY) — names that
 * already exist in this repository. Sessions are stored in httpOnly cookies
 * (secure in production, sameSite lax) via @supabase/ssr.
 *
 * Returns null when Supabase is not configured — callers must fail closed.
 */
export type SupabaseServerClient = ReturnType<typeof createServerClient>;

export async function createSupabaseServerClient(): Promise<SupabaseServerClient | null> {
  const env = parseSupabaseEnv(() => process.env[SUPABASE_URL_VAR], () => process.env[SUPABASE_ANON_KEY_VAR]);
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: async (cookiesToSet, headers) => {
        try {
          for (const c of cookiesToSet) {
            cookieStore.set(c.name, c.value, c.options as never);
          }
        } catch {
          // Cookie writes can only happen in Server Actions / Route Handlers;
          // in Server Components they are skipped by the cookie store.
        }
        void headers;
      }
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY
    },
    db: { schema: "public" }
  });
}
