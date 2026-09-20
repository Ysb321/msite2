"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Netflix-style intro splash: animated YETFLIX logo over black, played
 *  EVERY time the home page opens (mounted in the home page). Pure CSS
 *  keyframes (see globals.css) - no JS animation libs, respects
 *  prefers-reduced-motion, tap/click to skip, fully responsive via clamp(). */
const LETTERS = "YETFLIX".split("");

export default function IntroSplash() {
  const [show, setShow] = useState(false);
  const [out, setOut] = useState(false);
  const [mounted, setMounted] = useState(false); /* portal needs the client */
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setMounted(true);
    setShow(true);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const total = reduced ? 800 : 2750; /* full sequence vs quick fade */
    /* NB: the page is NEVER scroll-locked - the home page keeps its own
     * scrollbar and layout completely untouched. The splash is a pure
     * overlay ABOVE the page (portaled to body, viewport-fixed), so it
     * adds no height and never creates a scrollbar of its own. */
    timers.current.push(setTimeout(() => setOut(true), Math.max(total - 450, 0)));
    timers.current.push(setTimeout(() => setShow(false), total));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  /* while the splash is up: block ALL scrolling (wheel / touch / scroll
   * keys) - but WITHOUT overflow:hidden, so the page scrollbar stays
   * visible; everything unlocks the moment the splash finishes or is
   * skipped */
  useEffect(() => {
    if (!show) return;
    const prevent = (e: Event) => e.preventDefault();
    const blockKey = (e: KeyboardEvent) => {
      if ([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key))
        e.preventDefault();
    };
    window.addEventListener("wheel", prevent, { passive: false });
    window.addEventListener("touchmove", prevent, { passive: false });
    window.addEventListener("keydown", blockKey);
    return () => {
      window.removeEventListener("wheel", prevent);
      window.removeEventListener("touchmove", prevent);
      window.removeEventListener("keydown", blockKey);
    };
  }, [show]);

  if (!show || !mounted) return null;

  const skip = () => {
    timers.current.forEach(clearTimeout);
    setOut(true);
    timers.current.push(setTimeout(() => setShow(false), 380));
  };

  const overlay = (
    <div
      onClick={skip}
      className={`intro-overlay fixed inset-0 z-[300] flex cursor-pointer items-center justify-center overflow-hidden bg-black ${out ? "out" : ""}`}
      role="presentation"
    >
      <div className={`intro-content relative select-none text-center ${out ? "out" : ""}`}>
        <div
          className="font-display relative flex justify-center overflow-hidden px-[5vw] tracking-tight text-brand"
          style={{
            /* size by BOTH width and height: never overflows portrait
             * phones, never exceeds a landscape phone's short height,
             * keeps growing up to 11rem on 4K/ultrawide */
            fontSize: "clamp(2.5rem, min(15vw, 20vh), 11rem)",
            lineHeight: 1.1,
          }}
        >
          {LETTERS.map((l, i) => (
            <span
              key={i}
              className="intro-letter"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              {l}
            </span>
          ))}
          <span className="intro-sweep" aria-hidden />
        </div>
        <span
          className="intro-tag mt-3 block uppercase text-neutral-400"
          style={{
            fontSize: "clamp(0.55rem, 2vw, 0.95rem)",
            letterSpacing: "clamp(0.25em, 1.2vw, 0.45em)",
            paddingLeft: "clamp(0.25em, 1.2vw, 0.45em)", /* optically centers tracked text */
          }}
        >
          by Yashraj
        </span>
        <span className="intro-glow" aria-hidden />
      </div>
      <span className="absolute bottom-8 text-[10px] uppercase tracking-[0.3em] text-neutral-700">
        tap to skip
      </span>
    </div>
  );
  /* portal to <body>: the overlay is measured against the VIEWPORT, never
   * against a transformed page/transition container */
  return createPortal(overlay, document.body);
}
