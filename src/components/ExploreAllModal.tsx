"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import useSWRInfinite from "swr/infinite";
import Card from "./Card";
import { swrFetcher, type Media, titleOf } from "@/lib/tmdb";
import { MOVIE_GENRES, TV_GENRES, interleave } from "@/lib/rows";
import type { ExploreAllConfig } from "@/context/ExploreAllContext";
import clsx from "clsx";
import {
  X,
  Search,
  ArrowUp,
  SlidersHorizontal,
  Flame,
  Trophy,
  Heart,
  Film,
  Tv,
  Globe,
  Shield,
  Zap,
  Sparkles,
  LayoutGrid,
  Grid3X3,
} from "lucide-react";

type SortOption = "default" | "rated" | "newest" | "pop" | "az";

function getModalIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("trending")) return { icon: Flame, color: "text-amber-400" };
  if (t.includes("top 10") || t.includes("top rated")) return { icon: Trophy, color: "text-yellow-400" };
  if (t.includes("bollywood") || t.includes("south")) return { icon: Heart, color: "text-rose-400" };
  if (t.includes("anime")) return { icon: Zap, color: "text-purple-400" };
  if (t.includes("marvel")) return { icon: Shield, color: "text-red-500" };
  if (t.includes("tv") || t.includes("shows") || t.includes("series")) return { icon: Tv, color: "text-violet-400" };
  if (t.includes("global") || t.includes("hollywood")) return { icon: Globe, color: "text-blue-400" };
  return { icon: Film, color: "text-sky-400" };
}

const inferType = (path?: string): "movie" | "tv" | undefined => {
  if (!path) return undefined;
  if (path.includes("multi")) return undefined;
  if (path.startsWith("movie") || path.includes("/movie")) return "movie";
  if (path.startsWith("tv") || path.includes("/tv")) return "tv";
  return undefined;
};

