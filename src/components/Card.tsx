"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { img, titleOf, yearOf, typeOf, type Media } from "@/lib/tmdb";
import { toggleList, inList, type ProgressItem } from "@/lib/storage";
import { wasRecentlyDragged } from "@/lib/dragGuard";
import CardPreview from "./CardPreview";
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
  const [saved, setSaved] = useState(() => inList(item.id));
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRef = useRef(false);

  const type = typeOf(item);
  const poster = variant === "poster" || rank !== undefined;
  const src = poster
    ? img(item.poster_path ?? item.backdrop_path, "w342") ?? img(item.backdrop_path, "w780")
    : img(item.backdrop_path ?? item.poster_path, "w500") ?? img(item.poster_path, "w342");
  const match = Math.round((item.vote_average ?? 0) * 10);

  // resume: clicking a continue-watching card plays straight from where it
  // left off (exact season/episode + startAt); other cards open details
  const open = () => {
    if (wasRecentlyDragged()) return;
    if (progress) {
      play();
      return;
    }
    router.push(`/title/${type}/${item.id}`);
  };
  const play = () => {
    if (wasRecentlyDragged()) return;
    if (type === "tv" && progress?.season && progress?.episode)
      router.push(`/watch/tv/${item.id}?s=${progress.season}&e=${progress.episode}`);
    else router.push(type === "tv" ? `/watch/tv/${item.id}?s=1&e=1` : `/watch/movie/${item.id}`);
  };

  /* ── hover → dwell → expanded 16:9 preview (mouse devices only) ── */
  const enter = () => {
    if (hoverRef.current) return; // ignore re-enters while scrolling across cards
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
          "group/card flex cursor-pointer flex-col rounded-md [contain:layout_style]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
          className
        )}
      >
        {/* image */}
        <div
          className={clsx(
            "relative overflow-hidden rounded-md bg-panel-2",
            poster ? "aspect-[2/3]" : "aspect-video"
          )}
        >
          {src ? (
            <img
              src={src}
              alt={titleOf(item)}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover no-drag"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-panel p-3 text-center text-xs font-semibold text-neutral-400">
              {titleOf(item)}
            </div>
          )}

          {/* top-10 rank */}
          {rank !== undefined && (
            <div
              className="absolute -left-2 bottom-0 z-10 flex select-none items-end leading-none font-black text-[6.5rem] text-black"
              style={{ WebkitTextStroke: "3px #737373", letterSpacing: "-0.08em" }}
            >
              {rank}
            </div>
          )}

          {/* poster rating badge */}
          {poster && (item.vote_average ?? 0) > 0 && (
            <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-400 transition group-hover/card:opacity-0">
              <StarIcon className="h-2.5 w-2.5" />
              {(item.vote_average ?? 0).toFixed(1)}
            </div>
          )}

          {/* continue-watching progress */}
          {progress && (
            <div className="absolute inset-x-2 bottom-1.5 z-10 h-[3px] rounded bg-white/30">
              <div
                className="h-full rounded bg-brand"
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

          {/* title strip for landscape cards (hidden on hover) */}
          {!poster && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] rounded-b-md bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-1.5 pt-6 transition-opacity duration-200 group-hover/card:opacity-0">
              <p className="truncate text-[12.5px] font-semibold text-neutral-100 drop-shadow">{titleOf(item)}</p>
            </div>
          )}

          {/* quick-hover overlay (before the expanded preview opens) */}
          <div className="pointer-events-none invisible absolute inset-0 z-20 flex flex-col justify-end rounded-md bg-gradient-to-t from-black/95 via-black/45 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover/card:visible group-hover/card:opacity-100 group-focus-within/card:visible group-focus-within/card:opacity-100">
            <div className="pointer-events-auto">
              <div className="mb-1.5 flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); play(); }}
                  aria-label="Play"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow transition hover:scale-110 hover:bg-neutral-300"
                >
                  <PlayIcon className="ml-0.5 h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleList({ id: item.id, type, title: titleOf(item), poster_path: item.poster_path, backdrop_path: item.backdrop_path, vote_average: item.vote_average, year: yearOf(item) });
                    setSaved(!saved);
                  }}
                  aria-label="My List"
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/50 text-white shadow transition hover:scale-110 hover:border-white"
                >
                  {saved ? <CheckIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
                </button>
                {onRemove && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    aria-label="Remove"
                    className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/50 text-white shadow transition hover:scale-110 hover:border-white"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
                <span className="ml-auto flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11.5px] font-bold text-amber-400">
                  <StarIcon className="h-3 w-3" />
                  {(item.vote_average ?? 0).toFixed(1)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <span className="font-bold text-emerald-500">{match}% Match</span>
                {yearOf(item) && <span className="text-neutral-300">{yearOf(item)}</span>}
                <span className="rounded border border-neutral-500 px-1 text-[9.5px] font-medium text-neutral-300">HD</span>
              </div>
            </div>
          </div>
        </div>

        {/* caption under portrait cards (always visible title + meta) */}
        {poster && (
          <div className="w-full px-0.5 pt-1.5">
            <p className="truncate text-[12px] font-semibold text-neutral-200">{titleOf(item)}</p>
            <p className="truncate text-[10.5px] text-neutral-500">
              {match > 0 && <span className="font-semibold text-emerald-600">{match}% Match</span>}
              {yearOf(item) && ` · ${yearOf(item)}`}
            </p>
          </div>
        )}
      </div>

      {/* ── expanded 16:9 preview with trailer (netflix-style) ── */}
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
