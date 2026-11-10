"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failure must never break the page.
      });
    }, 800);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
