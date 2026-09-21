"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { img, titleOf, yearOf, typeOf, prefetchTitleDetails, type Media } from "@/lib/tmdb";
import { type ProgressItem } from "@/lib/storage";
import { useMyList } from "@/context/MyListContext";
import { useTitleModal } from "@/context/TitleModalContext";
import { wasRecentlyDragged } from "@/lib/dragGuard";
import CardPreview from "./CardPreview";
import SmartImage from "./SmartImage";
import { PlayIcon, PlusIcon, CheckIcon, XIcon, StarIcon } from "./Icons";

/** Netflix-style card. Quick hover = subtle lift + in-card overlay; dwell
 *  ~0.4s = expanded 16:9 preview card (CardPreview) with muted trailer. */
function Card({
  item,
  variant = "backdrop",
  rank,
  progress,
  onRemove,
  className,
}: {
  item: Media;
  variant?: "backdrop" | "poster";
  rank?: number; // top-10 ranking
  progress?: ProgressItem; // continue-watching bar
  onRemove?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const { inList, toggleList } = useMyList();
  const { openTitleModal } = useTitleModal();
  const saved = inList(item.id);
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRef = useRef(false);

  const type = typeOf(item);
  const poster = variant === "poster" || rank !== undefined;
  const primarySrc = poster
    ? img(item.poster_path ?? item.backdrop_path, "w342") ?? img(item.backdrop_path, "w780")
    : img(item.backdrop_path ?? item.poster_path, "w500") ?? img(item.poster_path, "w342");

  const fallbackSrc = poster
    ? img(item.backdrop_path, "w500") ?? img(item.poster_path, "w185")
    : img(item.poster_path, "w500") ?? img(item.backdrop_path, "w300");

  const match = Math.round((item.vote_average ?? 0) * 10);

  const open = () => {
    if (wasRecentlyDragged()) return;
    if (progress) {
      play();
      return;
    }
    openTitleModal(type, item.id, item);
  };

  const play = () => {
    if (wasRecentlyDragged()) return;
    if (type === "tv" && progress?.season && progress?.episode)
      router.push(`/watch/tv/${item.id}?s=${progress.season}&e=${progress.episode}`);
    else router.push(type === "tv" ? `/watch/tv/${item.id}?s=1&e=1` : `/watch/movie/${item.id}`);
  };

  /* ── hover → dwell → expanded 16:9 preview (mouse devices only) ── */
  const enter = () => {
    prefetchTitleDetails(type, item.id);
    if (hoverRef.current) return;
    hoverRef.current = true;
    setHover(true);
    if (closeT.current) clearTimeout(closeT.current);
    if (typeof window === "undefined" || !window.matchMedia?.("(hover: hover)").matches) return;
    dwell.current = setTimeout(() => {
      const el = rootRef.current;
      if (el) setPreview(el.getBoundingClientRect());
    }, 750);
  };

  const leave = () => {
    hoverRef.current = false;
    setHover(false);
    if (dwell.current) clearTimeout(dwell.current);
    closeT.current = setTimeout(() => setPreview(null), 160);
  };

  useEffect(
    () => () => {
      if (dwell.current) clearTimeout(dwell.current);
      if (closeT.current) clearTimeout(closeT.current);
    },
    []
  );

  return (
    <>
      <div
        ref={rootRef}
        role="button"
        tabIndex={0}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={open}
        onKeyDown={(e) => e.key === "Enter" && open()}
        aria-label={titleOf(item)}
        style={{ zIndex: hover ? 40 : undefined }}
        className={clsx(
          "group/card fast-transform flex cursor-pointer flex-col rounded-xl [contain:layout_style] transition-transform duration-200 hover:scale-[1.025]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          className
        )}
      >
        {/* image with SmartImage fallbacks */}
        <div
          className={clsx(
            "relative overflow-hidden rounded-xl bg-panel-2 ring-1 ring-white/10 transition-all duration-300 group-hover/card:ring-white/30 group-hover/card:shadow-[0_12px_28px_rgba(0,0,0,0.8)]",
            poster ? "aspect-[2/3]" : "aspect-video"
          )}
        >
          <SmartImage
            src={primarySrc}
            fallbackSrc={fallbackSrc}
            alt={titleOf(item)}
            title={titleOf(item)}
            year={yearOf(item)}
            aspectRatio={poster ? "poster" : "backdrop"}
            loading="lazy"
            decoding="async"
            className="transition-transform duration-500 group-hover/card:scale-105"
          />

          {/* top-10 rank */}
          {rank !== undefined && (
            <div
              className="absolute -left-2 bottom-0 z-10 flex select-none items-end leading-none font-black text-[6.5rem] text-black"
              style={{ WebkitTextStroke: "3px #888899", letterSpacing: "-0.08em" }}
            >
              {rank}
            </div>
          )}

          {/* poster rating badge */}
          {poster && (item.vote_average ?? 0) > 0 && (
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/80 backdrop-blur-md px-1.5 py-0.5 text-[10.5px] font-bold text-amber-400 shadow ring-1 ring-white/10 transition group-hover/card:opacity-0">
              <StarIcon className="h-2.5 w-2.5" />
              {(item.vote_average ?? 0).toFixed(1)}
            </div>
          )}

          {/* continue-watching progress */}
          {progress && (
            <div className="absolute inset-x-2 bottom-2 z-10 h-[3.5px] rounded-full bg-white/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand shadow-[0_0_8px_rgba(229,9,20,0.8)]"
                style={{
                  width:
                    progress.positionSec && progress.durationSec
                      ? `${Math.min(98, (progress.positionSec / progress.durationSec) * 100)}%`
                      : progress.season
                      ? `${Math.min(92, 8 + progress.episode! * 18)}%`
                      : "42%",
                }}
              />
            </div>
          )}

          {/* title strip for landscape cards */}
          {!poster && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] rounded-b-xl bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 group-hover/card:opacity-0">
              <p className="truncate text-[13px] font-bold text-neutral-100 drop-shadow-md">
                {titleOf(item)}
              </p>
            </div>
          )}

          {/* quick-hover overlay */}
          <div className="pointer-events-none invisible absolute inset-0 z-20 flex flex-col justify-end rounded-xl bg-gradient-to-t from-black/95 via-black/50 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover/card:visible group-hover/card:opacity-100 group-focus-within/card:visible group-focus-within/card:opacity-100 backdrop-blur-[2px]">
            <div className="pointer-events-auto">
              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    play();
                  }}
                  aria-label="Play"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-110 hover:bg-neutral-200 cursor-pointer"
                >
                  <PlayIcon className="ml-0.5 h-4 w-4 fill-current" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleList({
                      id: item.id,
                      type,
                      title: titleOf(item),
                      poster_path: item.poster_path,
                      backdrop_path: item.backdrop_path,
                      vote_average: item.vote_average,
                      year: yearOf(item),
                    });
                  }}
                  aria-label={saved ? "Remove from My List" : "Add to My List"}
                  title={saved ? "Remove from My List" : "Add to My List"}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/60 text-white backdrop-blur-md shadow transition hover:scale-110 hover:border-white cursor-pointer"
                >
                  {saved ? (
                    <CheckIcon className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <PlusIcon className="h-4 w-4" />
                  )}
                </button>
                {onRemove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove();
                    }}
                    aria-label="Remove"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/60 text-white backdrop-blur-md shadow transition hover:scale-110 hover:border-white cursor-pointer"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
                <span className="ml-auto flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-bold text-amber-400 ring-1 ring-white/10 backdrop-blur-sm">
                  <StarIcon className="h-3 w-3 fill-current" />
                  {(item.vote_average ?? 0).toFixed(1)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                <span className="font-bold text-emerald-400">{match}% Match</span>
                {yearOf(item) && (
                  <span className="font-medium text-neutral-300">
                    {yearOf(item)}
                  </span>
                )}
                <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-neutral-200">
                  4K HDR
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* caption under portrait cards */}
        {poster && (
          <div className="w-full px-1 pt-2">
            <p className="truncate text-[13px] font-bold tracking-tight text-neutral-100 group-hover/card:text-brand transition-colors">
              {titleOf(item)}
            </p>
            <p className="truncate text-[11px] text-neutral-400 mt-0.5">
              {match > 0 && (
                <span className="font-semibold text-emerald-400">
                  {match}% Match
                </span>
              )}
              {yearOf(item) && ` · ${yearOf(item)}`}
            </p>
          </div>
        )}
      </div>

      {/* expanded 16:9 preview */}
      {preview && (
        <CardPreview
          item={item}
          anchor={preview}
          progress={progress}
          onClose={() => setPreview(null)}
          onEnter={() => {
            if (closeT.current) clearTimeout(closeT.current);
          }}
          onLeave={() => setPreview(null)}
        />
      )}
    </>
  );
}

export default memo(Card);
