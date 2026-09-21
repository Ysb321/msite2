"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import clsx from "clsx";
import Card from "./Card";
import { ChevronIcon } from "./Icons";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { markDragEnd } from "@/lib/dragGuard";
import type { Media } from "@/lib/tmdb";
import { useExploreAll } from "@/context/ExploreAllContext";
import { Flame, Film, Tv, Sparkles, ChevronLeft, ChevronRight, Hash } from "lucide-react";

type MediaTypeFilter = "all" | "movie" | "tv";
type TimeWindowFilter = "day" | "week";

const WIDTHS = {
  poster:
    "w-[38vw] sm:w-[26vw] md:w-[20vw] lg:w-[14.2vw] xl:w-[11.6vw] 2xl:w-[9.8vw]",
  top10:
    "w-[42vw] sm:w-[29vw] md:w-[22vw] lg:w-[16vw] xl:w-[12.6vw] 2xl:w-[10.8vw]",
};

interface TrendingNowCarouselProps {
  initialType?: MediaTypeFilter;
  initialWindow?: TimeWindowFilter;
  className?: string;
}

export default function TrendingNowCarousel({
  initialType = "all",
  initialWindow = "day",
  className,
}: TrendingNowCarouselProps) {
  const [mediaType, setMediaType] = useState<MediaTypeFilter>(initialType);
  const [timeWindow, setTimeWindow] = useState<TimeWindowFilter>(initialWindow);
  const [showRankings, setShowRankings] = useState(true);
  const { openExploreAll } = useExploreAll();

  const handleExploreAll = () => {
    const typeLabel =
      mediaType === "all" ? "Movies & TV" : mediaType === "movie" ? "Movies" : "TV Shows";
    const windowLabel = timeWindow === "day" ? "Today" : "This Week";
    openExploreAll({
      title: `Trending ${typeLabel} (${windowLabel})`,
      endpoint: `trending/${mediaType}/${timeWindow}`,
      mediaType: mediaType,
      top10: showRankings,
    });
  };

  useEffect(() => {
    setMediaType(initialType);
  }, [initialType]);

  // TMDB endpoint construction
  const endpoint1 = `trending/${mediaType}/${timeWindow}?page=1`;
  const endpoint2 = `trending/${mediaType}/${timeWindow}?page=2`;

  const { data: page1Data, isLoading: loading1, error: error1 } = useTmdbSnapshot<any>(endpoint1);
  const { data: page2Data, isLoading: loading2 } = useTmdbSnapshot<any>(endpoint2);

  // Combine results from pages and ensure correct media_type
  const items = useMemo<Media[]>(() => {
    const list1 = page1Data?.results ?? [];
    const list2 = page2Data?.results ?? [];
    const combined = [...list1, ...list2];

    const seen = new Set<number>();
    const result: Media[] = [];

    for (const item of combined) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);

      // Ensure item has explicit media_type
      const itemType =
        item.media_type ??
        (mediaType !== "all" ? mediaType : item.first_air_date ? "tv" : "movie");

      result.push({
        ...item,
        media_type: itemType,
      });
    }

    return result;
  }, [page1Data, page2Data, mediaType]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ down: false, moved: false, startX: 0, startScroll: 0, pointerId: -1 });

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncEdges();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncEdges, items.length]);

  // Reset scroll position when filter changes
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTo({ left: 0, behavior: "smooth" });
    }
  }, [mediaType, timeWindow]);

  // Mouse drag-to-scroll handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    const el = scrollerRef.current;
    if (!el) return;
    dragRef.current = { down: true, moved: false, startX: e.clientX, startScroll: el.scrollLeft, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (!el || !dragRef.current.down) return;
    const dx = e.clientX - dragRef.current.startX;
    if (!dragRef.current.moved && Math.abs(dx) > 6) {
      dragRef.current.moved = true;
      setIsDragging(true);
      el.setPointerCapture(e.pointerId);
    }
    if (dragRef.current.moved) {
      el.scrollLeft = dragRef.current.startScroll - dx;
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (dragRef.current.moved) markDragEnd();
    if (el && dragRef.current.moved) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    }
    dragRef.current.down = false;
    dragRef.current.moved = false;
    setIsDragging(false);
    syncEdges();
  };

  const page = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.88, behavior: "smooth" });
  };

  const exploreHref = mediaType === "tv" ? "/tv" : "/movies";
  const itemWidth = showRankings ? WIDTHS.top10 : WIDTHS.poster;

  return (
    <section
      id="trending-now-carousel"
      className={clsx("group/row row-contain relative z-0 py-4 hover:z-30", className)}
      aria-label="Trending Now Carousel"
    >
      {/* Header with Title & Filter Controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-[4vw]">
        {/* Left: Title & Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/30">
              <Flame className="h-4 w-4 fill-amber-500" />
            </span>
            <h2 className="font-display2 text-lg tracking-wider text-neutral-100 md:text-[22px]">
              Trending Now
            </h2>
          </div>

          <span className="hidden rounded-full border border-neutral-750 bg-neutral-900/80 px-2 py-0.5 text-[11px] font-semibold text-neutral-400 sm:inline-block">
            {timeWindow === "day" ? "Today" : "This Week"}
          </span>

          <button
            onClick={handleExploreAll}
            className="flex items-center gap-1 text-[11px] sm:text-[12px] font-semibold text-sky-400 opacity-90 sm:opacity-0 transition-all duration-300 hover:text-sky-300 group-hover/row:opacity-100 pl-1 active:scale-95 cursor-pointer"
            title="Explore all trending titles"
          >
            <span>Explore All</span>
            <ChevronIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </button>
        </div>

        {/* Right: Interactive Filters (Media Type + Time Window + Ranking Toggle) */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Media Type Tabs */}
          <div className="flex rounded-lg border border-neutral-800 bg-neutral-900/90 p-0.5 text-xs font-semibold shadow-inner">
            <button
              id="trending-filter-all"
              onClick={() => setMediaType("all")}
              className={clsx(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition",
                mediaType === "all"
                  ? "bg-brand text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              )}
            >
              <Sparkles className="h-3 w-3" />
              <span>All</span>
            </button>

            <button
              id="trending-filter-movie"
              onClick={() => setMediaType("movie")}
              className={clsx(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition",
                mediaType === "movie"
                  ? "bg-brand text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              )}
            >
              <Film className="h-3 w-3" />
              <span>Movies</span>
            </button>

            <button
              id="trending-filter-tv"
              onClick={() => setMediaType("tv")}
              className={clsx(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition",
                mediaType === "tv"
                  ? "bg-brand text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              )}
            >
              <Tv className="h-3 w-3" />
              <span>TV Shows</span>
            </button>
          </div>

          {/* Time Window Switcher */}
          <div className="flex rounded-lg border border-neutral-800 bg-neutral-900/90 p-0.5 text-[11px] font-semibold">
            <button
              id="trending-time-day"
              onClick={() => setTimeWindow("day")}
              className={clsx(
                "rounded-md px-2 py-1 transition",
                timeWindow === "day"
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              )}
              title="Trending today"
            >
              Today
            </button>
            <button
              id="trending-time-week"
              onClick={() => setTimeWindow("week")}
              className={clsx(
                "rounded-md px-2 py-1 transition",
                timeWindow === "week"
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              )}
              title="Trending this week"
            >
              This Week
            </button>
          </div>

          {/* Rankings Toggle Button */}
          <button
            id="trending-toggle-ranking"
            onClick={() => setShowRankings((prev) => !prev)}
            className={clsx(
              "hidden sm:flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
              showRankings
                ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                : "border-neutral-800 bg-neutral-900/80 text-neutral-400 hover:text-white"
            )}
            title="Toggle Top 10 Rank Numbers"
          >
            <Hash className="h-3 w-3" />
            <span>Top 10</span>
          </button>
        </div>
      </div>

      {/* Horizontal Carousel */}
      <div className="relative">
        {/* Left Arrow Button */}
        <button
          id="trending-scroll-left-btn"
          aria-label="Scroll left"
          onClick={() => page(-1)}
          className={clsx(
            "absolute left-0 top-0 bottom-0 z-20 hidden w-[4vw] items-center justify-center bg-black/60 text-white backdrop-blur-[2px] transition hover:bg-black/80 hover:scale-105 group-hover/row:flex",
            atStart && "!hidden"
          )}
        >
          <ChevronLeft className="h-7 w-7" />
        </button>

        {/* Scrollable Container */}
        <div
          id="trending-carousel-scroller"
          ref={scrollerRef}
          onScroll={syncEdges}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={clsx(
            "no-scrollbar flex gap-2.5 overflow-x-auto px-[4vw] pb-3 pt-1 scroll-smooth",
            isDragging ? "cursor-grabbing select-none" : "cursor-grab"
          )}
        >
          {loading1 && !items.length ? (
            // Skeleton loader cards
            Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`trending-skeleton-${i}`}
                className={clsx("shrink-0", itemWidth)}
              >
                <div className="skeleton aspect-[2/3] w-full rounded-md" />
              </div>
            ))
          ) : error1 && !items.length ? (
            <div className="w-full py-6 text-center text-xs text-neutral-400">
              Unable to load trending items at this moment.
            </div>
          ) : (
            items.map((item, i) => (
              <div
                key={`trending-${item.id}-${i}`}
                id={`trending-card-${item.id}`}
                className={clsx("shrink-0", itemWidth)}
              >
                <Card
                  item={item}
                  variant="poster"
                  rank={showRankings && i < 10 ? i + 1 : undefined}
                />
              </div>
            ))
          )}
        </div>

        {/* Right Arrow Button */}
        <button
          id="trending-scroll-right-btn"
          aria-label="Scroll right"
          onClick={() => page(1)}
          className={clsx(
            "absolute right-0 top-0 bottom-0 z-20 hidden w-[4vw] items-center justify-center bg-black/60 text-white backdrop-blur-[2px] transition hover:bg-black/80 hover:scale-105 group-hover/row:flex",
            atEnd && "!hidden"
          )}
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      </div>
    </section>
  );
}
