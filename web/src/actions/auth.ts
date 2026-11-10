"use server";

/**
 * Stage 3 — Auth server actions (Supabase Auth via the unified SSR client).
 * - Email + password sign-in / sign-up.
 * - Magic link: intentionally NOT implemented in this stage (the project did
 *   not have it confirmed as enabled); it will be added later if the owner
 *   enables it in the Supabase project.
 * - Rate limit + unified generic errors (no account-existence disclosure).
 */

import { createSupabaseServerClient } from "../lib/supabase/server";
import { checkRateLimit, authRateLimitKey, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS } from "../lib/rate-limit";
import { GENERIC_AUTH_ERROR } from "../lib/security";

export type AuthActionResult = { ok: true } | { ok: false; error: string };

export async function signInWithPassword(email: string, password: string): Promise<AuthActionResult> {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const rl = checkRateLimit(authRateLimitKey("signin", normalizedEmail), AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) return { ok: false, error: `retry:${rl.retryAfterSec}` };

  const server = await createSupabaseServerClient();
  if (!server) return { ok: false, error: GENERIC_AUTH_ERROR };
  const { error } = await server.auth.signInWithPassword({ email: normalizedEmail, password });
  if (error) return { ok: false, error: GENERIC_AUTH_ERROR };
  return { ok: true };
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthActionResult> {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const rl = checkRateLimit(authRateLimitKey("signup", normalizedEmail), AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) return { ok: false, error: `retry:${rl.retryAfterSec}` };

  const server = await createSupabaseServerClient();
  if (!server) return { ok: false, error: GENERIC_AUTH_ERROR };
  const { error } = await server.auth.signUp({ email: normalizedEmail, password });
  if (error) return { ok: false, error: GENERIC_AUTH_ERROR };
  return { ok: true };
}

export async function signOutAction(): Promise<{ ok: true }> {
  const server = await createSupabaseServerClient();
  if (server) {
    await server.auth.signOut();
  }
  return { ok: true };
}
