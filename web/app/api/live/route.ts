// Stage-1 /api/live contract:
// Forwards to the legacy Node backend `${AHL_API_BASE_URL}/api/live` and
// ALWAYS returns a well-formed JSON status (fail-closed: live=false) so the
// always-visible LiveButton can never break. No secret values enter this code.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FALLBACK = { ok: true, live: false, source: "fallback" as const };

export async function GET() {
  const base = process.env.AHL_API_BASE_URL;
  if (!base) return NextResponse.json(FALLBACK);

  try {
    const url = `${base.replace(/\/+$/, "")}/api/live`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000)
    });
    if (!res.ok) return NextResponse.json(FALLBACK);
    const data = (await res.json()) as Record<string, unknown>;
    // Only pass through the fields the button needs; never echo unknown data.
    return NextResponse.json({
      ok: true,
      live: Boolean(data?.live === true || data?.streaming === true),
      source: "backend"
    });
  } catch (error) {
    console.error("api/live: backend unreachable:", error instanceof Error ? error.message : error);
    return NextResponse.json(FALLBACK);
  }
}
