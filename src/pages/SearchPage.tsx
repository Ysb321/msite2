"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWRInfinite from "swr/infinite";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Card from "@/components/Card";
import SetupNotice from "@/components/SetupNotice";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { swrFetcher, img, titleOf, kidsSafeItem, type Media } from "@/lib/tmdb";
import { isKidsActive } from "@/lib/storage";
import SmartImage from "@/components/SmartImage";
import { Search, Flame, Film, Tv, Sparkles, User, Filter } from "lucide-react";
import clsx from "clsx";

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const [filterType, setFilterType] = useState<"all" | "movie" | "tv">("all");

  const trending = useTmdbSnapshot<any>(!q ? "trending/all/day?page=1" : null);

  const getKey = (index: number) =>
    q ? `search/multi?query=${encodeURIComponent(q)}&include_adult=false&page=${index + 1}` : null;

  const { data, size, setSize, isLoading, isValidating, error } = useSWRInfinite<any>(getKey, swrFetcher, {
    revalidateFirstPage: false,
    keepPreviousData: true,
    initialSize: 1,
  });

  const { titles, people, total } = useMemo(() => {
    if (!q) {
      const results: Media[] = trending.data?.results ?? [];
      return {
        titles: results.filter((r) => (r.media_type === "movie" || r.media_type === "tv") && (r.poster_path || r.backdrop_path)),
        people: [],
        total: results.length,
      };
    }
    const seen = new Set<number>();
    const titles: Media[] = [];
    let people: Media[] = [];
    for (const [pi, page] of (data ?? []).entries()) {
      for (const r of page?.results ?? []) {
        if (pi === 0 && r.media_type === "person" && r.profile_path) people.push(r);
        if ((r.media_type === "movie" || r.media_type === "tv") && (r.poster_path || r.backdrop_path) && !seen.has(r.id)) {
          seen.add(r.id);
          titles.push(r);
        }
      }
    }
    return { titles: isKidsActive() ? titles.filter(kidsSafeItem) : titles, people, total: data?.[0]?.total_results ?? 0 };
  }, [q, data, trending.data]);

  const filteredTitles = useMemo(() => {
    if (filterType === "all") return titles;
    return titles.filter((t) => t.media_type === filterType);
  }, [titles, filterType]);

  const sentinel = useRef<HTMLDivElement>(null);
  const busyRef = useRef(true);
  const hasMoreRef = useRef(true);
  const sizeRef = useRef(size);
  const setSizeRef = useRef(setSize);
  useEffect(() => void (busyRef.current = isLoading || (data?.[0]?.total_pages ?? 1) === 0), [isLoading, data]);
  useEffect(
    () => void (hasMoreRef.current = q ? size < Math.min(data?.[0]?.total_pages ?? 1, 20) : false),
    [size, data, q]
  );
  useEffect(() => void (sizeRef.current = size), [size]);
  setSizeRef.current = setSize;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let cooldown = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (busyRef.current || !hasMoreRef.current) return;
        const now = performance.now();
        if (now - cooldown < 400) return;
        cooldown = now;
        setSizeRef.current(sizeRef.current + 1);
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (error && titles.length === 0) return <SetupNotice error={error} />;

  if (!q) {
    if (trending.isLoading && titles.length === 0)
      return <GridSkeleton />;
    return (
      <>
        <div className="mb-6 flex items-center gap-2">
          <Flame className="h-5 w-5 text-amber-400" />
          <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">Trending Today</h2>
        </div>
        <PosterGrid items={titles} />
      </>
    );
  }

  if (isLoading && titles.length === 0 && people.length === 0) return <GridSkeleton />;

  if (titles.length === 0 && people.length === 0) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-neutral-400">
          <Search className="h-8 w-8" />
        </div>
        <p className="text-xl font-extrabold text-white">
          No matches found for &ldquo;{q}&rdquo;
        </p>
        <p className="max-w-md text-sm text-neutral-400">
          Try checking for spelling errors, searching for an actor or director name, or exploring trending genres.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Header and Filter Pills */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-lg font-bold text-neutral-200 sm:text-xl">
            Results for <span className="text-white">&ldquo;{q}&rdquo;</span>
          </h1>
          {total > 0 && (
            <p className="text-xs font-semibold text-neutral-400 mt-0.5">
              Found {total.toLocaleString()} matched titles & actors
            </p>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-all cursor-pointer",
              filterType === "all"
                ? "bg-white text-black shadow"
                : "border border-white/15 bg-white/5 text-neutral-300 hover:bg-white/10"
            )}
          >
            All ({titles.length})
          </button>
          <button
            onClick={() => setFilterType("movie")}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-all cursor-pointer",
              filterType === "movie"
                ? "bg-white text-black shadow"
                : "border border-white/15 bg-white/5 text-neutral-300 hover:bg-white/10"
            )}
          >
            Movies
          </button>
          <button
            onClick={() => setFilterType("tv")}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-all cursor-pointer",
              filterType === "tv"
                ? "bg-white text-black shadow"
                : "border border-white/15 bg-white/5 text-neutral-300 hover:bg-white/10"
            )}
          >
            TV Series
          </button>
        </div>
      </div>

      {filteredTitles.length > 0 && (
        <>
          <PosterGrid items={filteredTitles} />
          {q && size < Math.min(data?.[0]?.total_pages ?? 1, 20) && (
            <div className="mt-10 flex justify-center">
              <button
                onClick={() => setSize(size + 1)}
                disabled={isValidating || isLoading}
                className="flex items-center gap-2 rounded-xl bg-brand px-8 py-3 text-sm font-extrabold text-white shadow-lg transition hover:scale-[1.03] hover:bg-brand-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              >
                {isValidating || isLoading ? "Loading more titles…" : `Load More Results (${filteredTitles.length} loaded)`}
              </button>
            </div>
          )}
        </>
      )}

      {people.length > 0 && (
        <div className="mt-14 border-t border-white/10 pt-8">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-sky-400" />
            <h2 className="text-xl font-extrabold text-white">People & Cast</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {people.slice(0, 12).map((p) => (
              <Link
                key={p.id}
                href={`/person/${p.id}`}
                className="group flex flex-col items-center rounded-2xl border border-white/10 bg-panel/60 p-3.5 text-center backdrop-blur-md transition-all duration-300 hover:scale-105 hover:border-white/30 hover:bg-panel"
              >
                <div className="relative mb-2.5 h-24 w-24 overflow-hidden rounded-full ring-2 ring-white/15 transition group-hover:ring-brand shadow-lg bg-neutral-900">
                  <SmartImage
                    src={img(p.profile_path, "w185")}
                    alt={p.name ?? "Actor"}
                    title={p.name}
                    aspectRatio="square"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </div>
                <p className="truncate w-full text-xs font-bold text-white group-hover:text-brand transition-colors">
                  {p.name}
                </p>
                <p className="truncate w-full text-[11px] font-medium text-neutral-400 mt-0.5">
                  {(p.known_for ?? []).slice(0, 2).map(titleOf).join(", ") || "Actor"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PosterGrid({ items, showSkeleton }: { items: Media[]; showSkeleton?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {items.map((m) => (
        <div key={`${m.media_type}-${m.id}`}>
          <Card item={m} variant="poster" className="w-full" />
        </div>
      ))}
      {showSkeleton && Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-xl opacity-60" />)}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="skeleton aspect-[2/3] rounded-xl" />
      ))}
    </div>
  );
}

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <div className="px-[4vw] pb-16 pt-24 md:pt-28">
        <Suspense fallback={<GridSkeleton />}>
          <SearchResults />
        </Suspense>
      </div>
      <Footer />
    </main>
  );
}

