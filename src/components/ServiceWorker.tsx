"use client";

import { useEffect } from "react";

/** Registers the service worker (image + API caching → instant repeat pages) */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
