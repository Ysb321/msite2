"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWRInfinite from "swr/infinite";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Card from "@/components/Card";
import SetupNotice from "@/components/SetupNotice";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { swrFetcher, img, titleOf, kidsSafeItem, type Media } from "@/lib/tmdb";
import { isKidsActive } from "@/lib/storage";

function SearchResults() {
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();

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
    /* kids mode: non-kids titles (incl. adult anime) never render, even from
     * cached/in-memory pages - fresh fetches are filtered in swrFetcher */
    return { titles: isKidsActive() ? titles.filter(kidsSafeItem) : titles, people, total: data?.[0]?.total_results ?? 0 };
  }, [q, data, trending.data]);

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
        <p className="font-display2 mb-4 text-xl tracking-wider text-neutral-300">Trending today</p>
        <PosterGrid items={titles} />
      </>
    );
  }

  if (isLoading && titles.length === 0 && people.length === 0) return <GridSkeleton />;

  if (titles.length === 0 && people.length === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg text-neutral-300">
          Your search for &ldquo;{q}&rdquo; did not have any matches.
        </p>
        <p className="text-sm text-neutral-500">Suggestions: try different keywords, or a movie title.</p>
      </div>
    );
  }

  return (
    <>
      <p className="mb-4 text-sm text-neutral-400">
        {total > 0 && (
          <>
            {total.toLocaleString()} result{total === 1 ? "" : "s"} for{" "}
            <span className="font-semibold text-white">&ldquo;{q}&rdquo;</span>
          </>
        )}
      </p>

      {titles.length > 0 && (
        <>
          <PosterGrid items={titles} />
          {q && size < Math.min(data?.[0]?.total_pages ?? 1, 20) && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setSize(size + 1)}
                disabled={isValidating || isLoading}
                className="rounded-md bg-brand px-8 py-2.5 text-sm font-bold text-white shadow transition hover:scale-[1.03] hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isValidating || isLoading ? "Loading…" : `Load More — ${titles.length.toLocaleString()} results`}
              </button>
            </div>
          )}
        </>
      )}

      {people.length > 0 && (
        <>
          <p className="font-display2 mb-4 mt-12 text-xl tracking-wider text-neutral-300">People</p>
          <div className="flex flex-wrap gap-5">
            {people.slice(0, 12).map((p) => (
              <div key={p.id} className="w-28">
                <Link href={`/search?q=${encodeURIComponent(p.name ?? "")}`} className="block">
                  <img
                    src={img(p.profile_path, "w185") ?? ""}
                    alt={p.name ?? ""}
                    loading="lazy"
                    decoding="async"
                    className="h-28 w-28 rounded-full object-cover ring-1 ring-white/15 transition hover:ring-white/60"
                  />
                  <p className="mt-2 truncate text-center text-[12.5px] font-medium text-neutral-200">{p.name}</p>
                  <p className="truncate text-center text-[11px] text-neutral-500">
                    {(p.known_for ?? []).slice(0, 2).map(titleOf).join(", ")}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function PosterGrid({ items, showSkeleton }: { items: Media[]; showSkeleton?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-x-2.5 gap-y-14 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
      {items.map((m) => (
        <div key={`${m.media_type}-${m.id}`}>
          <Card item={m} variant="poster" className="w-full" />
        </div>
      ))}
      {showSkeleton && Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[2/3] opacity-60" />)}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-x-2.5 gap-y-14 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i} className="skeleton aspect-[2/3]" />
      ))}
    </div>
  );
}

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <div className="px-[4vw] pb-10 pt-24 md:pt-28">
        <Suspense fallback={<GridSkeleton />}>
          <SearchResults />
        </Suspense>
      </div>
      <Footer />
    </main>
  );
}
