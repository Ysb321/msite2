"use client";

/** YouTube-style top progress bar shown on every route open.
 *  Pure CSS (nprogress-style staging) — no runtime library. */
export default function RouteProgress() {
  return (
    <div
      aria-hidden
      className="route-progress pointer-events-none fixed inset-x-0 top-0 z-[400] h-[3px] origin-left bg-gradient-to-r from-brand via-rose-500 to-amber-500"
    />
  );
}
