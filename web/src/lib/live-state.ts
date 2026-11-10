import { createSupabaseServerClient } from "./supabase/server";

export type LiveState = {
  is_live: boolean;
  stream_url: string | null;
  stream_title: string;
  provider: string | null;
  updated_at: string | null;
};

export type Broadcast = {
  id: string;
  title: string;
  starts_at_utc: string;
  status: string;
  stream_url: string | null;
};

export const DEFAULT_LIVE_STATE: LiveState = {
  is_live: false,
  stream_url: null,
  stream_title: "",
  provider: null,
  updated_at: null
};

/**
 * Stage 4 — live state reader (public read via the unified server client
 * behind the public RLS policy on `live_state`).
 * Returns the default (offline) state when no row exists yet.
 */
export async function getLiveState(): Promise<LiveState> {
  const server = await createSupabaseServerClient();
  const client = server;
  if (!client) return DEFAULT_LIVE_STATE;
  const { data, error } = await client
    .from("live_state")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return DEFAULT_LIVE_STATE;
  const row = (data ?? [])[0] as
    | { is_live?: boolean; stream_url?: string | null; stream_title?: string; provider?: string | null; updated_at?: string }
    | undefined;
  if (!row) return DEFAULT_LIVE_STATE;
  return {
    is_live: row.is_live === true,
    stream_url: row.stream_url ?? null,
    stream_title: row.stream_title ?? "",
    provider: row.provider ?? null,
    updated_at: row.updated_at ?? null
  };
}

/**
 * Stage 4 — next published broadcast reader (public read via the unified
 * server client behind the public SELECT policy on `broadcast_schedule`).
 */
export async function getNextBroadcast(): Promise<Broadcast | null> {
  const server = await createSupabaseServerClient();
  const client = server;
  if (!client) return null;
  const { data, error } = await client
    .from("broadcast_schedule")
    .select("*")
    .eq("status", "published")
    .order("starts_at_utc", { ascending: true })
    .limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as
    | { id: string; title: string; starts_at_utc: string; status: string; stream_url?: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    starts_at_utc: String(row.starts_at_utc),
    status: String(row.status),
    stream_url: row.stream_url ?? null
  };
}

/**
 * Stage 4 — derive the stream provider hostname from a stream URL.
 * Only https URLs are accepted; returns null otherwise.
 */
export function providerFromStreamUrl(streamUrl: string | null): string | null {
  if (!streamUrl) return null;
  try {
    const u = new URL(streamUrl);
    if (u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
