import { getSupabaseAdminClient } from "./supabase/admin-client";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Admin authorization: session (Supabase Auth via SSR cookie client) + admin
 * membership (admin_users via service-role client).
 *
 * Defense in depth: the /admin area is protected by `src/middleware.ts`, and
 * EVERY admin server action / route handler MUST call `requireAdmin()` itself
 * (never relying on middleware alone) — this module is that single place.
 */

export class AdminForbiddenError extends Error {
  constructor() {
    super("Admin access required");
    this.name = "AdminForbiddenError";
  }
}

export async function getAdminUserId(): Promise<string | null> {
  const server = await createSupabaseServerClient();
  const auth = server;
  if (!auth) return null;
  const { data, error } = await auth.auth.getUser();
  if (error || !data?.user) return null;
  const admin = getSupabaseAdminClient();
  if (!admin) return null;
  const { data: membership, error: memberError } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (memberError || !membership) return null;
  return data.user.id;
}

export async function requireAdmin(): Promise<string> {
  const userId = await getAdminUserId();
  if (!userId) throw new AdminForbiddenError();
  return userId;
}
