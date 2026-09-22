"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import Navbar from "@/components/Navbar";
import Row from "@/components/Row";
import SetupNotice from "@/components/SetupNotice";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { img, titleOf, yearOf, bestLogo, kidsSafeItem } from "@/lib/tmdb";
import {
  embedUrl,
  getProvider,
  PROVIDERS,
  parsePlayerEvent,
  fmtTime,
  PLAYER_SANDBOX,
  slugify,
} from "@/lib/player";
import { scrollToEl } from "@/lib/scroll";
import { findAniListId, findAnimeIds } from "@/lib/anilist";
import VlcSources from "@/components/VlcSources";
import { openInVlc, generateVlcProtocolUrl, playableInBrowser } from "@/lib/vlc";
import HindiSources from "@/components/HindiSources";
import AutoSources from "@/components/AutoSources";
import DdlSources from "@/components/DdlSources";
import LicensedAnimeSources from "@/components/LicensedAnimeSources";
import PreFetchVideoValidator from "@/components/PreFetchVideoValidator";
import WatchEpisodeNavigator from "@/components/WatchEpisodeNavigator";
import WatchServerSelector from "@/components/WatchServerSelector";
import {
  saveProgress,
  updateProgressPosition,
  getResume,
  saveResume,
  clearResume,
  resumeKeyFor,
  isKidsActive,
} from "@/lib/storage";
import { useMyList } from "@/context/MyListContext";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Plus,
  Check,
  Star,
  RotateCcw,
  Maximize2,
  Minimize2,
  Tv,
  Film,
  FastForward,
  Rewind,
  Share2,
  ExternalLink,
  Sparkles,
  Clock,
  Calendar,
  Layers,
  HelpCircle,
  Keyboard,
  Info,
} from "lucide-react";

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ink" />}>
      <WatchContent />
    </Suspense>
  );
}

