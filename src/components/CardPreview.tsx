"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { img, titleOf, yearOf, typeOf, type Media } from "@/lib/tmdb";
import { genreNames, MOVIE_GENRES } from "@/lib/rows";
import { toggleList, inList, type ProgressItem } from "@/lib/storage";
import { useTmdbSnapshot } from "./SWRProvider";
import { PlayIcon, PlusIcon, CheckIcon, StarIcon, ChevronIcon } from "./Icons";

/** Netflix-style expanded 16:9 preview card: springs out of the hovered
 *  card's rect (framer-motion FLIP-style expand), shows the backdrop, then
 *  plays the muted trailer after a short dwell. Rendered in a portal so it
 *  is never clipped by the row scroller. */
export default function CardPreview({
  item,
  anchor,
  progress,
  onClose,
  onEnter,
  onLeave,
}: {
  item: Media;
  anchor: DOMRect;
  progress?: ProgressItem;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [trailerOn, setTrailerOn] = useState(false);
  const [saved, setSaved] = useState(() => inList(item.id));
  const type = typeOf(item);

  useEffect(() => setMounted(true), []);

  /* geometry: 16:9 preview wider than the card, centered on it, clamped to
     the viewport (fixed positioning — rect is already viewport-based) */
  const geo = useMemo(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(anchor.width * 1.62, 280), 460, vw - 28);
    const videoH = (width * 9) / 16;
    const height = videoH + 96;
    const centerX = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(centerX - width / 2, 14), vw - width - 14);
    const top = Math.min(
      Math.max(anchor.top + anchor.height / 2 - height / 2, 74),
      vh - height - 14
    );
    return { left, top, width, videoH };
  }, [anchor]);

  /* trailer after a short dwell inside the expanded card */
  useEffect(() => {
    const t = setTimeout(() => setTrailerOn(true), 1000);
    return () => clearTimeout(t);
  }, []);

  const { data: vids } = useTmdbSnapshot<any>(trailerOn ? `${type}/${item.id}/videos` : null);
  const trailer = trailerOn
    ? (vids?.results ?? []).find((v: any) => v.site === "YouTube" && v.type === "Trailer") ??
      (vids?.results ?? []).find((v: any) => v.site === "YouTube")
    : null;

  /* close on scroll / resize / Esc — the anchor is stale the moment page moves */
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const backdrop = img(item.backdrop_path ?? item.poster_path, "w780");
  const match = Math.round((item.vote_average ?? 0) * 10);

  // clicking the preview (video included) → details page for that content
  const openDetails = () => router.push(`/title/${type}/${item.id}`);

  if (!mounted) return null;

  return createPortal(
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "fixed",
        left: geo.left,
        top: geo.top,
        width: geo.width,
        zIndex: 100,
        transformOrigin: "center",
      }}
      className="preview-in overflow-hidden rounded-lg bg-[#141414] shadow-[0_18px_55px_rgba(0,0,0,0.85)]"
    >
      {/* ── maximized 16:9 media area — click → details ── */}
      <div className="relative w-full cursor-pointer" style={{ height: geo.videoH }} onClick={openDetails}>
        {backdrop && <img src={backdrop} alt="" className="h-full w-full object-cover" draggable={false} />}
        {trailer && (
          <iframe
            src={`https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${trailer.key}&disablekb=1&iv_load_policy=3&fs=0`}
            title={`${titleOf(item)} preview`}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media"
            tabIndex={-1}
          />
        )}
        {/* transparent shield over the video: YouTube never sees hover/clicks,
            so its own controls (title bar, watch-later/share, progress bar)
            never appear — our clicks route to the details page instead */}
        {trailer && <div className="absolute inset-0 z-10 cursor-pointer" onClick={openDetails} aria-hidden />}
        {/* our title overlay — always visible, kept clean of player chrome */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-14 bg-gradient-to-t from-[#141414] to-transparent" />
        <div className="pointer-events-none absolute inset-x-2.5 bottom-1.5 z-20 flex items-end justify-between gap-2">
          <p className="truncate text-[14.5px] font-bold text-white drop-shadow">{titleOf(item)}</p>
          <span className="flex shrink-0 items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-amber-400">
            <StarIcon className="h-3 w-3" />
            {(item.vote_average ?? 0).toFixed(1)}
          </span>
        </div>
      </div>

      {/* ── info panel (always visible; only YouTube's own player chrome is blocked) ── */}
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={openDetails}
            aria-label="More info"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition hover:scale-110 hover:bg-neutral-300"
          >
            <PlayIcon className="ml-0.5 h-4 w-4" />
          </button>
          <button
            onClick={() => {
              toggleList({
                id: item.id, type, title: titleOf(item),
                poster_path: item.poster_path, backdrop_path: item.backdrop_path,
                vote_average: item.vote_average, year: yearOf(item),
              });
              setSaved(!saved);
            }}
            aria-label="My List"
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/40 text-white transition hover:scale-110 hover:border-white"
          >
            {saved ? <CheckIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => router.push(`/title/${type}/${item.id}`)}
            aria-label="More info"
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/40 text-white transition hover:scale-110 hover:border-white"
          >
            <ChevronIcon className="h-4 w-4" />
          </button>
          {progress?.season && (
            <span className="ml-auto rounded-full bg-brand/20 px-2 py-0.5 text-[10.5px] font-bold text-brand">
              Resume S{progress.season}:E{progress.episode}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
          <span className="font-bold text-emerald-500">{match}% Match</span>
          {yearOf(item) && <span className="text-neutral-300">{yearOf(item)}</span>}
          <span className="rounded border border-neutral-600 px-1 text-[9.5px] font-medium text-neutral-300">HD</span>
          <span className="text-neutral-500">{type === "tv" ? "Series" : "Film"}</span>
        </div>
        <div className="truncate text-[10.5px] text-neutral-400">
          {genreNames(item, MOVIE_GENRES).join(" • ")}
        </div>
      </div>
    </div>,
    document.body
  );
}
