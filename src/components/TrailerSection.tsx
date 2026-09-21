"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { img } from "@/lib/tmdb";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  Film,
  ExternalLink,
  Sparkles,
  Clapperboard,
  Tv,
} from "lucide-react";

export interface TrailerVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official?: boolean;
  published_at?: string;
  size?: number;
}

interface TrailerSectionProps {
  title: string;
  mediaType: "movie" | "tv";
  id: number;
  initialVideos?: TrailerVideo[];
  backdropPath?: string | null;
  posterPath?: string | null;
}

/**
 * Smart algorithm to determine the best official trailer from TMDB videos
 */
function findOfficialTrailer(videos: TrailerVideo[]): TrailerVideo | null {
  if (!videos || videos.length === 0) return null;

  const yt = videos.filter((v) => v.site === "YouTube" && v.key);
  if (yt.length === 0) return null;

  // 1. Official Trailer with "Official Trailer" in name
  const officialNamed = yt.find(
    (v) => v.type === "Trailer" && v.official && /official\s+trailer/i.test(v.name)
  );
  if (officialNamed) return officialNamed;

  // 2. Official Trailer (official === true && type === "Trailer")
  const officialTrailer = yt.find((v) => v.type === "Trailer" && v.official);
  if (officialTrailer) return officialTrailer;

  // 3. Name contains "Official Trailer"
  const namedTrailer = yt.find(
    (v) => v.type === "Trailer" && /official\s+trailer/i.test(v.name)
  );
  if (namedTrailer) return namedTrailer;

  // 4. Any Trailer
  const anyTrailer = yt.find((v) => v.type === "Trailer");
  if (anyTrailer) return anyTrailer;

  // 5. Official Teaser
  const officialTeaser = yt.find((v) => v.type === "Teaser" && v.official);
  if (officialTeaser) return officialTeaser;

  // 6. Any Teaser
  const anyTeaser = yt.find((v) => v.type === "Teaser");
  if (anyTeaser) return anyTeaser;

  // 7. Any YouTube Clip
  const anyClip = yt.find((v) => v.type === "Clip");
  if (anyClip) return anyClip;

  // 8. First YouTube item
  return yt[0] || null;
}

