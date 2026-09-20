"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import Card from "./Card";
import { ChevronIcon } from "./Icons";
import { markDragEnd } from "@/lib/dragGuard";
import { type Media, type ProgressItem } from "@/lib/tmdb";

const WIDTHS = {
  // vertical poster cards for all rows (~7-8 per view, netout style)
  poster:
    "w-[38vw] sm:w-[26vw] md:w-[20vw] lg:w-[14.2vw] xl:w-[11.6vw] 2xl:w-[9.8vw]",
  // landscape 16:9 — continue watching only (netflix style)
  backdrop:
    "w-[62vw] sm:w-[38vw] md:w-[29vw] lg:w-[22.5vw] xl:w-[18vw] 2xl:w-[15.2vw]",
  top10:
    "w-[42vw] sm:w-[29vw] md:w-[22vw] lg:w-[16vw] xl:w-[12.6vw] 2xl:w-[10.8vw]",
};

/** Netflix-style carousel built on NATIVE horizontal scrolling:
 *  trackpad swipes, touch drag, shift+wheel and keyboard all work out of the
 *  box. Extras: mouse drag-to-scroll, hover arrows, snap, infinite append. */
export default function Row({
  title,
  items,
  variant = "poster",
  top10,
  loading,
  href,
  action,
  progressItems,
  onRemove,
  onRequestMore,
  moreLoading,
}: {
  title: string;
  items: Media[];
  variant?: "backdrop" | "poster";
  top10?: boolean;
  loading?: boolean;
  href?: string;
  /** optional element rendered next to the title (e.g. Clear All) */
  action?: React.ReactNode;
  progressItems?: Map<number, ProgressItem>;
  onRemove?: (id: number) => void;
  /** called when the user scrolls near the end → parent appends items */
  onRequestMore?: () => void;
  moreLoading?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ down: false, moved: false, startX: 0, startScroll: 0, pointerId: -1 });

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    // near the end → ask for more items
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - el.clientWidth * 0.7) onRequestMore?.();
  }, [onRequestMore]);

  useEffect(() => {
    syncEdges();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncEdges, items.length]);

  /* ── mouse drag-to-scroll (native touch/trackpad need no help) ── */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = { down: true, moved: false, startX: e.clientX, startScroll: el.scrollLeft, pointerId: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (!el || !drag.current.down) return;
    const dx = e.clientX - drag.current.startX;
    if (!drag.current.moved && Math.abs(dx) > 6) {
      drag.current.moved = true;
      setDragging(true);
      el.setPointerCapture(e.pointerId);
    }
    if (drag.current.moved) {
      el.scrollLeft = drag.current.startScroll - dx;
    }
  };
  const endDrag = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (drag.current.moved) markDragEnd(); // swallow the click after a drag
    if (el && drag.current.moved) {
      try { el.releasePointerCapture(e.pointerId); } catch {}
    }
    drag.current.down = false;
    drag.current.moved = false;
    setDragging(false);
    syncEdges();
  };

  const page = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.92, behavior: "smooth" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      page(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      page(-1);
    }
  };

  const itemWidth = top10 ? WIDTHS.top10 : variant === "poster" ? WIDTHS.poster : WIDTHS.backdrop;

  return (
    <section className="group/row relative z-0 py-2.5 hover:z-30">
      <div className="mb-1.5 flex items-baseline gap-3 px-[4vw]">
        <h2 className="min-w-0 truncate cursor-default font-display2 text-lg tracking-wider text-neutral-200 transition-colors md:text-[22px]">{title}
        </h2>
        {href && (
          <Link
            href={href}
            className="flex translate-x-[-6px] items-center gap-0.5 text-[12px] font-semibold text-sky-400 opacity-0 transition-all duration-300 hover:text-sky-300 group-hover/row:translate-x-0 group-hover/row:opacity-100"
          >
            Explore All <ChevronIcon className="h-3 w-3" />
          </Link>
        )}
        <span className="ml-1 hidden text-[11px] text-neutral-500 opacity-0 transition group-hover/row:opacity-100 md:inline">
          drag or ← → to browse
        </span>
        {action}
      </div>

      <div className="relative">
        {/* left arrow */}
        <button
          aria-label="Scroll left"
          onClick={() => page(-1)}
          className={clsx(
              "absolute bottom-8 left-0 top-8 z-40 hidden w-[4vw] min-w-10 items-center justify-center rounded-r-xl bg-gradient-to-r from-black/80 to-black/30 text-white/90 opacity-0 transition hover:bg-black/80 sm:flex",
            atStart ? "pointer-events-none !opacity-0" : "group-hover/row:opacity-100"
          )}
        >
          <ChevronIcon dir="left" className="h-8 w-8 drop-shadow md:h-10 md:w-10" />
        </button>

        <div
          ref={scrollerRef}
          tabIndex={0}
          role="region"
          aria-label={`${title} carousel`}
          onScroll={syncEdges}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={clsx(
            "no-scrollbar flex snap-x snap-proximity overflow-x-auto overflow-y-hidden px-[4vw] pb-8 pt-5 outline-none focus-visible:ring-1 focus-visible:ring-white/30",
            dragging ? "cursor-grabbing select-none [&_[data-card]]:pointer-events-none" : "cursor-grab"
          )}
        >
          <div className="flex w-max gap-1.5">
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className={clsx("shrink-0 snap-start", itemWidth)}>
                    <div className={clsx("skeleton", top10 || variant === "poster" ? "aspect-[2/3]" : "aspect-video", "w-[88%]")} />
                  </div>
                ))
              : items.slice(0, 40).map((item, i) => (
                  <div key={`${item.id}-${i}`} data-card className={clsx("shrink-0 snap-start", itemWidth)}>
                    <Card
                      item={item}
                      variant={variant}
                      rank={top10 ? i + 1 : undefined}
                      progress={progressItems?.get(item.id)}
                      onRemove={onRemove ? () => onRemove(item.id) : undefined}
                    />
                  </div>
                ))}
            {moreLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`m${i}`} className={clsx("shrink-0 snap-start", itemWidth)}>
                  <div className={clsx("skeleton opacity-50", top10 || variant === "poster" ? "aspect-[2/3]" : "aspect-video", "w-[88%]")} />
                </div>
              ))}
          </div>
        </div>

        {/* right arrow */}
        <button
          aria-label="Scroll right"
          onClick={() => page(1)}
          className={clsx(
              "absolute bottom-8 right-0 top-8 z-40 hidden w-[4vw] min-w-10 items-center justify-center rounded-l-xl bg-gradient-to-l from-black/80 to-black/30 text-white/90 opacity-0 transition hover:bg-black/80 sm:flex",
            atEnd && !onRequestMore ? "pointer-events-none !opacity-0" : "group-hover/row:opacity-100"
          )}
        >
          <ChevronIcon className="h-8 w-8 drop-shadow md:h-10 md:w-10" />
        </button>
      </div>
    </section>
  );
}
