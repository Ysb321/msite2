"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import {
  Play,
  Plus,
  Check,
  X,
  Volume2,
  VolumeX,
  Star,
  Clapperboard,
  Film,
  Tv,
  ChevronDown,
  Info,
  Calendar,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { img, titleOf, yearOf, bestLogo, type Media } from "@/lib/tmdb";
import { useMyList } from "@/context/MyListContext";
import { getProgress } from "@/lib/storage";
import TrailerSection from "@/components/TrailerSection";
import SmartImage from "@/components/SmartImage";

interface TitleDetailModalProps {
  type: "movie" | "tv";
  id: number;
  initialData?: any;
  onClose: () => void;
  onSelectTitle?: (type: "movie" | "tv", id: number, initialData?: any) => void;
}

const runtimeLabel = (m: any) => {
  if (m?.runtime) return `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m`;
  if (m?.episode_run_time?.length) return `${m.episode_run_time[0]}m/ep`;
  return "";
};

export default function TitleDetailModal({
  type,
  id,
  initialData,
  onClose,
  onSelectTitle,
}: TitleDetailModalProps) {
  const router = useRouter();
  const t = type === "tv" ? "tv" : "movie";
  const modalScrollRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // TMDB snapshot with credits, videos, similar, recommendations, images
  const key = `${t}/${id}?append_to_response=credits,videos,similar,recommendations,images&include_image_language=en,null`;
  const { data: fetchedData, isLoading } = useTmdbSnapshot<any>(key);

  // Combine fetched detail data with initialData so modal renders INSTANTLY (0ms)
  const d = fetchedData || initialData;

  const { inList, toggleList } = useMyList();
  const saved = inList(id);

  // TV Seasons & Episodes management
  const seasons = useMemo(
    () => (d?.seasons ?? []).filter((s: any) => s.season_number > 0 && s.episode_count > 0),
    [d]
  );
  const [selectedSeason, setSelectedSeason] = useState(1);

  // Set initial selected season from resume progress if available
  useEffect(() => {
    if (t === "tv" && d) {
      const savedProgress = getProgress().find((p) => p.id === id && p.type === "tv");
      if (savedProgress?.season) {
        setSelectedSeason(savedProgress.season);
      } else if (seasons.length > 0) {
        setSelectedSeason(seasons[0].season_number);
      }
    }
  }, [t, id, d, seasons]);

  // Fetch season data for TV show
  const seasonKey = t === "tv" && selectedSeason ? `tv/${id}/season/${selectedSeason}` : null;
  const { data: seasonData, isLoading: seasonLoading } = useTmdbSnapshot<any>(seasonKey);

  // Background trailer playback & sound controls
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "episodes" | "trailers" | "more">("overview");

  // Smart trailer selection (Official Trailer > Trailer > Teaser > YouTube)
  const trailer = useMemo(() => {
    const vids: any[] = d?.videos?.results ?? [];
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
      yt[0]
    );
  }, [d]);

  // Youtube postMessage control helper
  const postCommand = useCallback((func: string, args: any[] = []) => {
    if (iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: "command", func, args }),
          "*"
        );
      } catch {
        // Safe cross-origin handling
      }
    }
  }, []);

  const toggleMute = () => {
    if (isMuted) {
      postCommand("unMute");
      postCommand("setVolume", [100]);
      setIsMuted(false);
    } else {
      postCommand("mute");
      setIsMuted(true);
    }
  };

  // Delay video start slightly for clean fade-in
  useEffect(() => {
    setVideoReady(false);
    const timer = setTimeout(() => {
      setVideoReady(true);
    }, 700);
    return () => clearTimeout(timer);
  }, [id, type]);

  // Lock body scroll when modal is open
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Reset modal scroll on ID change
  useEffect(() => {
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  }, [id, type]);

  // Recommended & Similar titles
  const similar = useMemo(() => {
    const items = d?.recommendations?.results?.length
      ? d.recommendations.results
      : d?.similar?.results ?? [];
    return items
      .slice(0, 12)
      .map((i: any) => ({
        ...i,
        media_type: i.media_type ?? (i.first_air_date ? "tv" : "movie"),
      }));
  }, [d]);

  const backdrop = d ? img(d.backdrop_path, "w1280") : null;
  const logoPath = d ? bestLogo(d?.images) : null;
  const poster = d ? img(d.poster_path, "w500") : null;
  const title = d ? titleOf(d) : "";
  const match = d ? Math.round((d.vote_average ?? 0) * 10) : 85;

  const handlePlay = (seasonNum?: number, epNum?: number) => {
    onClose();
    if (t === "tv") {
      const s = seasonNum ?? selectedSeason ?? 1;
      const e = epNum ?? 1;
      router.push(`/watch/tv/${id}?s=${s}&e=${e}`);
    } else {
      router.push(`/watch/movie/${id}`);
    }
  };

  const handleToggleList = () => {
    if (!d) return;
    toggleList({
      id: Number(id),
      type: t as "movie" | "tv",
      title,
      poster_path: d.poster_path,
      backdrop_path: d.backdrop_path,
      vote_average: d.vote_average,
      year: yearOf(d),
    });
  };

  return (
    <div
      id="title-detail-modal-overlay"
      className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/80 backdrop-blur-md px-2 py-4 sm:px-4 sm:py-8 transition-opacity duration-200"
      onClick={onClose}
    >
      <div
        id="title-detail-modal-container"
        ref={modalScrollRef}
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto w-full max-w-4xl overflow-hidden rounded-xl bg-[#141414] text-white shadow-2xl ring-1 ring-white/10 transition-all"
      >
        {/* Floating Close Button */}
        <button
          id="title-modal-close-btn"
          onClick={onClose}
          aria-label="Close detail modal"
          className="group absolute right-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-[#181818]/90 text-white shadow-lg backdrop-blur-md transition-transform hover:scale-110 hover:bg-[#282828] active:scale-95"
        >
          <X className="h-5 w-5 text-neutral-300 transition-colors group-hover:text-white" />
        </button>

        {/* Hero Banner with Backdrop / Auto-playing Trailer */}
        <div className="relative aspect-[16/9] max-h-[480px] w-full overflow-hidden bg-neutral-900">
          <SmartImage
            src={backdrop}
            fallbackSrc={img(d?.poster_path, "w780")}
            alt={title}
            title={title}
            year={yearOf(d)}
            priority
            aspectRatio="backdrop"
            className="h-full w-full object-cover object-center"
          />

          {/* Muted background preview trailer */}
          {videoReady && trailer?.key && (
            <div
              className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
              aria-hidden="true"
            >
              <iframe
                ref={iframeRef}
                src={`https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${trailer.key}&disablekb=1&iv_load_policy=3&fs=0&enablejsapi=1`}
                title={`${title} preview`}
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[130%] h-[130%] max-w-none filter brightness-[0.9] contrast-[1.05]"
                allow="autoplay; encrypted-media"
                tabIndex={-1}
              />
            </div>
          )}

          {/* Vignette Gradients */}
          <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-[#141414] via-[#141414]/20 to-black/60" />
          <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-r from-[#141414]/90 via-transparent to-transparent" />

          {/* Hero Content Overlay */}
          <div className="absolute inset-x-0 bottom-4 z-30 px-6 sm:bottom-6 sm:px-10">
            <div className="max-w-xl">
              {logoPath ? (
                <img
                  src={img(logoPath, "w500") ?? undefined}
                  alt={title}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="mb-3 max-h-16 w-auto max-w-full object-contain drop-shadow-xl sm:max-h-24"
                />
              ) : (
                <h1 className="mb-2 font-display text-2xl font-black tracking-tight text-white drop-shadow-lg sm:text-4xl">
                  {title}
                </h1>
              )}

              {/* Action Buttons Row */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  id="title-modal-play-btn"
                  onClick={() => handlePlay()}
                  className="flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-bold text-black shadow-lg transition hover:bg-neutral-200 hover:scale-105 active:scale-95"
                >
                  <Play className="h-4 w-4 fill-current" /> Play
                </button>

                <button
                  id="title-modal-watchlist-btn"
                  onClick={handleToggleList}
                  aria-label={saved ? "Remove from My List" : "Add to My List"}
                  title={saved ? "Remove from My List" : "Add to My List"}
                  className={clsx(
                    "flex h-10 w-10 items-center justify-center rounded-full border shadow-md backdrop-blur-md transition hover:scale-110 active:scale-95",
                    saved
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-400/40"
                      : "border-white/40 bg-black/50 text-white hover:border-white hover:bg-white/20"
                  )}
                >
                  {saved ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                </button>

                {trailer && (
                  <button
                    id="title-modal-sound-btn"
                    onClick={toggleMute}
                    aria-label={isMuted ? "Unmute video" : "Mute video"}
                    title={isMuted ? "Unmute audio" : "Mute audio"}
                    className={clsx(
                      "flex h-10 w-10 items-center justify-center rounded-full border shadow-md backdrop-blur-md transition hover:scale-110 active:scale-95",
                      !isMuted
                        ? "border-amber-400 bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40"
                        : "border-white/40 bg-black/50 text-neutral-300 hover:border-white hover:text-white hover:bg-white/20"
                    )}
                  >
                    {isMuted ? (
                      <VolumeX className="h-4 w-4" />
                    ) : (
                      <Volume2 className="h-4 w-4 text-amber-300" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Body Info & Details */}
        <div className="px-6 py-6 sm:px-10 sm:py-8">
          {isLoading && !d ? (
            <div className="space-y-4 py-8">
              <div className="skeleton h-6 w-3/4" />
              <div className="skeleton h-20 w-full" />
              <div className="skeleton h-6 w-1/2" />
            </div>
          ) : !d ? (
            <div className="py-12 text-center text-neutral-400">
              Information for this title could not be loaded.
            </div>
          ) : (
            <div className="space-y-8">
              {/* Metadata Badges & Two-Column Overview */}
              <div className="grid gap-6 md:grid-cols-[2fr,1.1fr]">
                {/* Left Column: Storyline & Details */}
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold sm:text-sm">
                    <span className="text-emerald-400">{match}% Match</span>
                    <span className="text-neutral-500">•</span>
                    <span className="text-neutral-300">{yearOf(d)}</span>
                    <span className="text-neutral-500">•</span>
                    <span className="rounded border border-neutral-600 px-1.5 py-0.5 text-[10px] text-neutral-300">
                      U/A {d.adult ? "18+" : "16+"}
                    </span>
                    {runtimeLabel(d) && (
                      <>
                        <span className="text-neutral-500">•</span>
                        <span className="text-neutral-300">{runtimeLabel(d)}</span>
                      </>
                    )}
                    {t === "tv" && d.number_of_seasons && (
                      <>
                        <span className="text-neutral-500">•</span>
                        <span className="text-neutral-300">
                          {d.number_of_seasons} Season{d.number_of_seasons > 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-bold text-neutral-300 ring-1 ring-neutral-700">
                      4K Ultra HD
                    </span>
                  </div>

                  {d.tagline && (
                    <p className="text-xs italic text-neutral-400 sm:text-sm">
                      &ldquo;{d.tagline}&rdquo;
                    </p>
                  )}

                  <p className="text-sm leading-relaxed text-neutral-200 sm:text-[15px]">
                    {d.overview || "No synopsis available for this title."}
                  </p>
                </div>

                {/* Right Column: Cast, Genres, Attributes */}
                <div className="space-y-3 text-xs leading-relaxed text-neutral-400 sm:text-[13px]">
                  {(d.credits?.cast ?? []).length > 0 && (
                    <p>
                      <span className="text-neutral-500">Cast: </span>
                      {d.credits.cast
                        .slice(0, 4)
                        .map((c: any) => c.name)
                        .join(", ")}
                    </p>
                  )}

                  {(d.genres ?? []).length > 0 && (
                    <p>
                      <span className="text-neutral-500">Genres: </span>
                      {d.genres.map((g: any) => g.name).join(", ")}
                    </p>
                  )}

                  {d.original_language && (
                    <p>
                      <span className="text-neutral-500">Audio: </span>
                      {d.original_language.toUpperCase()} (Original), English [CC]
                    </p>
                  )}

                  {d.status && (
                    <p>
                      <span className="text-neutral-500">Status: </span>
                      <span className="text-neutral-300">{d.status}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* TV Episodes Section (if TV show) */}
              {t === "tv" && seasons.length > 0 && (
                <div className="border-t border-neutral-800 pt-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-white">Episodes</h2>
                    {seasons.length > 1 ? (
                      <div className="relative">
                        <select
                          value={selectedSeason}
                          onChange={(e) => setSelectedSeason(Number(e.target.value))}
                          className="appearance-none rounded-md border border-neutral-700 bg-neutral-900 px-4 py-1.5 pr-8 text-xs font-semibold text-white shadow transition focus:border-white focus:outline-none"
                        >
                          {seasons.map((s: any) => (
                            <option key={s.id} value={s.season_number}>
                              {s.name || `Season ${s.season_number}`} ({s.episode_count} eps)
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-400 font-medium">
                        {seasons[0]?.name || "Season 1"}
                      </span>
                    )}
                  </div>

                  {seasonLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((n) => (
                        <div key={n} className="skeleton h-20 w-full rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-800/80 rounded-lg border border-neutral-800 bg-neutral-900/40">
                      {(seasonData?.episodes ?? []).map((ep: any) => {
                        const epStill = img(ep.still_path, "w300");
                        return (
                          <div
                            key={ep.id}
                            onClick={() => handlePlay(selectedSeason, ep.episode_number)}
                            className="group flex cursor-pointer flex-col gap-3 p-3 transition hover:bg-neutral-800/60 sm:flex-row sm:items-center sm:gap-4 sm:p-4"
                          >
                            <span className="hidden w-5 text-center text-sm font-bold text-neutral-500 group-hover:text-white sm:block">
                              {ep.episode_number}
                            </span>
                            <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded bg-neutral-950 sm:w-36 md:w-44">
                              <SmartImage
                                src={epStill}
                                alt={ep.name || `Episode ${ep.episode_number}`}
                                title={ep.name}
                                aspectRatio="backdrop"
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-black shadow">
                                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                                </div>
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <h3 className="truncate text-xs font-bold text-white transition group-hover:text-amber-400 sm:text-sm">
                                  {ep.episode_number}. {ep.name}
                                </h3>
                                {ep.runtime && (
                                  <span className="shrink-0 text-[11px] text-neutral-400">
                                    {ep.runtime}m
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-400">
                                {ep.overview || "No episode summary available."}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Cast Carousel */}
              {(d.credits?.cast ?? []).length > 0 && (
                <div className="border-t border-neutral-800 pt-6">
                  <h2 className="mb-3 text-base font-bold text-white">Cast</h2>
                  <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
                    {d.credits.cast.slice(0, 10).map((c: any) => (
                      <Link
                        key={c.credit_id || c.id}
                        href={`/person/${c.id}`}
                        onClick={onClose}
                        className="group w-20 shrink-0 text-center transition hover:opacity-90"
                      >
                        <div className="mx-auto h-20 w-20 overflow-hidden rounded-full ring-1 ring-white/10 transition group-hover:ring-white/40 bg-neutral-800">
                          <SmartImage
                            src={img(c.profile_path, "w185")}
                            alt={c.name}
                            title={c.name}
                            aspectRatio="square"
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <p className="mt-2 truncate text-[11px] font-semibold text-neutral-200 group-hover:text-white">
                          {c.name}
                        </p>
                        <p className="truncate text-[10px] text-neutral-500">{c.character}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Official TMDB Trailer Player Section */}
              <div className="border-t border-neutral-800 pt-6">
                <TrailerSection
                  title={title}
                  mediaType={t}
                  id={Number(id)}
                  initialVideos={d?.videos?.results}
                  backdropPath={d?.backdrop_path}
                  posterPath={d?.poster_path}
                />
              </div>

              {/* More Like This (Similar Titles Grid) */}
              {similar.length > 0 && (
                <div className="border-t border-neutral-800 pt-6">
                  <h2 className="mb-4 text-base font-bold text-white">More Like This</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {similar.map((item: any) => {
                      const itemType = item.media_type || (item.first_air_date ? "tv" : "movie");
                      const itemPoster =
                        img(item.poster_path, "w342") || img(item.backdrop_path, "w500");
                      const itemTitle = titleOf(item);
                      const itemMatch = Math.round((item.vote_average ?? 0) * 10);

                      return (
                        <div
                          key={`sim-${item.id}`}
                          onClick={() => {
                            if (onSelectTitle) {
                              onSelectTitle(itemType, item.id);
                            }
                          }}
                          className="group relative cursor-pointer overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-white/10 transition-transform duration-200 hover:scale-[1.03] hover:ring-white/30"
                        >
                          <div className="aspect-[2/3] w-full overflow-hidden bg-neutral-950">
                            <SmartImage
                              src={itemPoster}
                              fallbackSrc={img(item.backdrop_path, "w300")}
                              alt={itemTitle}
                              title={itemTitle}
                              year={yearOf(item)}
                              aspectRatio="poster"
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          </div>
                          <div className="p-2.5">
                            <div className="flex items-center justify-between text-[11px] font-semibold">
                              <span className="text-emerald-400">{itemMatch}% Match</span>
                              <span className="text-neutral-400">{yearOf(item)}</span>
                            </div>
                            <p className="mt-1 truncate text-xs font-bold text-white">
                              {itemTitle}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Deep Metadata (About [Title]) */}
              <div className="border-t border-neutral-800 pt-6 text-xs text-neutral-400 space-y-2">
                <h3 className="text-sm font-bold text-white mb-2">About {title}</h3>
                {(d.created_by ?? []).length > 0 && (
                  <p>
                    <span className="text-neutral-500">Creators: </span>
                    {d.created_by.map((c: any) => c.name).join(", ")}
                  </p>
                )}
                {(d.production_companies ?? []).length > 0 && (
                  <p>
                    <span className="text-neutral-500">Studios: </span>
                    {d.production_companies.map((c: any) => c.name).join(", ")}
                  </p>
                )}
                <p>
                  <span className="text-neutral-500">Maturity Rating: </span>
                  Recommended for ages {d.adult ? "18+" : "16+"} and above.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
