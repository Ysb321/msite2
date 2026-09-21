"use client";

import { useEffect, useRef, useState } from "react";

/** Defers mounting heavy content (TMDB rows) until it's near the viewport.
 *  Cuts initial DOM nodes + network requests dramatically on long pages.
 *  If priority is true, mounts immediately without IO delay. */
export default function RowLazy({
  children,
  reserve = 320,
  priority = false,
}: {
  children: React.ReactNode;
  reserve?: number;
  priority?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(priority);

  useEffect(() => {
    if (priority) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "650px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [priority]);

  return (
    <div
      ref={ref}
      className="row-contain"
      style={show ? undefined : { minHeight: reserve }}
    >
      {show ? children : null}
    </div>
  );
}
