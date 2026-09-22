"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTmdbSnapshot } from "./SWRProvider";
import { img, titleOf, yearOf, preloadImages, prefetchTitleDetails, type Media } from "@/lib/tmdb";
import { MOVIE_GENRES } from "@/lib/rows";
import { useMyList } from "@/context/MyListContext";
import { useTitleModal } from "@/context/TitleModalContext";
import clsx from "clsx";
import {
  Play,
  Info,
  Plus,
  Check,
  Star,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  Pause,
  Sparkles,
  Flame,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";

const ROTATE_MS = 9000;

export default function HeroBillboard({ heroes }: { heroes: Media[] }) {
  const router = useRouter();
  const { inList, toggleList } = useMyList();
  const { openTitleModal } = useTitleModal();

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [progressKey, setProgressKey] = useState(0);

  const list = useMemo(() => heroes.slice(0, 6), [heroes]);
  const active = list[idx] || list[0];
  const saved = active ? inList(active.id) : false;

  // Preload next hero backdrop images to guarantee instantaneous slides
  useEffect(() => {
    if (!list.length) return;
    const urls = list
      .map((h) => img(h.backdrop_path ?? h.poster_path, "original"))
      .filter(Boolean) as string[];
    preloadImages(urls);
  }, [list]);

  const activeMediaType =
    ((active as any)?.media_type as "movie" | "tv") ||
    (active?.first_air_date ? "tv" : "movie");

  // Active hero details & videos
  const { data: details } = useTmdbSnapshot<{
    runtime?: number;
    genres?: { id: number; name: string }[];
    images?: any;
    videos?: { results: any[] };
  }>(
    active
      ? `${activeMediaType}/${active.id}?append_to_response=images,videos&include_image_language=en,null`
      : null
  );

  // Fallback dedicated videos endpoint if append_to_response returns empty videos
  const { data: fallbackVideos } = useTmdbSnapshot<{ results: any[] }>(
    active && (!details?.videos?.results || details.videos.results.length === 0)
      ? `${activeMediaType}/${active.id}/videos`
      : null
  );

  // Smart trailer selection (Official Trailer > Trailer > Teaser > YouTube clip)
  const trailer = useMemo(() => {
    const vids: any[] = [
      ...(details?.videos?.results ?? []),
      ...(fallbackVideos?.results ?? []),
    ];
    if (!vids.length) return null;
    const yt = vids.filter((v) => v.site === "YouTube" && v.key);
    if (!yt.length) return null;

    return (
      yt.find((v) => v.type === "Trailer" && v.official && /official\s+trailer/i.test(v.name)) ??
      yt.find((v) => v.type === "Trailer" && v.official) ??
      yt.find((v) => v.type === "Trailer" && /trailer/i.test(v.name)) ??
      yt.find((v) => v.type === "Trailer") ??
      yt.find((v) => v.type === "Teaser" && v.official) ??
      yt.find((v) => v.type === "Teaser") ??
      yt.find((v) => /trailer/i.test(v.name)) ??
      yt[0]
    );
  }, [details, fallbackVideos]);

  // Background video playback state
  const [videoReady, setVideoReady] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const heroRef = useRef<HTMLElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // YouTube postMessage API helper for zero-reload audio toggling & scroll pause
  const postCommand = useCallback((func: string, args: any[] = []) => {
    if (iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: "command", func, args }),
          "*"
        );
      } catch {
        // cross-origin restriction safeguard
      }
    }
  }, []);

  // Delay background video slightly on slide switch so transition is seamless and smooth
  useEffect(() => {
    setVideoReady(false);
    const timer = setTimeout(() => {
      setVideoReady(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [idx, active?.id]);

  // Pause video when user scrolls down away from the hero billboard
  useEffect(() => {
    if (!heroRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const inView = entry.isIntersecting;
        setIsVisible(inView);
        if (inView) {
          postCommand("playVideo");
        } else {
          postCommand("pauseVideo");
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(heroRef.current);
    return () => observer.disconnect();
  }, [postCommand]);

  // Pause background video when full trailer modal is open
  useEffect(() => {
    if (trailerOpen) {
      postCommand("pauseVideo");
    } else if (isVisible && videoReady) {
      postCommand("playVideo");
    }
  }, [trailerOpen, isVisible, videoReady, postCommand]);

  // Sound toggle handler
  const toggleMute = useCallback(() => {
    if (isMuted) {
      postCommand("unMute");
      postCommand("setVolume", [100]);
      setIsMuted(false);
    } else {
      postCommand("mute");
      setIsMuted(true);
    }
  }, [isMuted, postCommand]);

  // Auto-rotation timer (extended when a trailer is available so user can enjoy the background scene)
  const rotateDuration = trailer ? 18000 : ROTATE_MS;

  const nextSlide = useCallback(() => {
    setIdx((i) => (i + 1) % list.length);
    setProgressKey((k) => k + 1);
  }, [list.length]);

  const prevSlide = useCallback(() => {
    setIdx((i) => (i - 1 + list.length) % list.length);
    setProgressKey((k) => k + 1);
  }, [list.length]);

  const goToSlide = useCallback((targetIdx: number) => {
    setIdx(targetIdx);
    setProgressKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (paused || list.length < 2) return;
    const timer = setInterval(nextSlide, rotateDuration);
    return () => clearInterval(timer);
  }, [paused, list.length, nextSlide, progressKey, rotateDuration]);

  if (!active) return null;

  const logo = img(details?.images?.logos?.[0]?.file_path, "w500");
  const genres = (
    details?.genres ??
    (active.genre_ids ?? []).map((id) => ({ id, name: MOVIE_GENRES[id] })).filter(Boolean)
  ) as { id: number; name: string }[];

  return (
    <section
      id="hero-billboard"
      ref={heroRef}
      className="group/hero relative h-[86vh] min-h-[540px] max-h-[920px] w-full select-none overflow-hidden bg-ink"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Featured Billboard"
    >
      {/* Stacked Crossfading Backdrops for Zero-Flicker Transitions */}
      {list.map((item, i) => {
        const isCurrent = i === idx;
        const bgUrl = img(item.backdrop_path ?? item.poster_path, "w1280");
        return (
          <div
            key={`hero-bg-${item.id}`}
            className={clsx(
              "absolute inset-0 transition-all duration-1000 ease-out",
              isCurrent
                ? "opacity-100 scale-100 z-0"
                : "opacity-0 scale-105 pointer-events-none -z-10"
            )}
          >
            {bgUrl && (
              <img
                src={bgUrl}
                alt=""
                referrerPolicy="no-referrer"
                fetchPriority={i === 0 ? "high" : "low"}
                loading={i < 2 ? "eager" : "lazy"}
                className="h-full w-full object-cover object-top filter brightness-[0.92] contrast-[1.05]"
                draggable={false}
                onError={(e) => {
                  e.preventDefault();
                  const target = e.currentTarget;
                  if (target.src && target.src.includes("image.tmdb.org")) {
                    target.src = target.src.replace("image.tmdb.org", "images.tmdb.org");
                  } else {
                    target.onerror = null;
                  }
                }}
              />
            )}
          </div>
        );
      })}

      {/* Auto-playing Muted Background Trailer (No Controls Visible, Cropped to Fill) */}
      {videoReady && trailer?.key && isVisible && !trailerOpen && (
        <div
          key={`hero-bg-trailer-${active.id}-${trailer.key}`}
          className="pointer-events-none absolute inset-0 z-[1] overflow-hidden select-none transition-opacity duration-1000 ease-out opacity-100"
          aria-hidden="true"
        >
          <iframe
            ref={iframeRef}
            src={`https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${trailer.key}&disablekb=1&iv_load_policy=3&fs=0&enablejsapi=1`}
            title={`${titleOf(active)} background trailer`}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[130vw] h-[73.125vw] min-w-[235vh] min-h-[135vh] max-w-none filter brightness-[0.88] contrast-[1.04]"
            allow="autoplay; encrypted-media"
            tabIndex={-1}
          />
        </div>
      )}

      {/* Cinematic Multi-Layer Gradient Vignettes */}
      {/* Top subtle navbar shadow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/85 via-black/40 to-transparent z-10" />

      {/* Left heavy gradient for text contrast */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[80%] max-w-3xl bg-gradient-to-r from-ink via-ink/80 via-60% to-transparent z-10" />

      {/* Bottom fade into content feed */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-ink via-ink/85 via-50% to-transparent z-10" />

      {/* Left/Right Manual Navigation Arrows */}
      <button
        id="hero-prev-btn"
        aria-label="Previous featured title"
        onClick={prevSlide}
        className="absolute left-3 top-1/2 z-30 hidden -translate-y-1/2 rounded-full border border-white/10 bg-black/40 p-2 text-white/80 opacity-0 backdrop-blur-md transition hover:scale-110 hover:bg-black/70 hover:text-white group-hover/hero:opacity-100 md:flex"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>

      <button
        id="hero-next-btn"
        aria-label="Next featured title"
        onClick={nextSlide}
        className="absolute right-3 top-1/2 z-30 hidden -translate-y-1/2 rounded-full border border-white/10 bg-black/40 p-2 text-white/80 opacity-0 backdrop-blur-md transition hover:scale-110 hover:bg-black/70 hover:text-white group-hover/hero:opacity-100 md:flex"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      {/* Main Hero Content Block */}
      <div className="absolute inset-x-0 bottom-[15%] z-20 px-[4vw]">
        <div key={`hero-info-${active.id}`} className="anim-fade-in max-w-[42rem]">
          {/* Top Tagline Badge */}
          <div className="mb-3 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-amber-400 shadow-sm backdrop-blur-md">
              <Flame className="h-3.5 w-3.5 fill-amber-400" />
              <span>#1 in India Today</span>
            </span>

            <span className="hidden rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-bold tracking-wider text-neutral-300 backdrop-blur-md sm:inline-block">
              4K ULTRA HD
            </span>

            <span className="hidden rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-bold tracking-wider text-neutral-300 backdrop-blur-md md:inline-block">
              DOLBY VISION
            </span>
          </div>

          {/* Logo or Large Display Title */}
          {logo ? (
            <img
              src={logo}
              alt={titleOf(active)}
              referrerPolicy="no-referrer"
              className="mb-4 max-h-16 max-w-[85%] object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.8)] sm:max-h-24 md:max-h-32"
              draggable={false}
            />
          ) : (
            <h1 className="font-display mb-4 text-[34px] leading-[1.05] tracking-wide text-white drop-shadow-[0_8px_20px_rgba(0,0,0,0.9)] sm:text-5xl md:text-6xl lg:text-7xl">
              {titleOf(active)}
            </h1>
          )}

          {/* Metadata Row */}
          <div className="mb-3 flex flex-wrap items-center gap-2.5 text-[13.5px] font-medium text-neutral-200">
            <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 font-bold text-amber-400 ring-1 ring-amber-500/40">
              <Star className="h-3.5 w-3.5 fill-amber-400" />
              {(active.vote_average ?? 0).toFixed(1)}
            </span>

            <span className="text-neutral-500">•</span>
            <span className="font-semibold text-neutral-300">{yearOf(active)}</span>

            {details?.runtime ? (
              <>
                <span className="text-neutral-500">•</span>
                <span className="text-neutral-300">
                  {Math.floor(details.runtime / 60)}h {details.runtime % 60}m
                </span>
              </>
            ) : null}

            <span className="text-neutral-500">•</span>
            <span className="rounded border border-neutral-600 bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-neutral-300">
              U/A 16+
            </span>
          </div>

          {/* Synopsis */}
          <p className="mb-4 line-clamp-3 max-w-[34rem] text-[14.5px] leading-relaxed text-neutral-200 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] md:text-[15.5px]">
            {active.overview}
          </p>

          {/* Genre Badges */}
          {genres.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {genres.slice(0, 3).map((g) => (
                <span
                  key={g.id}
                  className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] font-semibold text-neutral-200 backdrop-blur-md"
                >
                  {g.name}
                </span>
              ))}
            </div>
          )}

          {/* Modern Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              id="hero-play-btn"
              onClick={() =>
                router.push(
                  activeMediaType === "tv"
                    ? `/watch/tv/${active.id}?s=1&e=1`
                    : `/watch/movie/${active.id}`
                )
              }
              className="flex items-center gap-2.5 rounded-xl bg-white px-8 py-3.5 text-[15px] font-extrabold text-black shadow-[0_4px_24px_rgba(255,255,255,0.25)] transition hover:bg-neutral-200 hover:scale-[1.03] active:scale-95 cursor-pointer"
            >
              <Play className="h-5 w-5 fill-current" /> Play Now
            </button>

            {trailer && (
              <button
                id="hero-trailer-btn"
                onClick={() => setTrailerOpen(true)}
                className="flex items-center gap-2 rounded-xl border border-white/25 bg-black/60 px-6 py-3.5 text-[15px] font-bold text-white shadow-lg backdrop-blur-xl transition hover:border-white/50 hover:bg-white/15 hover:scale-[1.03] active:scale-95 cursor-pointer"
              >
                <Clapperboard className="h-5 w-5 text-amber-400" /> Trailer
              </button>
            )}

            <button
              id="hero-more-info-btn"
              onMouseEnter={() => prefetchTitleDetails(activeMediaType, active.id)}
              onClick={() => openTitleModal(activeMediaType, active.id, active)}
              className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/15 px-6 py-3.5 text-[15px] font-bold text-white shadow-lg backdrop-blur-xl transition hover:bg-white/25 hover:scale-[1.03] active:scale-95 cursor-pointer"
            >
              <Info className="h-5 w-5" /> More Info
            </button>

            <button
              id="hero-my-list-btn"
              onClick={() => {
                toggleList({
                  id: active.id,
                  type: activeMediaType,
                  title: titleOf(active),
                  poster_path: active.poster_path,
                  backdrop_path: active.backdrop_path,
                  vote_average: active.vote_average,
                  year: yearOf(active),
                });
              }}
              aria-label={saved ? "Remove from My List" : "Add to My List"}
              title={saved ? "Remove from My List" : "Add to My List"}
              className={clsx(
                "flex h-12 w-12 items-center justify-center rounded-xl border shadow-lg backdrop-blur-xl transition hover:scale-110 active:scale-95 cursor-pointer",
                saved
                  ? "border-emerald-400 bg-emerald-500/20 text-emerald-400"
                  : "border-white/25 bg-black/60 text-white hover:border-white hover:bg-white/20"
              )}
            >
              {saved ? <Check className="h-5 w-5 text-emerald-400" /> : <Plus className="h-5 w-5" />}
            </button>

            {trailer && (
              <button
                id="hero-sound-toggle-btn"
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute trailer video" : "Mute trailer video"}
                title={isMuted ? "Unmute trailer audio" : "Mute trailer audio"}
                className={clsx(
                  "flex h-12 w-12 items-center justify-center rounded-xl border shadow-lg backdrop-blur-xl transition hover:scale-110 active:scale-95 cursor-pointer",
                  !isMuted
                    ? "border-amber-400 bg-amber-500/25 text-amber-300 ring-1 ring-amber-400/40"
                    : "border-white/25 bg-black/60 text-white hover:border-white hover:bg-white/20"
                )}
              >
                {isMuted ? (
                  <VolumeX className="h-5 w-5 text-neutral-300" />
                ) : (
                  <Volume2 className="h-5 w-5 text-amber-300 animate-pulse" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Right: Interactive Hero Thumbnails / Slide Selector */}
      {list.length > 1 && (
        <div className="absolute bottom-[10%] right-[4vw] z-20 flex flex-col items-end gap-2.5">
          {/* Mini-Thumbnail Strip (Desktop) */}
          <div className="hidden lg:flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 p-1.5 shadow-2xl backdrop-blur-lg">
            {list.map((h, i) => {
              const isCurrent = i === idx;
              const thumb = img(h.backdrop_path ?? h.poster_path, "w300");
              return (
                <button
                  key={`thumb-${h.id}`}
                  onClick={() => goToSlide(i)}
                  className={clsx(
                    "group relative h-12 w-20 overflow-hidden rounded-md transition-all",
                    isCurrent
                      ? "ring-2 ring-brand scale-105 shadow-lg"
                      : "opacity-60 hover:opacity-100 hover:scale-100"
                  )}
                  title={titleOf(h)}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={titleOf(h)}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.preventDefault();
                        const target = e.currentTarget;
                        if (target.src && target.src.includes("image.tmdb.org")) {
                          target.src = target.src.replace("image.tmdb.org", "images.tmdb.org");
                        } else {
                          target.onerror = null;
                        }
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-[10px] text-neutral-400">
                      {titleOf(h)}
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-brand" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Animated Progress Bars + Pause Toggle (Mobile/Tablet + Desktop) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume auto-rotation" : "Pause auto-rotation"}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/50 text-neutral-300 backdrop-blur-sm transition hover:text-white"
              title={paused ? "Resume rotation" : "Pause rotation"}
            >
              {paused ? <Play className="h-3 w-3 fill-current" /> : <Pause className="h-3 w-3" />}
            </button>

            {trailer && (
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute trailer audio" : "Mute trailer audio"}
                title={isMuted ? "Unmute audio" : "Mute audio"}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/50 text-neutral-300 backdrop-blur-sm transition hover:text-white hover:scale-105"
              >
                {isMuted ? (
                  <VolumeX className="h-3 w-3" />
                ) : (
                  <Volume2 className="h-3 w-3 text-amber-300" />
                )}
              </button>
            )}

            <div className="flex gap-1.5">
              {list.map((h, i) => {
                const isCurrent = i === idx;
                return (
                  <button
                    key={`progress-bar-${h.id}`}
                    aria-label={`Go to ${titleOf(h)}`}
                    onClick={() => goToSlide(i)}
                    className="relative h-1.5 w-7 overflow-hidden rounded-full bg-white/30 transition hover:bg-white/50"
                  >
                    {isCurrent && (
                      <span
                        key={`hero-timer-${progressKey}`}
                        style={{
                          animationDuration: `${rotateDuration}ms`,
                          animationPlayState: paused ? "paused" : "running",
                        }}
                        className="hero-progress-fill absolute inset-0 rounded-full bg-brand"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <span className="border-l border-white/20 py-0.5 pl-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-300">
              {idx + 1} / {list.length}
            </span>
          </div>
        </div>
      )}

      {/* Trailer Modal Overlay */}
      {trailerOpen && trailer && (
        <div
          className="anim-fade-in fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setTrailerOpen(false)}
        >
          <div
            className="modal-in relative w-[min(92vw,960px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-neutral-200">
                {titleOf(active)} — Official Trailer
              </span>
              <button
                onClick={() => setTrailerOpen(false)}
                aria-label="Close trailer"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
              >
                <span>Close</span>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/15">
              <iframe
                src={`https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0`}
                title={`${titleOf(active)} trailer`}
                className="h-full w-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
