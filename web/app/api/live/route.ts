// Stage 4 — legacy /api/live compatibility endpoint.
// Shape preserved for clients/Worker consumers: { live, videoId }.
// `live` is read from the Stage-4 `live_state` table; `videoId` is returned
// as null for compatibility (embed video id wiring comes with the live
// provider integration in a later stage).
// Fail-closed: never reports live without a resolvable live state.

import { NextResponse } from "next/server";
import { getLiveState } from "../../../src/lib/live-state";

export const dynamic = "force-dynamic";

const OFFLINE = { live: false, videoId: null };

export async function GET() {
  const base = process.env.AHL_API_BASE_URL;
  const live = await getLiveState();
  const isLive = live?.is_live === true;
  const payload = isLive ? { live: true, videoId: null } : OFFLINE;
  void base;
  const INIT: RequestInit = { cache: "no-store" };
  return NextResponse.json(payload, INIT);
}
