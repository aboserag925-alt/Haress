import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Stage 3 — Admin area protection middleware.
 *
 * For every /admin request:
 *   1. resolves the Supabase session via the SSR cookie client (httpOnly,
 *      secure, sameSite cookies — @supabase/ssr);
 *   2. checks admin membership server-side (admin_users via service role);
 *   3. denies (redirect to "/") when unauthenticated OR not an admin.
 *
 * Admin server actions / route handlers must additionally call `requireAdmin()`
 * themselves (web/src/lib/admin-guard.ts) — middleware is defense in depth only.
 */

export const ADMIN_MIDDLEWARE_MATCHER = "/admin/:path*";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: { ...request.headers } } });
  // Auth responses must not be cached by CDN/proxy (Supabase SSR requirement).
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");

  const supabaseUrl = process.env.AHL_SUPABASE_URL;
  const supabaseAnonKey = process.env.AHL_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Fail closed: no Supabase configuration -> deny admin area.
    return NextResponse.redirect(new URL("/", request.url));
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const c of cookiesToSet) {
          response.cookies.set(c.name, c.value, c.options as never);
        }
        Object.entries(headers || {}).forEach(([k, v]) => response.headers.set(k, v));
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "ahl-athar-auth"
    }
  });

  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;

  if (error || !user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  let isAdmin = false;
  if (serviceKey) {
    const listUrl = `${supabaseUrl}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`;
    const adminRes = await fetch(listUrl, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      }
    });
    const rows = (await adminRes.json()) as Array<{ user_id?: string }>;
    isAdmin = Array.isArray(rows) && rows.length > 0;
  }

  if (!isAdmin) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [ADMIN_MIDDLEWARE_MATCHER]
};
