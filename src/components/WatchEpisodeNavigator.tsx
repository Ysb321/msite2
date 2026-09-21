"use client";

import { useState, useMemo } from "react";
import clsx from "clsx";
import { img } from "@/lib/tmdb";
import { getResume, resumeKeyFor } from "@/lib/storage";
import SmartImage from "./SmartImage";
import {
  Play,
  CheckCircle2,
  Clock,
  Search,
  LayoutGrid,
  List,
  Sparkles,
  ChevronRight,
} from "lucide-react";

interface WatchEpisodeNavigatorProps {
  mediaId: string | number;
  seasons: any[];
  activeSeason: number;
  activeEpisode: number;
  seasonData: any;
  onSelectEpisode: (season: number, episode: number) => void;
}

export default function WatchEpisodeNavigator({
  mediaId,
  seasons,
  activeSeason,
  activeEpisode,
  seasonData,
  onSelectEpisode,
}: WatchEpisodeNavigatorProps) {
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [searchQuery, setSearchQuery] = useState("");

  const episodes = useMemo(() => {
    const list: any[] = seasonData?.episodes ?? [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (ep) =>
        ep.episode_number.toString() === q ||
        (ep.name && ep.name.toLowerCase().includes(q)) ||
        (ep.overview && ep.overview.toLowerCase().includes(q))
    );
  }, [seasonData, searchQuery]);

  return (
    <div className="rounded-2xl border border-white/10 bg-panel/60 p-4 sm:p-6 backdrop-blur-xl shadow-2xl">
      {/* Top Header: Title, View Switcher & Search */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/20 text-brand">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight sm:text-xl">
              Episodes & Seasons
            </h2>
            <p className="text-xs font-semibold text-neutral-400">
              Season {activeSeason} · {seasonData?.episodes?.length ?? 0} Episodes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Episode in Season */}
          <div className="relative flex-1 sm:w-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter episode..."
              className="w-full rounded-xl border border-white/10 bg-black/50 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/40"
            />
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-1">
            <button
              onClick={() => setViewMode("list")}
              title="List View"
              className={clsx(
                "rounded-lg p-1.5 transition cursor-pointer",
                viewMode === "list"
                  ? "bg-white/20 text-white shadow"
                  : "text-neutral-400 hover:text-white"
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              title="Quick Number Grid"
              className={clsx(
                "rounded-lg p-1.5 transition cursor-pointer",
                viewMode === "grid"
                  ? "bg-white/20 text-white shadow"
                  : "text-neutral-400 hover:text-white"
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Season Pill Selectors */}
      {seasons.length > 0 && (
        <div className="no-scrollbar mb-5 flex items-center gap-2 overflow-x-auto pb-1">
          {seasons.map((s: any) => {
            const isCurSeason = activeSeason === s.season_number;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setSearchQuery("");
                  onSelectEpisode(s.season_number, 1);
                }}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-extrabold transition-all duration-200 cursor-pointer",
                  isCurSeason
                    ? "bg-brand text-white shadow-[0_0_16px_rgba(229,9,20,0.4)] scale-105"
                    : "border border-white/10 bg-white/5 text-neutral-300 hover:border-white/30 hover:bg-white/10 hover:text-white"
                )}
              >
                <span>{s.name || `Season ${s.season_number}`}</span>
                {s.episode_count && (
                  <span
                    className={clsx(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-bold",
                      isCurSeason ? "bg-black/30 text-white" : "bg-white/10 text-neutral-400"
                    )}
                  >
                    {s.episode_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Episodes Rendering: List or Grid Mode */}
      {!seasonData ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 w-full rounded-2xl opacity-50" />
          ))}
        </div>
      ) : episodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-bold text-neutral-300">No episodes matched &ldquo;{searchQuery}&rdquo;</p>
          <button
            onClick={() => setSearchQuery("")}
            className="mt-2 text-xs font-semibold text-brand hover:underline cursor-pointer"
          >
            Clear filter
          </button>
        </div>
      ) : viewMode === "grid" ? (
        /* FAST NUMBERED GRID MODE */
        <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
          {episodes.map((ep: any) => {
            const isCurrent = ep.episode_number === activeEpisode;
            const epResume = getResume(
              resumeKeyFor("tv", mediaId, activeSeason, ep.episode_number)
            );
            const progressPercent =
              epResume?.positionSec && epResume.durationSec
                ? Math.round((epResume.positionSec / epResume.durationSec) * 100)
                : 0;
            const isFinished = progressPercent >= 90;

            return (
              <button
                key={ep.id}
                onClick={() => onSelectEpisode(activeSeason, ep.episode_number)}
                title={`Episode ${ep.episode_number}: ${ep.name || ""}`}
                className={clsx(
                  "group relative flex flex-col items-center justify-center rounded-xl border p-3 transition-all duration-200 cursor-pointer overflow-hidden",
                  isCurrent
                    ? "border-brand bg-brand/20 text-brand shadow-[0_0_16px_rgba(229,9,20,0.3)] ring-1 ring-brand scale-105"
                    : isFinished
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-400"
                    : "border-white/10 bg-white/5 text-neutral-300 hover:border-white/30 hover:bg-white/10 hover:text-white"
                )}
              >
                <span className="text-sm font-extrabold tracking-tight">
                  EP {ep.episode_number}
                </span>

                {isFinished && (
                  <CheckCircle2 className="mt-1 h-3 w-3 text-emerald-400" />
                )}

                {progressPercent > 0 && !isFinished && (
                  <div className="absolute inset-x-1 bottom-1 h-1 rounded-full bg-white/20 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        /* DETAILED LIST VIEW MODE */
        <div className="styled-scroll max-h-[70vh] divide-y divide-white/5 overflow-y-auto pr-1">
          {episodes.map((ep: any) => {
            const isCurrent = ep.episode_number === activeEpisode;
            const epResume = getResume(
              resumeKeyFor("tv", mediaId, activeSeason, ep.episode_number)
            );
            const progressPercent =
              epResume?.positionSec && epResume.durationSec
                ? Math.round((epResume.positionSec / epResume.durationSec) * 100)
                : 0;
            const isFinished = progressPercent >= 90;

            return (
              <button
                key={ep.id}
                onClick={() => onSelectEpisode(activeSeason, ep.episode_number)}
                className={clsx(
                  "group flex w-full items-start gap-4 rounded-2xl p-3 text-left transition-all duration-200 cursor-pointer",
                  isCurrent
                    ? "bg-white/10 ring-1 ring-brand/70 shadow-lg"
                    : "hover:bg-white/5"
                )}
              >
                {/* Episode Index */}
                <span
                  className={clsx(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold",
                    isCurrent
                      ? "bg-brand text-white shadow-md"
                      : "bg-white/5 text-neutral-400 group-hover:text-white"
                  )}
                >
                  {ep.episode_number}
                </span>

                {/* Episode Preview Thumbnail */}
                <div className="relative h-18 w-32 shrink-0 overflow-hidden rounded-xl bg-panel-2 ring-1 ring-white/10 md:h-20 md:w-36">
                  <SmartImage
                    src={img(ep.still_path, "w300")}
                    alt={ep.name || `Episode ${ep.episode_number}`}
                    title={ep.name}
                    aspectRatio="custom"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Play Overlay / Current Glow */}
                  {isCurrent ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white shadow-lg animate-pulse">
                        <Play className="ml-0.5 h-4 w-4 fill-current" />
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black shadow">
                        <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                      </div>
                    </div>
                  )}

                  {/* Progress Bar inside Thumbnail */}
                  {progressPercent > 0 && (
                    <div className="absolute inset-x-1.5 bottom-1.5 h-1 rounded-full bg-black/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand shadow-[0_0_6px_rgba(229,9,20,0.8)]"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Episode Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3
                      className={clsx(
                        "truncate text-sm font-extrabold tracking-tight",
                        isCurrent
                          ? "text-brand"
                          : "text-white group-hover:text-neutral-200"
                      )}
                    >
                      {ep.name || `Episode ${ep.episode_number}`}
                    </h3>

                    <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400">
                      {ep.runtime ? (
                        <span className="flex items-center gap-1 text-[11px]">
                          <Clock className="h-3 w-3" />
                          {ep.runtime}m
                        </span>
                      ) : null}
                      {isFinished ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Watched
                        </span>
                      ) : progressPercent > 0 ? (
                        <span className="text-[11px] font-bold text-amber-400">
                          {progressPercent}%
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-400">
                    {ep.overview || "No episode description available."}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