export default function TrailerSection({
  title,
  mediaType,
  id,
  initialVideos,
  backdropPath,
  posterPath,
}: TrailerSectionProps) {
  const router = useRouter();

  // Fetch dedicated videos endpoint as well to ensure full trailer coverage
  const { data: dedicatedData } = useTmdbSnapshot<any>(
    id ? `${mediaType}/${id}/videos` : null
  );

  // Combine and deduplicate videos from both sources
  const allVideos = useMemo<TrailerVideo[]>(() => {
    const v1 = (initialVideos as TrailerVideo[]) ?? [];
    const v2 = (dedicatedData?.results as TrailerVideo[]) ?? [];
    const combined = [...v1, ...v2];
    const seen = new Set<string>();
    const list: TrailerVideo[] = [];

    for (const v of combined) {
      if (v && v.key && !seen.has(v.key) && v.site === "YouTube") {
        seen.add(v.key);
        list.push(v);
      }
    }
    return list;
  }, [initialVideos, dedicatedData]);

  // Determine official trailer
  const defaultTrailer = useMemo(() => findOfficialTrailer(allVideos), [allVideos]);

  // Active selected trailer
  const [activeVideo, setActiveVideo] = useState<TrailerVideo | null>(null);

  useEffect(() => {
    if (defaultTrailer && (!activeVideo || !allVideos.some((v) => v.key === activeVideo.key))) {
      setActiveVideo(defaultTrailer);
    }
  }, [defaultTrailer, allVideos, activeVideo]);

  // Video playback controls state
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isInView, setIsInView] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // PostMessage helper for YouTube Iframe API
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

  // IntersectionObserver to auto-play when in view, pause when scrolled away
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsInView(entry.isIntersecting);

        if (entry.isIntersecting) {
          postCommand("playVideo");
          setIsPlaying(true);
        } else {
          // Pause when user scrolls away to conserve resources
          postCommand("pauseVideo");
          setIsPlaying(false);
        }
      },
      { threshold: 0.25 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, [postCommand]);

  // Listen for custom trigger from Hero "Trailer" button
  useEffect(() => {
    const handleHeroTrigger = () => {
      setIsMuted(false);
      setHasInteracted(true);
      postCommand("unMute");
      postCommand("setVolume", [100]);
      postCommand("playVideo");
      setIsPlaying(true);
    };

    window.addEventListener("unmute-trailer-section", handleHeroTrigger);
    return () => window.removeEventListener("unmute-trailer-section", handleHeroTrigger);
  }, [postCommand]);

  // Handle Fullscreen change
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleMute = () => {
    setHasInteracted(true);
    if (isMuted) {
      postCommand("unMute");
      postCommand("setVolume", [100]);
      setIsMuted(false);
    } else {
      postCommand("mute");
      setIsMuted(true);
    }
  };

  const togglePlay = () => {
    setHasInteracted(true);
    if (isPlaying) {
      postCommand("pauseVideo");
      setIsPlaying(false);
    } else {
      postCommand("playVideo");
      setIsPlaying(true);
    }
  };

  const restartVideo = () => {
    setHasInteracted(true);
    postCommand("seekTo", [0, true]);
    postCommand("playVideo");
    setIsPlaying(true);
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback
    }
  };

  // If no videos available at all for this title
  if (!allVideos.length && !defaultTrailer) {
    return null;
  }

  const currentTrailer = activeVideo || defaultTrailer;
  if (!currentTrailer) return null;

  const backdrop = img(backdropPath, "w1280");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = `https://www.youtube.com/embed/${currentTrailer.key}?autoplay=1&mute=${isMuted ? 1 : 0}&enablejsapi=1&rel=0&playsinline=1&modestbranding=1&origin=${encodeURIComponent(origin)}`;

  return (
    <section
      id="official-trailer-section"
      ref={sectionRef}
      className="relative w-full border-t border-neutral-850/80 bg-gradient-to-b from-neutral-950 via-[#0d0d0d] to-ink px-[4vw] py-12 md:py-16"
      aria-label="Official Trailer Section"
    >
      <div className="mx-auto w-full max-w-[1400px]">
        {/* Section Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
              <Clapperboard className="h-4 w-4" />
              <span>Official TMDB Trailer</span>
              {currentTrailer.official && (
                <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                  Verified
                </span>
              )}
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl">
              Watch Official Trailer
            </h2>
            <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
              {currentTrailer.name || `${title} Trailer`}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() =>
                router.push(
                  mediaType === "tv"
                    ? `/watch/tv/${id}?s=1&e=1`
                    : `/watch/movie/${id}`
                )
              }
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white shadow-lg transition hover:bg-brand-dark"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{mediaType === "tv" ? "Watch Series" : "Watch Full Movie"}</span>
            </button>

            <a
              href={`https://www.youtube.com/watch?v=${currentTrailer.key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-xs font-semibold text-neutral-300 transition hover:border-neutral-700 hover:text-white"
              title="Open video on YouTube"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">YouTube</span>
            </a>
          </div>
        </div>

        {/* Ambient Glow + Video Player Frame */}
        <div className="relative mx-auto w-full max-w-5xl">
          {/* Subtle ambient backdrop reflection */}
          {backdrop && (
            <div
              className="pointer-events-none absolute -inset-2 -z-10 rounded-2xl opacity-20 blur-3xl transition-opacity duration-1000"
              style={{
                backgroundImage: `url(${backdrop})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          )}

          {/* Main 16:9 Video Container */}
          <div
            id="trailer-player-container"
            ref={containerRef}
            className="group relative aspect-video w-full overflow-hidden rounded-xl border border-neutral-800/80 bg-black shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
          >
            {/* YouTube Player Iframe */}
            <iframe
              id="tmdb-trailer-iframe"
              ref={iframeRef}
              src={embedUrl}
              title={`${title} - ${currentTrailer.name}`}
              className="h-full w-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />

            {/* Top Info Bar Badge */}
            <div className="pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-black/40 bg-black/60 px-3 py-1 text-xs font-semibold text-white shadow-md backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full ${
                      isPlaying ? "animate-ping bg-emerald-400 opacity-75" : "bg-neutral-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex h-2 w-2 rounded-full ${
                      isPlaying ? "bg-emerald-500" : "bg-neutral-500"
                    }`}
                  />
                </span>
                <span>{isPlaying ? "Auto-playing" : "Paused"}</span>
              </span>

              {currentTrailer.size && (
                <span className="hidden rounded-full border border-white/10 bg-black/50 px-2 py-0.5 text-[11px] font-bold text-neutral-300 backdrop-blur-md sm:inline-block">
                  {currentTrailer.size}p HD
                </span>
              )}
            </div>

            {/* Bottom Overlay Control Bar */}
            <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 sm:p-4 transition-opacity">
              {/* Left Controls: Sound & Playback */}
              <div className="flex items-center gap-2">
                {/* Prominent Unmute / Mute Button */}
                <button
                  id="trailer-unmute-btn"
                  onClick={toggleMute}
                  aria-label={isMuted ? "Unmute trailer" : "Mute trailer"}
                  className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-lg backdrop-blur-md transition ${
                    isMuted
                      ? "border border-brand/50 bg-brand/90 text-white hover:bg-brand animate-pulse"
                      : "border border-neutral-700 bg-neutral-900/80 text-neutral-200 hover:bg-neutral-800 hover:text-white"
                  }`}
                  title={isMuted ? "Click to unmute trailer audio" : "Mute trailer audio"}
                >
                  {isMuted ? (
                    <>
                      <VolumeX className="h-4 w-4" />
                      <span>Unmute Sound</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4 text-emerald-400" />
                      <span>Sound On</span>
                    </>
                  )}
                </button>

                {/* Play / Pause Button */}
                <button
                  id="trailer-play-pause-btn"
                  onClick={togglePlay}
                  aria-label={isPlaying ? "Pause trailer" : "Play trailer"}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-900/80 text-white shadow-md backdrop-blur-md transition hover:bg-neutral-800 hover:scale-105"
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                  )}
                </button>

                {/* Restart Button */}
                <button
                  id="trailer-restart-btn"
                  onClick={restartVideo}
                  aria-label="Restart trailer from beginning"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-900/80 text-neutral-300 shadow-md backdrop-blur-md transition hover:bg-neutral-800 hover:text-white"
                  title="Replay from start"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Right Controls: Fullscreen */}
              <div className="flex items-center gap-2">
                <button
                  id="trailer-fullscreen-btn"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-900/80 text-white shadow-md backdrop-blur-md transition hover:bg-neutral-800 hover:scale-105"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Multi-trailer Selection Carousel (if multiple trailers/clips exist) */}
        {allVideos.length > 1 && (
          <div className="mt-6 border-t border-neutral-850 pt-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                All Available Trailers & Clips ({allVideos.length})
              </span>
              <span className="text-xs text-neutral-500">Select any video to play</span>
            </div>

            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
              {allVideos.map((v) => {
                const isActive = v.key === currentTrailer.key;
                return (
                  <button
                    key={v.key}
                    id={`trailer-item-${v.key}`}
                    onClick={() => {
                      setActiveVideo(v);
                      setIsPlaying(true);
                      setHasInteracted(true);
                      postCommand("playVideo");
                    }}
                    className={`group relative flex w-44 shrink-0 flex-col overflow-hidden rounded-lg border text-left transition md:w-52 ${
                      isActive
                        ? "border-brand ring-1 ring-brand bg-neutral-900 shadow-md"
                        : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700 hover:bg-neutral-900"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-video w-full overflow-hidden bg-neutral-950">
                      <img
                        src={`https://img.youtube.com/vi/${v.key}/mqdefault.jpg`}
                        alt={v.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (target.src.includes("mqdefault.jpg")) {
                            target.src = `https://img.youtube.com/vi/${v.key}/hqdefault.jpg`;
                          } else if (target.src.includes("hqdefault.jpg")) {
                            target.src = `https://img.youtube.com/vi/${v.key}/default.jpg`;
                          }
                        }}
                      />
                      <div className="absolute inset-0 bg-black/30 transition group-hover:bg-black/10" />

                      {isActive ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <span className="rounded-full bg-brand p-1.5 text-white shadow">
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                          <span className="rounded-full bg-black/70 p-1.5 text-white shadow">
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </span>
                        </div>
                      )}

                      {/* Type Badge */}
                      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold text-neutral-200 backdrop-blur-sm">
                        {v.type || "Trailer"}
                      </span>

                      {v.official && (
                        <span className="absolute top-1.5 right-1.5 rounded bg-brand/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                          Official
                        </span>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="p-2">
                      <p className="line-clamp-2 text-xs font-semibold text-neutral-200 group-hover:text-white">
                        {v.name}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
