/**
 * Shared server-side security helpers for Stage 3 (auth/admin).
 */

export const MAX_TEXT_LENGTH = 2000;

/** Trims, strips control characters, caps length — applied to all admin input text. */
export function sanitizeText(input: unknown, max: number = MAX_TEXT_LENGTH): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

/** Constant-time-ish comparison helper (not cryptographic, but avoids === on secrets). */
export function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Origin check for server actions (CSRF defense on top of Next's own checks). */
export async function isSameOrigin(): Promise<boolean> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = h.get("origin");
  if (!host || !origin) return false;
  try {
    const o = new URL(origin);
    return o.host === host && o.protocol === `${proto === "https" ? "https" : "http"}:`;
  } catch {
    return false;
  }
}

/** Unified generic auth error — never reveals whether an account exists. */
export const GENERIC_AUTH_ERROR = "تعذر تسجيل الدخول أو إنشاء الحساب. يرجى المحاولة لاحقاً.";

export function toSafeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
  return cleaned.length > 0 ? cleaned : `media-${crypto.randomUUID()}`;
}
