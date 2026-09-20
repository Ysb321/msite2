"use client";

import { useEffect, useRef, useState } from "react";

/** Defers mounting heavy content (TMDB rows) until it's near the viewport.
 *  Cuts initial DOM nodes + network requests dramatically on long pages —
 *  the homepage mounts only the first rows, the rest stream in on approach. */
export default function RowLazy({
  children,
  reserve = 320,
}: {
  children: React.ReactNode;
  reserve?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
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
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} style={show ? undefined : { minHeight: reserve }}>
      {show ? children : null}
    </div>
  );
}
