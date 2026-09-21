"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import clsx from "clsx";
import Card from "./Card";
import { ChevronIcon } from "./Icons";
import { markDragEnd } from "@/lib/dragGuard";
import { type Media, type ProgressItem } from "@/lib/tmdb";
import {
  Flame,
  Trophy,
  Heart,
  Film,
  Tv,
  Globe,
  Shield,
  Zap,
  BookmarkCheck,
  PlayCircle,
  Languages,
  Sparkles,
  ChevronRight,
} from "lucide-react";

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

function getRowIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("continue watching")) return { icon: PlayCircle, color: "text-sky-400" };
  if (t.includes("my list")) return { icon: BookmarkCheck, color: "text-emerald-400" };
  if (t.includes("trending")) return { icon: Flame, color: "text-amber-400" };
  if (t.includes("top 10")) return { icon: Trophy, color: "text-yellow-400" };
  if (t.includes("bollywood") || t.includes("south")) return { icon: Heart, color: "text-rose-400" };
  if (t.includes("anime")) return { icon: Zap, color: "text-purple-400" };
  if (t.includes("marvel")) return { icon: Shield, color: "text-red-500" };
  if (t.includes("dubbed")) return { icon: Languages, color: "text-indigo-400" };
  if (t.includes("hollywood")) return { icon: Globe, color: "text-blue-400" };
  if (t.includes("tv") || t.includes("series") || t.includes("cartoon")) return { icon: Tv, color: "text-violet-400" };
  return { icon: Film, color: "text-neutral-400" };
}

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
  onExploreAll,
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
  onExploreAll?: () => void;
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
  const { icon: RowIcon, color: iconColor } = useMemo(() => getRowIcon(title), [title]);

  if (!loading && items.length === 0 && !moreLoading) {
    return null;
  }

  return (
    <section className="group/row row-contain relative z-0 py-4 hover:z-30 transition-all">
      <div className="mb-2.5 flex items-center justify-between px-[4vw]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 p-1 border border-white/10 shadow-sm", iconColor)}>
            <RowIcon className="h-4 w-4" />
          </div>

          <h2 className="min-w-0 truncate cursor-default font-sans text-base font-extrabold tracking-tight text-white transition-colors sm:text-lg md:text-xl">
            {title}
          </h2>

          {!loading && items.length > 0 && (
            <span className="hidden sm:inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-neutral-300 ring-1 ring-white/10">
              {items.length} titles
            </span>
          )}

          {onExploreAll ? (
            <button
              onClick={onExploreAll}
              className="flex items-center gap-1 text-[11px] sm:text-[12px] font-bold text-sky-400 opacity-90 sm:opacity-0 transition-all duration-300 hover:text-sky-300 group-hover/row:opacity-100 pl-1.5 active:scale-95 cursor-pointer"
              title={`Explore all titles in ${title}`}
            >
              <span>Explore All</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : href ? (
            <Link
              href={href}
              className="hidden sm:flex items-center gap-1 text-[12px] font-bold text-sky-400 opacity-0 transition-all duration-300 hover:text-sky-300 group-hover/row:opacity-100 pl-1.5"
            >
              <span>Explore All</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] font-medium text-neutral-400 opacity-0 transition group-hover/row:opacity-100 md:inline">
            swipe or use arrows
          </span>
          {action}
        </div>
      </div>

      <div className="relative">
        {/* left arrow */}
        <button
          aria-label="Scroll left"
          onClick={() => page(-1)}
          className={clsx(
            "absolute bottom-8 left-0 top-8 z-40 hidden w-[3.8vw] min-w-10 items-center justify-center rounded-r-2xl border-y border-r border-white/20 bg-black/80 backdrop-blur-xl text-white opacity-0 transition-all hover:bg-black/95 hover:scale-105 sm:flex cursor-pointer shadow-2xl",
            atStart ? "pointer-events-none !opacity-0" : "group-hover/row:opacity-100"
          )}
        >
          <ChevronIcon dir="left" className="h-7 w-7 drop-shadow md:h-9 md:w-9" />
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
            "no-scrollbar flex snap-x snap-proximity overflow-x-auto overflow-y-hidden px-[4vw] pb-6 pt-2 outline-none focus-visible:ring-1 focus-visible:ring-white/30",
            dragging ? "cursor-grabbing select-none [&_[data-card]]:pointer-events-none" : "cursor-grab"
          )}
        >
          <div className="flex w-max gap-2">
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className={clsx("shrink-0 snap-start", itemWidth)}>
                    <div className={clsx("skeleton rounded-xl", top10 || variant === "poster" ? "aspect-[2/3]" : "aspect-video", "w-[92%]")} />
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
                  <div className={clsx("skeleton rounded-xl opacity-50", top10 || variant === "poster" ? "aspect-[2/3]" : "aspect-video", "w-[92%]")} />
                </div>
              ))}
          </div>
        </div>

        {/* right arrow */}
        <button
          aria-label="Scroll right"
          onClick={() => page(1)}
          className={clsx(
            "absolute bottom-8 right-0 top-8 z-40 hidden w-[4vw] min-w-10 items-center justify-center rounded-l-xl border-y border-l border-white/10 bg-black/70 backdrop-blur-md text-white/90 opacity-0 transition hover:bg-black/95 hover:scale-105 sm:flex",
            atEnd && !onRequestMore ? "pointer-events-none !opacity-0" : "group-hover/row:opacity-100"
          )}
        >
          <ChevronIcon className="h-7 w-7 drop-shadow md:h-9 md:w-9" />
        </button>
      </div>
    </section>
  );
}
