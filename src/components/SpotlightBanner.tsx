"use client";

import { useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import { useTmdbSnapshot } from "./SWRProvider";
import { img, titleOf, yearOf, type Media } from "@/lib/tmdb";
import { useMyList } from "@/context/MyListContext";
import { useTitleModal } from "@/context/TitleModalContext";
import SmartImage from "./SmartImage";
import clsx from "clsx";
import {
  Play,
  Plus,
  Check,
  Star,
  Sparkles,
  Info,
  Trophy,
  Flame,
} from "lucide-react";

interface SpotlightBannerProps {
  className?: string;
}

function SpotlightBanner({ className }: SpotlightBannerProps) {
  const router = useRouter();
  const { inList, toggleList } = useMyList();
  const { openTitleModal } = useTitleModal();

  // Fetch top rated/acclaimed title for spotlight
  const { data } = useTmdbSnapshot<any>(
    "discover/movie?sort_by=vote_average.desc&vote_count.gte=10000&page=1"
  );

  const item = useMemo<Media | null>(() => {
    const results = data?.results ?? [];
    return results[1] || results[0] || null;
  }, [data]);

  const saved = item ? inList(item.id) : false;

  if (!item) return null;

  const backdrop = img(item.backdrop_path ?? item.poster_path, "w1280");
  const poster = img(item.poster_path, "w500");
  const title = titleOf(item);

  return (
    <section
      id="spotlight-feature-banner"
      className={clsx("relative my-10 w-full px-[4vw]", className)}
      aria-label="Editor's Spotlight Feature"
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-r from-neutral-950 via-neutral-900 to-neutral-950 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
        {/* Background Ambient Glow */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-brand/20 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-amber-500/15 blur-[100px]" />

        {/* Background Image Banner */}
        {backdrop && (
          <div className="relative aspect-[21/9] min-h-[340px] max-h-[480px] w-full overflow-hidden">
            <SmartImage
              src={backdrop}
              fallbackSrc={poster}
              alt=""
              title={title}
              year={yearOf(item)}
              aspectRatio="backdrop"
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-center filter brightness-[0.65] contrast-[1.05]"
            />

            {/* Cinematic Multi-Layer Gradient Overlays */}
            <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/85 via-50% to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-transparent" />
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-neutral-950/70 to-transparent" />
          </div>
        )}

        {/* Spotlight Content Overlay */}
        <div className="absolute inset-0 flex items-center justify-between p-6 sm:p-10 md:p-12">
          <div className="flex max-w-xl flex-col justify-center">
            {/* Top Badges */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-500/20 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-amber-300 backdrop-blur-md shadow-sm">
                <Trophy className="h-3.5 w-3.5 fill-amber-300" />
                <span>Editor's Masterpiece</span>
              </span>

              <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-neutral-200 backdrop-blur-md">
                Critical Consensus 98%
              </span>

              <span className="hidden rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10.5px] font-bold text-neutral-300 sm:inline-block">
                4K ULTRA HD
              </span>
            </div>

            {/* Headline Title */}
            <h3 className="font-display text-3xl font-extrabold tracking-tight text-white drop-shadow-lg sm:text-4xl md:text-5xl lg:text-6xl">
              {title}
            </h3>

            {/* Metadata Badges */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs font-semibold text-neutral-300">
              <span className="flex items-center gap-1 rounded bg-amber-500/25 px-2 py-0.5 font-bold text-amber-300 ring-1 ring-amber-500/40">
                <Star className="h-3.5 w-3.5 fill-amber-300" />
                {(item.vote_average ?? 0).toFixed(1)} / 10
              </span>
              <span>•</span>
              <span className="font-bold text-neutral-200">{yearOf(item)}</span>
              <span>•</span>
              <span className="rounded border border-neutral-600 bg-black/40 px-1.5 py-0.5 text-[10px] font-bold text-neutral-300">
                U/A 16+
              </span>
              <span>•</span>
              <span className="text-emerald-400 font-bold">Must Watch</span>
            </div>

            {/* Storyline Overview */}
            <p className="mt-3.5 line-clamp-2 max-w-lg text-xs leading-relaxed text-neutral-200 drop-shadow sm:line-clamp-3 sm:text-sm">
              {item.overview}
            </p>

            {/* CTAs */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                id="spotlight-play-btn"
                onClick={() => router.push(`/watch/movie/${item.id}`)}
                className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-xs font-extrabold text-black shadow-[0_4px_20px_rgba(255,255,255,0.25)] transition hover:bg-neutral-200 hover:scale-105 active:scale-95 sm:text-sm cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Watch Now</span>
              </button>

              <button
                id="spotlight-details-btn"
                onClick={() => openTitleModal("movie", item.id)}
                className="flex items-center gap-2 rounded-xl border border-white/20 bg-neutral-900/80 px-5 py-3 text-xs font-bold text-white shadow backdrop-blur-md transition hover:border-white/40 hover:bg-neutral-800 hover:scale-105 active:scale-95 sm:text-sm cursor-pointer"
              >
                <Info className="h-4 w-4" />
                <span>More Info</span>
              </button>

              <button
                id="spotlight-watchlist-btn"
                onClick={() =>
                  toggleList({
                    id: item.id,
                    type: "movie",
                    title,
                    poster_path: item.poster_path,
                    backdrop_path: item.backdrop_path,
                    vote_average: item.vote_average,
                    year: yearOf(item),
                  })
                }
                aria-label={saved ? "Remove from My List" : "Add to My List"}
                title={saved ? "Remove from My List" : "Add to My List"}
                className={clsx(
                  "flex h-11 w-11 items-center justify-center rounded-full border shadow-md backdrop-blur-md transition hover:scale-110 active:scale-95 cursor-pointer",
                  saved
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                    : "border-white/30 bg-neutral-900/80 text-white hover:border-white hover:bg-white/20"
                )}
              >
                {saved ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Right Floating Poster (Desktop Only) */}
          {poster && (
            <div className="hidden lg:block shrink-0 pl-6">
              <div
                onClick={() => openTitleModal("movie", item.id)}
                className="group/poster relative aspect-[2/3] w-48 cursor-pointer overflow-hidden rounded-xl border border-white/20 shadow-2xl transition-transform duration-300 hover:scale-105"
              >
                <SmartImage
                  src={poster}
                  fallbackSrc={backdrop}
                  alt={title}
                  title={title}
                  year={yearOf(item)}
                  aspectRatio="poster"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover/poster:opacity-100 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg">
                    <Play className="h-5 w-5 fill-current ml-0.5" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default memo(SpotlightBanner);

