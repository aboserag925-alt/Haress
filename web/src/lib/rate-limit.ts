import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * In-memory rate limiter for auth-related endpoints (login/sign-up attempt
 * throttles). Per-instance only — sufficient for this stage; a shared store
 * (e.g. Redis) is a later-stage concern. No personal data is stored.
 */

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

type Bucket = { count: number; firstAt: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.firstAt >= windowMs) {
    buckets.set(key, { count: 1, firstAt: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.firstAt + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export const AUTH_RATE_LIMIT_MAX = 5;
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export function authRateLimitKey(scope: string, email?: string): string {
  const normalized = (email || "anonymous").trim().toLowerCase();
  return `auth:${scope}:${normalized}`;
}
