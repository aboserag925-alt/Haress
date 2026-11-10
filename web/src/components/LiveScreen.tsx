"use client";

/**
 * Stage 4 — Public live screen.
 * - Reads initial state from server (live state + next broadcast).
 * - When live: iframe (16:9, golden container) only for embed-supported
 *   providers from the allowlist; otherwise a big "شاهد البث الآن" button
 *   opening the stream link in a new tab (rel="noopener noreferrer").
 * - When off: elegant offline state with the next broadcast.
 * - Status bar + 60s periodic refresh, stops on tab hide (visibilitychange).
 */

import { useEffect, useState } from "react";

export type LiveScreenState = {
  is_live: boolean;
  stream_url: string | null;
  stream_title: string;
  provider: string | null;
  updated_at: string | null;
};

export type NextBroadcast = {
  id: string;
  title: string;
  starts_at_utc: string;
  status: string;
  stream_url: string | null;
};

/**
 * Stage 4 — embeddable providers registry (provider hostname -> allowIframe).
 * Empty by design in this stage: live streaming runs through the manual
 * operator state with a non-restricted provider flow; when no provider is
 * allowlisted the public page renders the external "watch now" button
 * instead of an iframe.
 */
export const EMBED_PROVIDERS: Record<string, { allowIframe: boolean; kind: string }> = {};

export function canEmbedProvider(provider: string | null): boolean {
  if (!provider) return false;
  const entry = EMBED_PROVIDERS[provider];
  return entry ? entry.allowIframe === true : false;
}

export default function LiveScreen({ initial, next }: { initial: LiveScreenState; next: NextBroadcast | null }) {
  const [live, setLive] = useState<LiveScreenState>(initial);
  const [nextBroadcast, setNextBroadcast] = useState<NextBroadcast | null>(next);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/live/state", { cache: "no-store" });
        const data = (await res.json()) as { live: LiveScreenState; next: NextBroadcast | null };
        if (!cancelled) {
          setLive(data.live);
          setNextBroadcast(data.next);
        }
      } catch {
        // keep last known state
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    const onVis = () => {
      if (document.visibilityState === "hidden") window.clearInterval(timer);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const isLive = live.is_live === true && !!live.stream_url;
  const embedAllowed = canEmbedProvider(live.provider);

  return (
    <section className="mx-auto max-w-5xl px-4" aria-live="polite">
      <div className="card-surface p-5 text-center">
        <p className="text-sm font-bold text-gold-soft">{isLive ? "البث المباشر الآن" : "لا يوجد بث الآن"}</p>
        {isLive ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-gold/40 bg-black">
            <div className="gold-rule" aria-hidden="true" />
            {embedAllowed ? (
              <div className="relative aspect-video w-full">
                <iframe
                  src={live.stream_url ?? ""}
                  title={live.stream_title || "بث مباشر"}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="p-6">
                <a
                  href={live.stream_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[56px] items-center justify-center rounded-full bg-red-600 px-8 py-3 font-bold text-white shadow-lg"
                >
                  شاهد البث الآن
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-gold/20 bg-panel p-8">
            <p className="text-muted">الحالة: لا يوجد بث الآن.</p>
            {nextBroadcast ? (
              <p className="mt-2 text-sm text-gold-soft">
                البث القادم: {nextBroadcast.title} — {new Date(nextBroadcast.starts_at_utc).toLocaleString("ar")}
              </p>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">{live.stream_title || ""}</p>
      </div>
    </section>
  );
}