export default function ExploreAllModal({
  config,
  onClose,
}: {
  config: ExploreAllConfig;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [selectedMediaType, setSelectedMediaType] = useState<"all" | "movie" | "tv">("all");
  const [sortBy, setSortBy] = useState<SortOption>("default");
  const [compactGrid, setCompactGrid] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [initialSlice, setInitialSlice] = useState(30);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Prevent background body scroll while modal is active & listen for Escape
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const single = config.sources && config.sources.length === 1 ? config.sources[0] : null;
  const isMulti = Boolean(config.sources && config.sources.length > 1);
  const isEndpoint = Boolean(config.endpoint);
  const isInitial = Boolean(config.initialItems && !config.sources && !config.endpoint);

  // 1) Single source pagination
  const getSingleKey = useCallback(
    (index: number) => {
      if (!single) return null;
      const [path, params] = single;
      const p = new URLSearchParams(params as Record<string, string>);
      p.set("page", String(index + 1));
      return `${path}?${p.toString()}`;
    },
    [single]
  );

  const singleInfinite = useSWRInfinite<any>(single ? getSingleKey : () => null, swrFetcher, {
    revalidateFirstPage: false,
    revalidateAll: false,
    keepPreviousData: true,
    initialSize: 2,
  });

  // 2) Endpoint pagination (e.g. trending/all/day)
  const getEndpointKey = useCallback(
    (index: number) => {
      if (!config.endpoint) return null;
      const sep = config.endpoint.includes("?") ? "&" : "?";
      return `${config.endpoint}${sep}page=${index + 1}`;
    },
    [config.endpoint]
  );

  const endpointInfinite = useSWRInfinite<any>(isEndpoint ? getEndpointKey : () => null, swrFetcher, {
    revalidateFirstPage: false,
    revalidateAll: false,
    keepPreviousData: true,
    initialSize: 2,
  });

  // 3) Multi-source pagination (interleaving)
  const sources = config.sources ?? [];
  const getMultiKey = useCallback(
    (index: number) => {
      if (!isMulti) return null;
      return `multi-explore:${sources.map((s) => s[0]).join("|")}:${index + 1}`;
    },
    [isMulti, sources]
  );

  const multiFetcher = useCallback(
    async (key: string) => {
      const parts = key.split(":");
      const page = parseInt(parts[parts.length - 1], 10) || 1;
      const responses = await Promise.all(
        sources.map(async ([path, params]) => {
          const p = new URLSearchParams(params as Record<string, string>);
          p.set("page", String(page));
          try {
            return await swrFetcher(`${path}?${p.toString()}`);
          } catch {
            return { results: [], total_pages: 1 };
          }
        })
      );
      const lists = responses.map((r) => r?.results ?? []);
      const merged = interleave(lists);
      const maxPages = Math.max(1, ...responses.map((r) => r?.total_pages ?? 1));
      return { results: merged, total_pages: maxPages };
    },
    [sources]
  );

  const multiInfinite = useSWRInfinite<any>(isMulti ? getMultiKey : () => null, multiFetcher, {
    revalidateFirstPage: false,
    revalidateAll: false,
    keepPreviousData: true,
    initialSize: 2,
  });

  // Active SWR instance
  const activeSWR = single ? singleInfinite : isEndpoint ? endpointInfinite : multiInfinite;

  // Extract raw items with deduplication
  const rawItems = useMemo(() => {
    if (isInitial) {
      return config.initialItems ?? [];
    }
    const pages = activeSWR.data ?? [];
    const seen = new Set<number>();
    const out: Media[] = [];
    const forced =
      config.mediaType && config.mediaType !== "all"
        ? config.mediaType
        : single
        ? inferType(single[0])
        : undefined;

    for (const page of pages) {
      for (const r of page?.results ?? []) {
        if (r && !seen.has(r.id)) {
          seen.add(r.id);
          out.push(forced ? { ...r, media_type: forced } : r);
        }
      }
    }
    return config.pick ? config.pick(out) : out;
  }, [
    isInitial,
    config.initialItems,
    config.mediaType,
    config.pick,
    single,
    activeSWR.data,
  ]);

  const totalPages = isInitial
    ? Math.ceil((config.initialItems?.length ?? 0) / 30)
    : activeSWR.data?.[0]?.total_pages ?? 1;

  const hasMore = isInitial
    ? initialSlice < (config.initialItems?.length ?? 0)
    : activeSWR.size < Math.min(totalPages, 60);

  const isInitialLoading = isInitial ? false : activeSWR.isLoading && activeSWR.size === 1;
  const isValidating = isInitial ? false : activeSWR.isValidating;

  const loadMore = useCallback(() => {
    if (isInitial) {
      setInitialSlice((s) => s + 30);
    } else {
      activeSWR.setSize(activeSWR.size + 1);
    }
  }, [isInitial, activeSWR]);

  // Stable Sentinel Intersection Observer for Infinite Scrolling
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || typeof IntersectionObserver === "undefined") return;

    let cooldown = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (isValidating || !hasMore) return;
        const now = performance.now();
        if (now - cooldown < 450) return;
        cooldown = now;
        loadMore();
      },
      {
        root: container,
        rootMargin: "650px 0px",
      }
    );

    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, isValidating, loadMore]);

  // Extract available genres for filter chips
  const availableGenres = useMemo(() => {
    const genreSet = new Set<number>();
    for (const m of rawItems) {
      const ids = m.genre_ids ?? m.genres?.map((g) => g.id) ?? [];
      ids.forEach((id) => genreSet.add(id));
    }
    return Array.from(genreSet)
      .map((id) => ({ id, name: MOVIE_GENRES[id] || TV_GENRES[id] }))
      .filter((g) => Boolean(g.name))
      .slice(0, 12);
  }, [rawItems]);

  // Check if mixed media types exist in this catalog
  const hasMixedMedia = useMemo(() => {
    let hasMovie = false;
    let hasTv = false;
    for (const m of rawItems.slice(0, 40)) {
      const t = m.media_type || (m.first_air_date ? "tv" : "movie");
      if (t === "movie") hasMovie = true;
      if (t === "tv") hasTv = true;
      if (hasMovie && hasTv) return true;
    }
    return false;
  }, [rawItems]);

  // Filter pipeline: Search -> MediaType -> Genre -> Sort
  const processedItems = useMemo(() => {
    let list = rawItems;

    // Search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const t = titleOf(m).toLowerCase();
        const ov = (m.overview ?? "").toLowerCase();
        return t.includes(q) || ov.includes(q);
      });
    }

    // Media type filter
    if (selectedMediaType !== "all") {
      list = list.filter((m) => {
        const t = m.media_type || (m.first_air_date ? "tv" : "movie");
        return t === selectedMediaType;
      });
    }

    // Genre filter
    if (selectedGenre !== null) {
      list = list.filter((m) => {
        const ids = m.genre_ids ?? m.genres?.map((g) => g.id) ?? [];
        return ids.includes(selectedGenre);
      });
    }

    // Sort
    const items = [...list];
    if (sortBy === "rated") {
      items.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    } else if (sortBy === "pop") {
      items.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    } else if (sortBy === "newest") {
      items.sort((a, b) => {
        const da = a.release_date || a.first_air_date || "";
        const db = b.release_date || b.first_air_date || "";
        return db.localeCompare(da);
      });
    } else if (sortBy === "az") {
      items.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    }

    return isInitial ? items.slice(0, initialSlice) : items;
  }, [
    rawItems,
    searchQuery,
    selectedMediaType,
    selectedGenre,
    sortBy,
    isInitial,
    initialSlice,
  ]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    setShowScrollTop(scrollContainerRef.current.scrollTop > 450);
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const { icon: HeaderIcon, color: iconColor } = useMemo(
    () => getModalIcon(config.title),
    [config.title]
  );

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (selectedGenre !== null ? 1 : 0) +
    (selectedMediaType !== "all" ? 1 : 0) +
    (sortBy !== "default" ? 1 : 0);

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedGenre(null);
    setSelectedMediaType("all");
    setSortBy("default");
  };

  return (
    <div
      id="explore-all-modal-backdrop"
      className="anim-fade-in fixed inset-0 z-[250] flex items-center justify-center bg-black/85 p-2 sm:p-4 md:p-6 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Explore All: ${config.title}`}
    >
      <div
        id="explore-all-modal-dialog"
        className="modal-in relative flex h-[94vh] max-h-[1150px] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Header Bar */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-neutral-950/90 px-4 py-3 sm:px-6 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left: Title & Count Badge */}
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={clsx(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5",
                  iconColor
                )}
              >
                <HeaderIcon className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-display2 text-lg tracking-wider text-white sm:text-xl md:text-2xl">
                    {config.title}
                  </h2>
                  <span className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-bold text-sky-400">
                    {processedItems.length} {processedItems.length === 1 ? "title" : "titles"}
                  </span>
                </div>
                {config.subtitle && (
                  <p className="truncate text-xs text-neutral-400">{config.subtitle}</p>
                )}
              </div>
            </div>

            {/* Right: Search, Sort, Grid Toggle & Close Button */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Quick in-modal Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in catalog..."
                  className="h-8 w-36 rounded-full border border-white/15 bg-neutral-900/90 pl-8 pr-7 text-xs text-white placeholder-neutral-500 outline-none transition focus:w-48 focus:border-brand focus:ring-1 focus:ring-brand sm:w-44 sm:focus:w-56"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Sort Dropdown */}
              <div className="relative hidden sm:block">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  aria-label="Sort catalog by"
                  className="h-8 rounded-full border border-white/15 bg-neutral-900 px-3 pr-7 text-xs font-semibold text-neutral-300 outline-none transition hover:border-white/30 focus:border-brand"
                >
                  <option value="default">Featured Sort</option>
                  <option value="rated">Highest Rated ★</option>
                  <option value="pop">Most Popular</option>
                  <option value="newest">Newest Release</option>
                  <option value="az">Title A–Z</option>
                </select>
              </div>

              {/* Grid Density Toggle (Desktop) */}
              <button
                onClick={() => setCompactGrid((c) => !c)}
                aria-label={compactGrid ? "Switch to standard grid" : "Switch to compact grid"}
                title={compactGrid ? "Standard View" : "Compact View"}
                className="hidden md:flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-neutral-900 text-neutral-300 transition hover:border-white hover:text-white"
              >
                {compactGrid ? (
                  <LayoutGrid className="h-3.5 w-3.5" />
                ) : (
                  <Grid3X3 className="h-3.5 w-3.5" />
                )}
              </button>

              {/* Close Button */}
              <button
                id="explore-modal-close-btn"
                onClick={onClose}
                aria-label="Close Explore All modal"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-neutral-900 text-neutral-300 transition hover:border-white hover:bg-neutral-800 hover:text-white"
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Subheader: Filter Chips & Active Filters */}
          <div className="no-scrollbar mt-2.5 flex items-center gap-2 overflow-x-auto pb-1">
            {/* Mixed media filter */}
            {hasMixedMedia && (
              <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-neutral-900 p-0.5">
                <button
                  onClick={() => setSelectedMediaType("all")}
                  className={clsx(
                    "rounded-full px-2.5 py-1 text-[11px] font-bold transition",
                    selectedMediaType === "all" ? "bg-white text-black" : "text-neutral-400 hover:text-white"
                  )}
                >
                  All Media
                </button>
                <button
                  onClick={() => setSelectedMediaType("movie")}
                  className={clsx(
                    "rounded-full px-2.5 py-1 text-[11px] font-bold transition",
                    selectedMediaType === "movie" ? "bg-white text-black" : "text-neutral-400 hover:text-white"
                  )}
                >
                  Movies
                </button>
                <button
                  onClick={() => setSelectedMediaType("tv")}
                  className={clsx(
                    "rounded-full px-2.5 py-1 text-[11px] font-bold transition",
                    selectedMediaType === "tv" ? "bg-white text-black" : "text-neutral-400 hover:text-white"
                  )}
                >
                  TV Shows
                </button>
              </div>
            )}

            {/* Genre chips */}
            {availableGenres.length > 0 && (
              <>
                <button
                  onClick={() => setSelectedGenre(null)}
                  className={clsx(
                    "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition",
                    selectedGenre === null
                      ? "bg-brand text-white shadow-sm"
                      : "border border-white/10 bg-neutral-900 text-neutral-300 hover:border-white/20 hover:text-white"
                  )}
                >
                  All Genres
                </button>
                {availableGenres.map((g) => {
                  const isCurrent = selectedGenre === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGenre(isCurrent ? null : g.id)}
                      className={clsx(
                        "shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition",
                        isCurrent
                          ? "bg-brand text-white shadow-sm"
                          : "border border-white/10 bg-neutral-900/80 text-neutral-300 hover:border-white/20 hover:text-white"
                      )}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </>
            )}

            {/* Clear all active filters */}
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="shrink-0 text-[11px] font-semibold text-neutral-400 underline underline-offset-4 hover:text-white ml-auto"
              >
                Clear Filters
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Catalog Body */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          tabIndex={0}
          className="no-scrollbar flex-1 overflow-y-auto p-4 sm:p-6"
        >
          {isInitialLoading ? (
            /* Initial Skeleton Grid */
            <div
              className={clsx(
                "grid gap-3 sm:gap-4",
                compactGrid
                  ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
                  : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
              )}
            >
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] w-full skeleton rounded-xl" />
              ))}
            </div>
          ) : processedItems.length === 0 ? (
            /* Empty State */
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-neutral-900 text-neutral-400">
                <Search className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-white">No titles matched your filters</h3>
              <p className="mt-1 max-w-sm text-xs text-neutral-400">
                Try searching with another keyword or resetting your category filters.
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="mt-4 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white shadow transition hover:bg-brand-dark"
                >
                  Reset all filters
                </button>
              )}
            </div>
          ) : (
            /* Live Catalog Grid */
            <>
              <div
                className={clsx(
                  "grid gap-3 sm:gap-4",
                  compactGrid
                    ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
                    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                )}
              >
                {processedItems.map((item, index) => (
                  <div key={`${item.id}-${index}`} className="relative">
                    <Card
                      item={item}
                      variant={config.variant ?? "poster"}
                      rank={config.top10 ? index + 1 : undefined}
                    />
                  </div>
                ))}
              </div>

              {/* Sentinel Div for Infinite Scrolling */}
              <div ref={sentinelRef} className="h-10 w-full" />

              {/* Loading next page skeletons */}
              {isValidating && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold text-neutral-400">
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                    <span>Loading more titles...</span>
                  </div>
                  <div
                    className={clsx(
                      "grid gap-3 sm:gap-4 opacity-50",
                      compactGrid
                        ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
                        : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                    )}
                  >
                    {Array.from({ length: compactGrid ? 8 : 6 }).map((_, i) => (
                      <div key={`loading-${i}`} className="aspect-[2/3] w-full skeleton rounded-xl" />
                    ))}
                  </div>
                </div>
              )}

              {/* End of catalog notice */}
              {!hasMore && processedItems.length > 0 && (
                <div className="my-8 flex flex-col items-center justify-center text-center text-xs text-neutral-500">
                  <div className="mb-2 h-px w-24 bg-neutral-800" />
                  <p>You have reached the end of this catalog</p>
                  <span className="mt-0.5 text-[11px] text-neutral-600">
                    {processedItems.length} total titles explored
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Floating Scroll to Top Button */}
        {showScrollTop && (
          <button
            onClick={scrollToTop}
            aria-label="Scroll back to top"
            className="anim-fade-in absolute bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-neutral-900/90 text-white shadow-2xl backdrop-blur-md transition hover:scale-110 hover:border-brand hover:bg-neutral-800 active:scale-95"
            title="Scroll to Top"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
