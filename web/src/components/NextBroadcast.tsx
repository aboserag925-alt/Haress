"use client";

/**
 * Stage 4 — Homepage: next upcoming broadcast with countdown.
 * Fetches /api/broadcast/next (short cache) and renders countdown.
 */

import { useEffect, useState } from "react";

type NextBroadcastRow = {
  id: string;
  title: string;
  starts_at_utc: string;
  status: string;
  stream_url: string | null;
};

export default function NextBroadcast() {
  const [next, setNext] = useState<NextBroadcastRow | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/broadcast/next", { cache: "no-store" });
        const data = (await res.json()) as { next: NextBroadcastRow | null };
        if (!cancelled) setNext(data.next);
      } catch {
        // ignore
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

  useEffect(() => {
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (!next) {
    return (
      <section id="live" className="mt-8">
        <div className="card-surface p-5 text-center text-sm text-muted">قادم قريبًا.</div>
      </section>
    );
  }

  const target = new Date(next.starts_at_utc).getTime();
  const diff = Math.max(0, target - nowTs);
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);

  return (
    <section className="mt-8">
      <div className="card-surface p-5 text-center">
        <p className="text-sm font-bold text-gold-soft">الموعد القادم</p>
        <p className="mt-2 text-lg font-bold">{next.title}</p>
        <p className="mt-1 text-2xl font-extrabold text-gold" dir="ltr" aria-label={`${days} ${hours} ${minutes} ${seconds}`}>
          {String(days).padStart(2, "0")}:{String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </p>
        <p className="mt-1 text-xs text-muted">{new Date(next.starts_at_utc).toLocaleString("ar")}</p>
      </div>
    </section>
  );
}
