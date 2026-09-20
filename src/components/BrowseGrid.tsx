"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import Card from "./Card";
import SetupNotice from "./SetupNotice";
import { swrFetcher, type Media } from "@/lib/tmdb";
import { MOVIE_GENRES, TV_GENRES } from "@/lib/rows";
import clsx from "clsx";

export type BrowseOptions = {
  type: "movie" | "tv";
  genre?: number; // optional initial genre filter
  heading: string;
  /** anime presets: lock JP + Animation (kids variant adds Kids/Family) */
  preset?: "anime" | "anime-kids";
};

const PAGE_CAP = 500; // TMDB discover caps at 500 pages

/* ── filter dimensions (Material Design 3 filter-chip pattern) ────────────── */
const LANGS = [
  { code: "hi", name: "Hindi" }, { code: "en", name: "English" },
  { code: "ta", name: "Tamil" }, { code: "te", name: "Telugu" },
  { code: "ml", name: "Malayalam" }, { code: "kn", name: "Kannada" },
  { code: "bn", name: "Bengali" }, { code: "mr", name: "Marathi" },
  { code: "pa", name: "Punjabi" }, { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
];
const ERAS: { id: string; label: string; gte?: string; lte?: string }[] = [
  { id: "2026", label: "2026", gte: "2026-01-01", lte: "2026-12-31" },
  { id: "2025", label: "2025", gte: "2025-01-01", lte: "2025-12-31" },
  { id: "2020s", label: "2020s", gte: "2020-01-01", lte: "2029-12-31" },
  { id: "2010s", label: "2010s", gte: "2010-01-01", lte: "2019-12-31" },
  { id: "2000s", label: "2000s", gte: "2000-01-01", lte: "2009-12-31" },
  { id: "90s", label: "90s", gte: "1990-01-01", lte: "1999-12-31" },
  { id: "older", label: "Classics", lte: "1989-12-31" },
];
const RATINGS = [6, 7, 8];
const SORTS = [
  { id: "pop", label: "Popular" }, { id: "new", label: "Newest" },
  { id: "rated", label: "Top Rated" }, { id: "az", label: "A–Z" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

/** Infinite poster grid (Movies / TV / Anime / Genres) with full content
 *  filters: genres (multi), language, era, min rating, sort. Pages stream in
 *  via useSWRInfinite with a stable, cooldown-guarded IntersectionObserver. */
export default function BrowseGrid({ options }: { options: BrowseOptions }) {
  const { type, genre, heading, preset } = options;
  const genreMap = type === "movie" ? MOVIE_GENRES : TV_GENRES;

  const [selGenres, setSelGenres] = useState<number[]>(genre ? [genre] : []);
  const [lang, setLang] = useState<string | undefined>(undefined);
  const [era, setEra] = useState<string | undefined>(undefined);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [sort, setSort] = useState<SortId>("pop");
  const [open, setOpen] = useState(false);

  useEffect(() => setSelGenres(genre ? [genre] : []), [genre]);

  const toggleGenre = (id: number) =>
    setSelGenres((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));

  const activeCount =
    (preset ? 0 : selGenres.length) + (lang ? 1 : 0) + (era ? 1 : 0) + (minRating ? 1 : 0);

  const clearAll = () => {
    setSelGenres([]); setLang(undefined); setEra(undefined); setMinRating(undefined);
  };

  const params = useMemo(() => {
    const p = new URLSearchParams({ include_adult: "false" });
    // anime preset: JP animation locked
    if (preset === "anime") {
      p.set("with_genres", "16");
      if (type === "tv") p.set("with_origin_country", "JP");
      else p.set("with_original_language", "ja");
    } else if (preset === "anime-kids") {
      p.set("with_genres", type === "tv" ? "16,10762" : "16,10751");
      if (type === "tv") p.set("with_origin_country", "JP");
      else p.set("with_original_language", "ja");
    } else if (selGenres.length) {
      p.set("with_genres", selGenres.join("|")); // | = OR within genres
    }
    if (preset !== "anime" && preset !== "anime-kids" && lang) p.set("with_original_language", lang);
    const eraDef = ERAS.find((x) => x.id === era);
    const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
    if (eraDef?.gte) p.set(`${dateKey}.gte`, eraDef.gte);
    if (eraDef?.lte) p.set(`${dateKey}.lte`, eraDef.lte);
    if (minRating) p.set("vote_average.gte", String(minRating));
    // vote-count floors: keep junk out; raise for rating sort (vote_average
    // sorting is meaningless without a serious vote floor)
    const base = type === "movie" ? 80 : 25;
    const floor = sort === "rated" ? (type === "movie" ? 1000 : 500) : base;
    p.set("vote_count.gte", String(floor));
    if (sort === "pop") p.set("sort_by", "popularity.desc");
    else if (sort === "new") p.set("sort_by", type === "movie" ? "primary_release_date.desc" : "first_air_date.desc");
    else if (sort === "rated") p.set("sort_by", "vote_average.desc");
    else p.set("sort_by", type === "movie" ? "title.asc" : "name.asc");
    return p;
  }, [type, preset, selGenres, lang, era, minRating, sort]);

  const getKey = (index: number) => `discover/${type}?${params.toString()}&page=${index + 1}`;
  const { data, size, setSize, isLoading, isValidating, error } = useSWRInfinite<any>(getKey, swrFetcher, {
    revalidateFirstPage: false,
    revalidateAll: false,
    keepPreviousData: true,
    initialSize: 2,
  });

  const items = useMemo(() => {
    const seen = new Set<number>();
    const out: Media[] = [];
    for (const page of data ?? [])
      for (const r of page?.results ?? []) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          out.push({ ...r, media_type: type });
        }
      }
    return out;
  }, [data, type]);

  const total = data?.[0]?.total_pages ?? 1;
  const hasMore = size < Math.min(total, PAGE_CAP);

  /* ── stable infinite-scroll sentinel (never recreated, ref-driven) ── */
  const sentinel = useRef<HTMLDivElement>(null);
  const busyRef = useRef(true);
  const hasMoreRef = useRef(true);
  const sizeRef = useRef(size);
  const setSizeRef = useRef(setSize);
  useEffect(() => void (busyRef.current = isLoading || isValidating), [isLoading, isValidating]);
  useEffect(() => void (hasMoreRef.current = hasMore), [hasMore]);
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
        if (now - cooldown < 400) return; // one page per 400ms max
        cooldown = now;
        setSizeRef.current(sizeRef.current + 1);
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="px-[4vw] pb-10">
      <div className="mb-4 flex flex-wrap items-center gap-2 pt-24 md:pt-28">
        <h1 className="font-display mr-3 text-3xl tracking-wide md:text-5xl">{heading}</h1>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={clsx(
            "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition",
            activeCount > 0 || open
              ? "border-brand bg-brand/15 text-white"
              : "border-neutral-600 text-neutral-300 hover:border-white hover:text-white"
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
            <path d="M3 6h18M6 12h12M10 18h4" strokeLinecap="round" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <button onClick={clearAll} className="text-[12px] font-medium text-neutral-400 underline-offset-2 hover:text-white hover:underline">
            Clear all
          </button>
        )}
      </div>

      {/* genre chips (always visible; multi-select; hidden for the anime preset) */}
      {preset === undefined && (
        <div className="no-scrollbar -mx-[4vw] mb-3 flex gap-1.5 overflow-x-auto px-[4vw] pb-1">
          <Chip active={selGenres.length === 0} onClick={() => setSelGenres([])}>
            All
          </Chip>
          {Object.entries(genreMap).map(([id, name]) => (
            <Chip key={id} active={selGenres.includes(Number(id))} onClick={() => toggleGenre(Number(id))}>
              {name}
            </Chip>
          ))}
        </div>
      )}

      {/* advanced filter panel */}
      {open && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          {preset === undefined && (
            <FilterRow label="Language">
              <Chip active={!lang} onClick={() => setLang(undefined)}>Any</Chip>
              {LANGS.map((l) => (
                <Chip key={l.code} active={lang === l.code} onClick={() => setLang(l.code)}>
                  {l.name}
                </Chip>
              ))}
            </FilterRow>
          )}
          <FilterRow label="Era">
            <Chip active={!era} onClick={() => setEra(undefined)}>Any</Chip>
            {ERAS.map((e) => (
              <Chip key={e.id} active={era === e.id} onClick={() => setEra(e.id)}>
                {e.label}
              </Chip>
            ))}
          </FilterRow>
          <FilterRow label="Rating">
            <Chip active={!minRating} onClick={() => setMinRating(undefined)}>Any</Chip>
            {RATINGS.map((r) => (
              <Chip key={r} active={minRating === r} onClick={() => setMinRating(r)}>
                {r}★+
              </Chip>
            ))}
          </FilterRow>
          <FilterRow label="Sort">
            {SORTS.map((s) => (
              <Chip key={s.id} active={sort === s.id} onClick={() => setSort(s.id)}>
                {s.label}
              </Chip>
            ))}
          </FilterRow>
        </div>
      )}

      {error && items.length === 0 ? (
        <SetupNotice error={error} />
      ) : items.length === 0 && isLoading ? (
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-10 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
          {Array.from({ length: 21 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[2/3]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-2.5 gap-y-10 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {items.map((m) => (
              <div key={m.id}>
                <Card item={m} variant="poster" className="w-full" />
              </div>
            ))}
            {isValidating && hasMore &&
              Array.from({ length: 7 }).map((_, i) => <div key={`s${i}`} className="skeleton aspect-[2/3] opacity-60" />)}
          </div>
          <div ref={sentinel} className="h-4" />
          <div className="flex flex-col items-center gap-2 py-4">
            {hasMore ? (
              <button
                onClick={() => setSize(size + 1)}
                disabled={isValidating || isLoading}
                className="rounded-md bg-brand px-8 py-2.5 text-sm font-bold text-white shadow transition hover:scale-[1.03] hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isValidating || isLoading ? "Loading…" : `Load More — ${items.length.toLocaleString()} loaded`}
              </button>
            ) : (
              <p className="text-[12px] text-neutral-500">
                {items.length.toLocaleString()} titles · You&rsquo;ve reached the end
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-2 w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "min-h-9 shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition",
        active ? "bg-white text-black" : "bg-white/10 text-neutral-300 hover:bg-white/20"
      )}
    >
      {children}
    </button>
  );
}
