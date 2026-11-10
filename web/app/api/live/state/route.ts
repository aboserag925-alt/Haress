// Stage 4 — lightweight public live-state endpoint (short cache: 30s).
import { NextResponse } from "next/server";
import { getLiveState, getNextBroadcast } from "../../../../src/lib/live-state";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export async function GET() {
  const live = await getLiveState();
  const next = await getNextBroadcast();
  const payload = {
    live: live ?? { is_live: false, stream_url: null, stream_title: "", provider: null, updated_at: null },
    next
  };
  const INIT: RequestInit = { cache: "no-store" };
  return NextResponse.json(payload, INIT);
}
