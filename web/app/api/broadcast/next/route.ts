// Stage 4 — next published broadcast endpoint (short cache: 30s).
import { NextResponse } from "next/server";
import { getNextBroadcast } from "../../../../src/lib/live-state";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export async function GET() {
  const next = await getNextBroadcast();
  const payload = { next };
  const INIT: RequestInit = { cache: "no-store" };
  return NextResponse.json(payload, INIT);
}