function WatchContent() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const t = type === "tv" ? "tv" : "movie";
  const [season, setSeason] = useState(Number(sp.get("s") ?? 1) || 1);
  const [episode, setEpisode] = useState(Number(sp.get("e") ?? 1) || 1);

  useEffect(() => {
    if (t === "tv") {
      const sVal = Number(sp.get("s") ?? 1) || 1;
      const eVal = Number(sp.get("e") ?? 1) || 1;
      setSeason(sVal);
      setEpisode(eVal);
    }
  }, [sp, t]);
  const [theaterMode, setTheaterMode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  /* Default server engine */
  const [serverId, setServerId] = useState("netout");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setServerId(() => {
      try {
        return localStorage.getItem("yetflix:server2") || "netout";
      } catch {
        return "netout";
      }
    });
  }, []);

  const switchServer = (sid: string) => {
    setServerId(sid);
    try {
      localStorage.setItem("yetflix:server2", sid);
    } catch {}
  };

  const playerRef = useRef<HTMLDivElement>(null);
  const lastTime = useRef<{ time: number; duration?: number } | null>(null);
  const lastSaved = useRef(0);

  const { data: d, error } = useTmdbSnapshot<any>(
    `${t}/${id}?append_to_response=credits,recommendations,similar,images,external_ids&include_image_language=en,null`
  );
  const { data: seasonData } = useTmdbSnapshot<any>(
    t === "tv" ? `tv/${id}/season/${season}` : null
  );
  const logoPath = bestLogo(d?.images);
  const kidsBlocked = !!d && isKidsActive() && !kidsSafeItem(d);

  /* Anime detection */
  const isAnime = useMemo(
    () =>
      !!d &&
      (d.genres ?? []).some((g: any) => g.id === 16) &&
      ["ja", "zh", "ko"].includes(d.original_language ?? ""),
    [d]
  );
  const providers = useMemo(
    () => PROVIDERS.filter((p) => !p.animeOnly || isAnime),
    [isAnime]
  );
  const activeId = providers.some((p) => p.id === serverId)
    ? serverId
    : providers[0]?.id ?? serverId;
  const provider = getProvider(activeId);

  /* Sub-players for Server 8 (MultiMovies) */
  const [subPlayerId, setSubPlayerId] = useState<string | null>(null);
  const [subOrDub, setSubOrDub] = useState<"sub" | "dub">("sub");
  useEffect(() => {
    setSubPlayerId(null);
  }, [serverId, t]);

  const subPlayers = useMemo(
    () =>
      (provider.players ?? []).filter((subP) =>
        t === "movie" ? !!subP.movie : !subP.movieOnly && !!subP.tv
      ),
    [provider, t]
  );
  const subPlayer =
    subPlayers.find((subP) => subP.id === subPlayerId) ?? subPlayers[0] ?? null;

  const effSandbox =
    subPlayer?.sandbox !== undefined ? subPlayer.sandbox : provider.sandbox;
  const effDenyPopups = subPlayer?.denyPopups ?? provider.denyPopups;
  const effNoScroll = subPlayer?.noScroll ?? provider.noScroll;
  const effDenyFullscreen =
    subPlayer?.denyFullscreen ?? provider.denyFullscreen;
  const effNoReferrer = subPlayer?.noReferrer ?? provider.noReferrer;
  const embedId: string = provider.prefersImdb
    ? d?.external_ids?.imdb_id || (id as string)
    : (id as string);

  const title = d ? titleOf(d) : "Loading…";
  const slug =
    slugify(titleOf(d)) ||
    slugify(d?.original_title || d?.original_name || "") ||
    String(id);

  const currentSrc = (startAt?: number) => {
    const sourceId = subPlayer?.slugTitle
      ? slug
      : provider.usesTitle
        ? title
        : embedId;
    return subPlayer
      ? t === "movie"
        ? subPlayer.movie(sourceId)
        : subPlayer.tv(sourceId, season, episode)
      : embedUrl(provider, t, sourceId, { s: season, e: episode, startAt });
  };

  const seasons = useMemo(
    () =>
      (d?.seasons ?? []).filter(
        (s: any) => s.season_number > 0 && s.episode_count > 0
      ),
    [d]
  );

  const totalEpisodesInSeason = seasonData?.episodes?.length ?? 0;
  const hasNextEpisode = t === "tv" && episode < totalEpisodesInSeason;
  const hasPrevEpisode = t === "tv" && episode > 1;

  /* Resume state */
  const [embed, setEmbed] = useState<{ src: string; resumedFrom?: number } | null>(
    null
  );

  useEffect(() => {
    if (provider.vlcOnly) {
      setEmbed(null);
      return;
    }
    let cancelled = false;

    if (provider.id === "megaplay") {
      const showTitle =
        d?.name || d?.title || d?.original_name || d?.original_title;
      if (!showTitle) {
        setEmbed(null);
        return;
      }
      setEmbed(null);
      const targetSeason = t === "tv" ? season : 1;
      const curSeason = d?.seasons?.find(
        (s: any) => s.season_number === targetSeason
      );
      const yearStr =
        curSeason?.air_date || d?.first_air_date || d?.release_date;
      const releaseYear = yearStr ? new Date(yearStr).getFullYear() : undefined;
      const tmdbId = Number(id) || undefined;

      findAnimeIds({
        name: showTitle,
        originalName: d?.original_name || d?.original_title,
        year: releaseYear,
        season: targetSeason,
        tmdbId,
      }).then((ids) => {
        if (cancelled) return;
        const ep = t === "tv" ? episode : 1;
        const src = ids.anilistId
          ? `https://megaplay.buzz/stream/ani/${ids.anilistId}/${ep}/${subOrDub}`
          : ids.malId
          ? `https://megaplay.buzz/stream/mal/${ids.malId}/${ep}/${subOrDub}`
          : "";
        setEmbed(src ? { src } : { src: "" });
      });
      return () => {
        cancelled = true;
      };
    }

    if (provider.id === "filmu" && t === "tv") {
      const showTitle =
        d?.name || d?.title || d?.original_name || d?.original_title;
      const genres = d?.genres?.map((g: any) => g.name.toLowerCase()) || [];
      const isAnimeContent =
        genres.includes("animation") ||
        genres.includes("anime") ||
        (showTitle && showTitle.toLowerCase().includes("anime"));
      if (isAnimeContent && showTitle) {
        setEmbed(null);
        const curSeason = d?.seasons?.find(
          (s: any) => s.season_number === season
        );
        const yearStr =
          curSeason?.air_date || d?.first_air_date || d?.release_date;
        const releaseYear = yearStr ? new Date(yearStr).getFullYear() : undefined;
        findAniListId({
          name: showTitle,
          originalName: d?.original_name || d?.original_title,
          year: releaseYear,
          season,
          tmdbId: Number(id) || undefined,
        }).then((aniId) => {
          if (cancelled) return;
          setEmbed(
            aniId
              ? { src: `https://embed.filmu.in/anime/${aniId}/${season}/${episode}` }
              : { src: "" }
          );
        });
        return () => {
          cancelled = true;
        };
      }
    }

    if ((subPlayer?.slugTitle || provider.usesTitle) && !d) {
      setEmbed(null);
      return;
    }

    const rkey = resumeKeyFor(t, id, season, episode);
    const saved = getResume(rkey);
    const resume =
      saved &&
      saved.positionSec > 10 &&
      (!saved.durationSec || saved.positionSec < saved.durationSec * 0.97)
        ? Math.floor(saved.positionSec)
        : undefined;

    const src = currentSrc(resume);
    setEmbed({ src, resumedFrom: resume });
    lastSaved.current = resume ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    t,
    id,
    season,
    episode,
    provider.id,
    embedId,
    d,
    activeId,
    subPlayer?.id,
    subOrDub,
  ]);

  const startOver = () => {
    clearResume(resumeKeyFor(t, id, season, episode));
    lastTime.current = null;
    lastSaved.current = 0;
    setEmbed({ src: currentSrc() });
  };

  /* Position sync */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const pt = parsePlayerEvent(e);
      if (!pt) return;
      const rkey = resumeKeyFor(t, id, season, episode);
      if (pt.ended) {
        clearResume(rkey);
        updateProgressPosition(
          (p) => p.id === Number(id) && p.type === t,
          { positionSec: 0 }
        );
        lastTime.current = null;
        return;
      }
      lastTime.current = { time: pt.time, duration: pt.duration };
      if (pt.time - lastSaved.current >= 5) {
        lastSaved.current = pt.time;
        saveResume(rkey, pt.time, pt.duration);
        updateProgressPosition((p) => p.id === Number(id) && p.type === t, {
          positionSec: pt.time,
          durationSec: pt.duration ?? undefined,
          season: t === "tv" ? season : undefined,
          episode: t === "tv" ? episode : undefined,
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      const lt = lastTime.current;
      if (lt && lt.time > 5) {
        const rkey = resumeKeyFor(t, id, season, episode);
        const dur = lt.duration ?? getResume(rkey)?.durationSec;
        if (!dur || lt.time < dur * 0.97) saveResume(rkey, lt.time, dur);
        else clearResume(rkey);
      }
    };
  }, [t, id, season, episode]);

  /* Progress saving */
  useEffect(() => {
    if (!d) return;
    const rkey = resumeKeyFor(t, id, season, episode);
    const saved = getResume(rkey);
    saveProgress({
      id: Number(id),
      type: t as "movie" | "tv",
      title: titleOf(d),
      poster_path: d.poster_path,
      backdrop_path: d.backdrop_path,
      vote_average: d.vote_average,
      year: yearOf(d),
      season: t === "tv" ? season : undefined,
      episode: t === "tv" ? episode : undefined,
      episodeCount: seasonData?.episodes?.length,
      positionSec: saved?.positionSec,
      durationSec: saved?.durationSec,
    });
  }, [d, id, t, season, episode, seasonData]);

  const goEpisode = useCallback((s: number, e: number) => {
    setSeason(s);
    setEpisode(e);
    router.replace(`/watch/tv/${id}?s=${s}&e=${e}`);
    scrollToEl(playerRef.current);
  }, [router, id]);

  const goNextEpisode = useCallback(() => {
    if (hasNextEpisode) {
      goEpisode(season, episode + 1);
    } else {
      // Check if there's a next season
      const curIndex = seasons.findIndex((s) => s.season_number === season);
      if (curIndex !== -1 && curIndex < seasons.length - 1) {
        goEpisode(seasons[curIndex + 1].season_number, 1);
      }
    }
  }, [hasNextEpisode, goEpisode, season, episode, seasons]);

  const goPrevEpisode = useCallback(() => {
    if (hasPrevEpisode) {
      goEpisode(season, episode - 1);
    }
  }, [hasPrevEpisode, goEpisode, season, episode]);

  /* Keyboard Shortcuts */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "n" || e.key === "N") {
        if (t === "tv") goNextEpisode();
      } else if (e.key === "p" || e.key === "P") {
        if (t === "tv") goPrevEpisode();
      } else if (e.key === "r" || e.key === "R") {
        setReloadKey((k) => k + 1);
      } else if (e.key === "t" || e.key === "T") {
        setTheaterMode((prev) => !prev);
      } else if (e.key === "?") {
        setShowShortcutsHelp((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [t, goNextEpisode, goPrevEpisode]);

  const handleCopyShare = () => {
    try {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {}
  };

  const similar = useMemo(() => {
    const items = d?.recommendations?.results?.length
      ? d.recommendations.results
      : d?.similar?.results ?? [];
    return items.map((i: any) => ({
      ...i,
      media_type: i.media_type ?? (i.first_air_date ? "tv" : "movie"),
    }));
  }, [d]);

  const { inList, toggleList } = useMyList();
  const saved = inList(Number(id));

  const currentEpisodeData = useMemo(() => {
    if (t !== "tv" || !seasonData?.episodes) return null;
    return seasonData.episodes.find((ep: any) => ep.episode_number === episode);
  }, [t, seasonData, episode]);

  return (
    <main className="min-h-screen bg-ink pb-16">
      <Navbar />

      {/* Ambient Backdrop Glow Layer */}
      {d?.backdrop_path && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-25">
          <img
            src={img(d.backdrop_path, "w1280") ?? ""}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover blur-3xl scale-125"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/80 to-transparent" />
        </div>
      )}

      <div
        ref={playerRef}
        className={clsx(
          "relative z-10 mx-auto w-full scroll-mt-16 px-[2.5vw] pt-20 transition-all duration-300 md:pt-24",
          theaterMode ? "max-w-full px-2" : "max-w-[1540px]"
        )}
      >
        {/* Navigation Breadcrumbs & Top Meta */}
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/title/${t}/${id}`}
              className="group flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-neutral-300 backdrop-blur-md transition-all hover:border-white/30 hover:bg-white/15 hover:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              <span>Back to Overview</span>
            </Link>

            <span className="text-neutral-600">/</span>

            <div className="flex items-center gap-2">
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-brand">
                {t === "tv" ? "TV Series" : "Movie"}
              </span>

              {d && (
                <span className="hidden items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[11px] font-bold text-neutral-400 sm:flex">
                  <Calendar className="h-3 w-3" />
                  {yearOf(d)}
                </span>
              )}
            </div>
          </div>

          {/* Quick Action Buttons (My List, Theater, Share, Shortcuts) */}
          <div className="flex items-center gap-2">
            {/* Theater Mode Toggle */}
            <button
              onClick={() => setTheaterMode((prev) => !prev)}
              title={theaterMode ? "Exit Theater Mode (T)" : "Theater Mode (T)"}
              className={clsx(
                "hidden sm:flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer",
                theaterMode
                  ? "border-amber-400/50 bg-amber-400/20 text-amber-300"
                  : "border-white/10 bg-white/5 text-neutral-300 hover:border-white/30 hover:bg-white/15 hover:text-white"
              )}
            >
              {theaterMode ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
              <span>{theaterMode ? "Standard View" : "Theater Mode"}</span>
            </button>

            {/* Share Link */}
            <button
              onClick={handleCopyShare}
              title="Copy stream link"
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-neutral-300 transition-all hover:border-white/30 hover:bg-white/15 hover:text-white cursor-pointer"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>{copiedLink ? "Copied!" : "Share"}</span>
            </button>

            {/* Add to My List */}
            <button
              onClick={() => {
                if (!d) return;
                toggleList({
                  id: Number(id),
                  type: t as "movie" | "tv",
                  title: titleOf(d),
                  poster_path: d.poster_path,
                  backdrop_path: d.backdrop_path,
                  vote_average: d.vote_average,
                  year: yearOf(d),
                });
              }}
              title={saved ? "Remove from My List" : "Add to My List"}
              className={clsx(
                "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer",
                saved
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                  : "border-white/10 bg-white/5 text-neutral-300 hover:border-white/30 hover:bg-white/15 hover:text-white"
              )}
            >
              {saved ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{saved ? "In List" : "My List"}</span>
            </button>

            {/* Keyboard Shortcuts Helper */}
            <button
              onClick={() => setShowShortcutsHelp((prev) => !prev)}
              title="Keyboard Shortcuts (?)"
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-neutral-400 transition hover:border-white/30 hover:bg-white/15 hover:text-white cursor-pointer"
            >
              <Keyboard className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Title Header with Logo / Badges */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2.5 text-xl font-black tracking-tight text-white sm:text-2xl md:text-3xl">
              {logoPath ? (
                <img
                  src={img(logoPath, "w500") ?? undefined}
                  alt={title}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="inline-block max-h-10 w-auto max-w-full object-contain align-middle sm:max-h-12 md:max-h-14"
                />
              ) : (
                title
              )}

              {t === "tv" && (
                <span className="rounded-xl border border-brand/30 bg-brand/15 px-3 py-1 text-xs font-extrabold text-brand shadow-sm">
                  S{season}:E{episode}
                  {currentEpisodeData?.name ? ` — ${currentEpisodeData.name}` : ""}
                </span>
              )}
            </h1>

            {embed?.resumedFrom ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-brand/20 px-3 py-1 font-bold text-brand shadow">
                  Resumed at {fmtTime(embed.resumedFrom)}
                </span>
                <button
                  onClick={startOver}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-neutral-400 transition hover:bg-white/15 hover:text-white cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" /> Start over from 0:00
                </button>
              </div>
            ) : null}
          </div>

          {d && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-extrabold text-amber-400">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                <span>{(d.vote_average ?? 0).toFixed(1)} TMDB</span>
              </div>
            </div>
          )}
        </div>

        {/* ── VIDEO PLAYER STAGE ── */}
        <div
          className={clsx(
            "relative w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/15 shadow-[0_12px_48px_rgba(0,0,0,0.8)] transition-all duration-300",
            theaterMode
              ? "aspect-video max-h-[88vh]"
              : "aspect-video max-h-[78vh]"
          )}
        >
          {kidsBlocked ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="text-5xl">🧒</span>
              <p className="text-xl font-extrabold text-white">
                Not Available in Kids Profile
              </p>
              <p className="max-w-sm text-xs font-medium text-neutral-400">
                This title is locked under child safety settings. Switch to standard profile with PIN to stream.
              </p>
            </div>
          ) : provider.vlcOnly ? (
            provider.id === "netmirror" ? (
              <HindiSources
                key={`nm-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                season={season}
                episode={episode}
              />
            ) : provider.id === "castle" ? (
              <HindiSources
                key={`cs-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                season={season}
                episode={episode}
                endpoint="/api/castle/stream"
                laneTitle="🏰 Castle · Hindi"
                resumeSuffix="site-cs"
                hideSiteLink
                loadLines={[
                  "Contacting Castle sources…",
                  "Searching Hindi + OST tracks…",
                  "Still searching — the source is slow right now…",
                  "Almost there — signing the stream urls…",
                ]}
                emptyHint="Castle covers Hindi and Hindi-dubbed titles — try a Server above, or check back later."
              />
            ) : provider.id === "moviesmod" ? (
              <HindiSources
                key={`mm-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                season={season}
                episode={episode}
                endpoint="/api/moviesmod/stream"
                laneTitle="🎭 MoviesMod · Hindi Dubbed"
                resumeSuffix="site-mm"
                hideSiteLink
                loadLines={[
                  "Contacting MoviesMod sources…",
                  "Searching Hindi-dubbed WEB-DL posts…",
                  "Still searching — resolving the file links…",
                  "Almost there — validating the streams…",
                ]}
                emptyHint="MoviesMod covers Hindi and Hindi-dubbed titles — try a Server above, or check back later."
              />
            ) : provider.id === "autoplay" ? (
              <AutoSources
                key={`ap-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                imdbId={d?.external_ids?.imdb_id ?? null}
                season={season}
                episode={episode}
              />
            ) : provider.id === "nuvio" ? (
              <HindiSources
                key={`nv-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                season={season}
                episode={episode}
                endpoint="/api/nuvio/stream"
                laneTitle="Nuvio - Hindi"
                resumeSuffix="site-nv"
                hideSiteLink
                loadLines={[
                  "Contacting Nuvio sources...",
                  "Searching XDMovies + HindMoviez...",
                  "Still searching - resolving the file links...",
                  "Almost there - validating the streams...",
                ]}
                emptyHint="Nuvio covers Hindi and Hindi-dubbed titles - try a Server above, or check back later."
              />
            ) : provider.id === "hicine" ? (
              <HindiSources
                key={`hc-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                otTitle={d?.original_title || d?.original_name || ""}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                season={season}
                episode={episode}
                endpoint="/api/hicine/stream"
                laneTitle="⚡ HiCine · FSL, FSLv2, PixelServer & Cloud"
                resumeSuffix="site-hc"
                hideSiteLink
                modal
                loadLines={[
                  "Contacting HiCine sources (hicine.sbs)…",
                  "Searching FSL, FSLv2, PixelServer & Pixeldrain fast streams…",
                  "Resolving 4K / 1080p / 720p / 480p packages…",
                  "Almost there — signing stream urls…",
                ]}
                emptyHint="HiCine covers Hindi, South Indian & Web Series — try another server, or check back later."
              />
            ) : provider.id === "hindmovie" ? (
              <HindiSources
                key={`hm-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                otTitle={d?.original_title || d?.original_name || ""}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                season={season}
                episode={episode}
                endpoint="/api/hindmovie/stream"
                laneTitle="⚡ HindMovie · GDirect & HCloud"
                resumeSuffix="site-hm"
                hideSiteLink
                modal
                loadLines={[
                  "Contacting HindMovie sources…",
                  "Fetching Google Direct & HCloud fast streams…",
                  "Resolving 1080p / 720p / 480p packages…",
                  "Almost there — validating stream urls…",
                ]}
                emptyHint="HindMovie covers Hindi and Hindi-dubbed releases — try another server, or check back later."
              />
            ) : provider.id === "m2box" ? (
              <HindiSources
                key={`m2-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                otTitle={d?.original_title || d?.original_name || ""}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                season={season}
                episode={episode}
                endpoint="/api/hindmovie/stream"
                laneTitle="⚡ HindMovie · GDirect & Cloud Streams"
                resumeSuffix="site-m2"
                hideSiteLink
                modal
                loadLines={[
                  "Contacting HindMovie sources...",
                  "Fetching Google Direct & HCloud fast streams...",
                  "Resolving 1080p / 720p / 480p packages...",
                  "Almost there - validating stream urls...",
                ]}
                emptyHint="HindMovie covers Hindi and Hindi-dubbed releases — try another server, or check back later."
              />
            ) : provider.id === "hdhub" ? (
              <HindiSources
                key={`hd-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={`tmdb:${id}`}
                title={title}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                imdbId={d?.external_ids?.imdb_id ?? null}
                season={season}
                episode={episode}
                endpoint="/api/hdhub/stream"
                laneTitle="🏰 HDHub + WebStreamr · All Formats"
                resumeSuffix="site-hd"
                hideSiteLink
                modal
                loadLines={[
                  "Contacting HDHub + WebStreamr sources...",
                  "Searching FSLv2, Pixeldrain, HubDrive, HubCloud...",
                  "Fetching direct download links...",
                  "Almost there - validating stream formats...",
                ]}
                emptyHint="Combined HDHub + WebStreamr sources — try another server."
              />
            ) : provider.id === "licensedanime" ? (
              <LicensedAnimeSources
                key={`la-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                altTitle={d?.original_name || d?.original_title || undefined}
                season={season}
                episode={episode}
              />
            ) : provider.id === "desiddl" ? (
              <DdlSources
                key={`dd-${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                title={title}
                year={(d?.release_date || d?.first_air_date || "").slice(0, 4)}
                imdbId={d?.external_ids?.imdb_id ?? null}
                season={season}
                episode={episode}
              />
            ) : (
              <VlcSources
                key={`${t}-${id}-${season}-${episode}`}
                type={t}
                tmdbId={String(id)}
                imdbId={d?.external_ids?.imdb_id ?? null}
                season={season}
                episode={episode}
                providerId={provider.id}
              />
            )
          ) : embed ? (
            embed.src ? (
              (playableInBrowser(embed.src) ||
              /\.(m3u8|mpd|mp4|mkv|webm|m4v)(\?|#|$)/i.test(embed.src) ||
              /pixeldrain|pixelserver|cloudflarestorage|r2\.dev|workers\.dev|googleusercontent/i.test(
                embed.src
              ) ||
              embed.src.includes("/api/stream/proxy")) && !/embed/i.test(embed.src) ? (
                <PreFetchVideoValidator
                  key={`${t}-${id}-${season}-${episode}-${embed.src}-${reloadKey}`}
                  url={embed.src}
                  title={title}
                  startAt={embed.resumedFrom ?? 0}
                  onSwitchServer={() => {
                    switchServer(serverId === "netout" ? "vidzee" : "netout");
                  }}
                  onTimeupdate={(time, duration) => {
                    const rkey = resumeKeyFor(t, id, season, episode);
                    if (time - lastSaved.current >= 5) {
                      lastSaved.current = time;
                      saveResume(rkey, time, duration);
                      updateProgressPosition(
                        (p) => p.id === Number(id) && p.type === t,
                        {
                          positionSec: time,
                          durationSec: duration,
                          season: t === "tv" ? season : undefined,
                          episode: t === "tv" ? episode : undefined,
                        }
                      );
                    }
                  }}
                  onEnded={() => {
                    const rkey = resumeKeyFor(t, id, season, episode);
                    clearResume(rkey);
                    updateProgressPosition(
                      (p) => p.id === Number(id) && p.type === t,
                      { positionSec: 0 }
                    );
                    lastTime.current = null;
                  }}
                />
              ) : (
                <iframe
                  key={`${t}-${id}-${season}-${episode}-${embed.src}-${reloadKey}`}
                  src={embed.src}
                  title={title}
                  className="h-full w-full border-0"
                  allow={
                    provider.id === "megaplay"
                      ? "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; pointer-lock"
                      : `autoplay; encrypted-media; ${
                          effDenyFullscreen ? "" : "fullscreen; "
                        }picture-in-picture; accelerometer${
                          effDenyPopups ? "; popups 'none'" : ""
                        }${effSandbox === false ? "; pointer-lock" : ""}`
                  }
                  {...(effSandbox !== false && {
                    sandbox: effSandbox || PLAYER_SANDBOX,
                  })}
                  scrolling={
                    effNoScroll || provider.id === "megaplay" ? "no" : undefined
                  }
                  allowFullScreen={!effDenyFullscreen}
                  referrerPolicy={effNoReferrer ? "no-referrer" : "origin"}
                />
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="text-5xl">🌸</span>
                <p className="text-base font-extrabold text-white">
                  Couldn&rsquo;t match this title in this anime source
                </p>
                <p className="text-xs text-neutral-400">
                  Try switching to another server below.
                </p>
              </div>
            )
          ) : (
            <div className="skeleton h-full w-full rounded-none opacity-50" />
          )}
        </div>

        {/* ── BINGE-WATCHING QUICK CONTROL BAR (FOR TV SERIES) ── */}
        {t === "tv" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-white/10 bg-panel/70 p-3 backdrop-blur-xl shadow-lg">
            {/* Prev Episode */}
            <button
              onClick={goPrevEpisode}
              disabled={!hasPrevEpisode}
              className={clsx(
                "flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-extrabold transition-all cursor-pointer",
                hasPrevEpisode
                  ? "border border-white/15 bg-white/5 text-white hover:border-white/30 hover:bg-white/15 active:scale-95 shadow"
                  : "border border-white/5 bg-white/5 text-neutral-600 cursor-not-allowed opacity-40"
              )}
            >
              <Rewind className="h-4 w-4" />
              <span>Previous Episode</span>
              <kbd className="hidden rounded bg-black/40 px-1 py-0.5 text-[9px] font-mono text-neutral-400 sm:inline">
                P
              </kbd>
            </button>

            {/* Current Episode Indicator */}
            <div className="flex items-center gap-2 text-center">
              <span className="text-xs font-bold text-neutral-400">
                Playing:
              </span>
              <span className="rounded-lg bg-brand/20 px-2.5 py-1 text-xs font-extrabold text-brand">
                Season {season} · Episode {episode}
              </span>
              {totalEpisodesInSeason > 0 && (
                <span className="text-xs font-semibold text-neutral-500">
                  of {totalEpisodesInSeason}
                </span>
              )}
            </div>

            {/* Next Episode */}
            <button
              onClick={goNextEpisode}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-5 py-2 text-xs font-extrabold text-white shadow-[0_0_16px_rgba(229,9,20,0.4)] transition-all hover:bg-brand-dark hover:scale-[1.03] active:scale-95 cursor-pointer"
            >
              <span>Next Episode</span>
              <FastForward className="h-4 w-4 fill-current" />
              <kbd className="hidden rounded bg-black/30 px-1.5 py-0.5 text-[9px] font-mono text-white/80 sm:inline">
                N
              </kbd>
            </button>
          </div>
        )}

        {/* ── KEYBOARD SHORTCUTS HINT OVERLAY ── */}
        {showShortcutsHelp && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand/30 bg-brand/10 p-3.5 text-xs text-neutral-300 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-brand" />
              <span className="font-extrabold text-white">
                Player Keyboard Controls:
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold">
              <span>
                <kbd className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-white">
                  N
                </kbd>{" "}
                Next Episode
              </span>
              <span>
                <kbd className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-white">
                  P
                </kbd>{" "}
                Previous Episode
              </span>
              <span>
                <kbd className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-white">
                  T
                </kbd>{" "}
                Theater Mode
              </span>
              <span>
                <kbd className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-white">
                  R
                </kbd>{" "}
                Reload Stream
              </span>
            </div>
            <button
              onClick={() => setShowShortcutsHelp(false)}
              className="text-neutral-400 hover:text-white font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── SERVERS & SOURCES HUB ── */}
        {!kidsBlocked && (
          <div className="mt-4">
            <WatchServerSelector
              providers={providers}
              activeServerId={activeId}
              onSelectServer={switchServer}
              subPlayers={subPlayers}
              activeSubPlayerId={subPlayerId}
              onSelectSubPlayer={setSubPlayerId}
              subOrDub={subOrDub}
              onSelectSubOrDub={setSubOrDub}
              onReload={() => setReloadKey((k) => k + 1)}
              isAnime={isAnime}
            />
          </div>
        )}

        {!d && error && (
          <div className="mt-6">
            <SetupNotice error={error} />
          </div>
        )}

        {/* ── TV EPISODES NAVIGATOR ── */}
        {t === "tv" && seasons.length > 0 && (
          <div className="mt-6">
            <WatchEpisodeNavigator
              mediaId={id}
              seasons={seasons}
              activeSeason={season}
              activeEpisode={episode}
              seasonData={seasonData}
              onSelectEpisode={goEpisode}
            />
          </div>
        )}

        {/* ── MEDIA OVERVIEW & CAST DETAILS ── */}
        {d && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-panel/40 p-5 sm:p-6 backdrop-blur-xl">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-brand" />
              <h2 className="text-base font-extrabold text-white">About & Cast</h2>
            </div>

            <p className="text-sm leading-relaxed text-neutral-300">
              {d.overview || "No plot summary available."}
            </p>

            {/* Cast Badges / Avatars */}
            {(d.credits?.cast ?? []).length > 0 && (
              <div className="mt-5 border-t border-white/10 pt-4">
                <span className="block text-xs font-extrabold uppercase tracking-wider text-neutral-400 mb-2.5">
                  Top Cast
                </span>
                <div className="flex flex-wrap gap-2">
                  {d.credits.cast.slice(0, 8).map((c: any) => (
                    <Link
                      key={c.id}
                      href={`/person/${c.id}`}
                      className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-neutral-300 transition-all hover:border-white/30 hover:bg-white/15 hover:text-white"
                    >
                      {c.profile_path ? (
                        <img
                          src={img(c.profile_path, "w185") ?? ""}
                          alt={c.name}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[9px]">
                          👤
                        </div>
                      )}
                      <span>{c.name}</span>
                      {c.character && (
                        <span className="text-[11px] text-neutral-500 group-hover:text-neutral-400">
                          as {c.character}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── RECOMMENDATIONS ROW ── */}
      {similar.length > 0 && (
        <div className="mt-12">
          <Row title="More Like This" items={similar} />
        </div>
      )}
    </main>
  );
}
