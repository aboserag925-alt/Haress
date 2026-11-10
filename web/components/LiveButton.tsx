"use client";

import { useEffect, useState } from "react";

type LiveState = "unknown" | "on" | "off";

/**
 * Always-visible red live button (Stage 1 requirement). The button never
 * hides: when live status is unknown it still links to the live section.
 */
export default function LiveButton() {
  const [live, setLive] = useState<LiveState>("unknown");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        const data: { live?: boolean } = await res.json();
        if (!cancelled) setLive(data?.live ? "on" : "off");
      } catch {
        if (!cancelled) setLive("off");
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const label =
    live === "on" ? "البث المباشر • يُبَثّ الآن" : "البث المباشر";

  return (
    <a
      href="#live"
      aria-label={label}
      className="fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-900/40 ring-1 ring-red-300/40 transition hover:bg-red-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-300"
    >
      <span
        className="relative flex h-2.5 w-2.5"
        aria-hidden="true"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-300 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      {label}
    </a>
  );
}
