"use client";

import { useState, useMemo } from "react";
import clsx from "clsx";
import type { EmbedProvider, EmbedSubPlayer } from "@/lib/player";
import {
  Server,
  Zap,
  Volume2,
  ExternalLink,
  RotateCw,
  Sparkles,
  Layers,
  Radio,
  Tv,
  Globe,
} from "lucide-react";

interface WatchServerSelectorProps {
  providers: EmbedProvider[];
  activeServerId: string;
  onSelectServer: (id: string) => void;
  subPlayers: EmbedSubPlayer[];
  activeSubPlayerId: string | null;
  onSelectSubPlayer: (id: string) => void;
  subOrDub: "sub" | "dub";
  onSelectSubOrDub: (mode: "sub" | "dub") => void;
  onReload: () => void;
  isAnime?: boolean;
}

type ServerCategory = "all" | "fast" | "hindi" | "anime" | "direct";

const HINDI_SERVERS = new Set([
  "hicine",
  "hindmovie",
  "m2box",
  "hdhub",
  "netmirror",
  "castle",
  "moviesmod",
  "nuvio",
  "twombed",
  "videm",
  "desiddl",
  "speedostream",
  "rozgarlelo",
  "rivestream",
  "streamaggregator",
]);

const ANIME_SERVERS = new Set([
  "megaplay",
  "streamflizo",
  "licensedanime",
]);

const DIRECT_SERVERS = new Set([
  "vlc",
  "autoplay",
  "desiddl",
]);

export default function WatchServerSelector({
  providers,
  activeServerId,
  onSelectServer,
  subPlayers,
  activeSubPlayerId,
  onSelectSubPlayer,
  subOrDub,
  onSelectSubOrDub,
  onReload,
  isAnime,
}: WatchServerSelectorProps) {
  const [activeCategory, setActiveCategory] = useState<ServerCategory>("all");
  const [isReloading, setIsReloading] = useState(false);

  const filteredProviders = useMemo(() => {
    if (activeCategory === "all") return providers;
    if (activeCategory === "hindi") {
      return providers.filter((p) => HINDI_SERVERS.has(p.id));
    }
    if (activeCategory === "anime") {
      return providers.filter((p) => ANIME_SERVERS.has(p.id) || p.animeOnly);
    }
    if (activeCategory === "direct") {
      return providers.filter((p) => DIRECT_SERVERS.has(p.id) || p.vlcOnly);
    }
    if (activeCategory === "fast") {
      return providers.filter(
        (p) =>
          !HINDI_SERVERS.has(p.id) &&
          !ANIME_SERVERS.has(p.id) &&
          !DIRECT_SERVERS.has(p.id)
      );
    }
    return providers;
  }, [providers, activeCategory]);

  const handleReload = () => {
    setIsReloading(true);
    onReload();
    setTimeout(() => setIsReloading(false), 600);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-panel/60 p-4 sm:p-5 backdrop-blur-xl shadow-xl">
      {/* Top Title & Category Filter Tabs */}
      <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
            <Server className="h-4 w-4" />
          </div>
          <span className="text-sm font-extrabold text-white tracking-tight">
            Stream Servers & Sources
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-neutral-400">
            {providers.length} available
          </span>
        </div>

        {/* Server Category Chips */}
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            onClick={() => setActiveCategory("all")}
            className={clsx(
              "rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer shrink-0",
              activeCategory === "all"
                ? "bg-white text-black shadow"
                : "border border-white/10 bg-white/5 text-neutral-400 hover:text-white"
            )}
          >
            All
          </button>
          <button
            onClick={() => setActiveCategory("fast")}
            className={clsx(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer shrink-0",
              activeCategory === "fast"
                ? "bg-amber-400 text-black shadow"
                : "border border-white/10 bg-white/5 text-neutral-400 hover:text-white"
            )}
          >
            <Zap className="h-3 w-3" />
            Fast Stream
          </button>
          <button
            onClick={() => setActiveCategory("hindi")}
            className={clsx(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer shrink-0",
              activeCategory === "hindi"
                ? "bg-orange-500 text-white shadow"
                : "border border-white/10 bg-white/5 text-neutral-400 hover:text-white"
            )}
          >
            <Globe className="h-3 w-3" />
            Hindi & Dubbed
          </button>
          {isAnime && (
            <button
              onClick={() => setActiveCategory("anime")}
              className={clsx(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer shrink-0",
                activeCategory === "anime"
                  ? "bg-fuchsia-500 text-white shadow"
                  : "border border-white/10 bg-white/5 text-neutral-400 hover:text-white"
              )}
            >
              <Sparkles className="h-3 w-3" />
              Anime
            </button>
          )}
          <button
            onClick={() => setActiveCategory("direct")}
            className={clsx(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer shrink-0",
              activeCategory === "direct"
                ? "bg-emerald-500 text-white shadow"
                : "border border-white/10 bg-white/5 text-neutral-400 hover:text-white"
            )}
          >
            <Radio className="h-3 w-3" />
            Direct / 4K
          </button>
        </div>
      </div>

      {/* Main Server Selection Grid / Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {filteredProviders.map((pv, i) => {
          const isActive = activeServerId === pv.id;
          const isHindi = HINDI_SERVERS.has(pv.id);
          const isAnimeServer = ANIME_SERVERS.has(pv.id);

          return (
            <button
              key={pv.id}
              onClick={() => onSelectServer(pv.id)}
              className={clsx(
                "group relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-brand text-white shadow-[0_0_16px_rgba(229,9,20,0.4)] ring-1 ring-brand scale-[1.03]"
                  : "border border-white/10 bg-white/5 text-neutral-300 hover:border-white/30 hover:bg-white/10 hover:text-white active:scale-95"
              )}
            >
              {isActive && (
                <span className="flex h-1.5 w-1.5 rounded-full bg-white animate-ping" />
              )}
              <span>{pv.label ?? `Server ${i + 1}`}</span>

              {isHindi && !isActive && (
                <span className="text-[10px] text-amber-400 font-semibold">🇮🇳</span>
              )}
              {isAnimeServer && !isActive && (
                <span className="text-[10px] text-pink-400 font-semibold">🌸</span>
              )}
            </button>
          );
        })}

        {/* Reload Player Action Button */}
        <button
          onClick={handleReload}
          title="Reload Player Stream (R)"
          className={clsx(
            "flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-neutral-300 transition-all hover:border-white/30 hover:bg-white/15 hover:text-white active:scale-95 cursor-pointer ml-auto",
            isReloading && "rotate-180 transition-transform duration-500 text-brand border-brand"
          )}
        >
          <RotateCw className={clsx("h-4 w-4", isReloading && "animate-spin text-brand")} />
        </button>
      </div>

      {/* Sub-Player Selector (Server 8 / MultiMovies) */}
      {subPlayers.length > 0 && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <div className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
            <Layers className="h-3.5 w-3.5 text-brand" />
            <span>Select Player:</span>
          </div>
          {subPlayers.map((sp) => {
            const isSubActive =
              activeSubPlayerId === sp.id || (!activeSubPlayerId && sp === subPlayers[0]);
            return (
              <button
                key={sp.id}
                onClick={() => onSelectSubPlayer(sp.id)}
                className={clsx(
                  "rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer",
                  isSubActive
                    ? "bg-white text-black shadow-md font-extrabold"
                    : "border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white"
                )}
              >
                {sp.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Anime Sub / Dub Switcher & Popout */}
      {activeServerId === "megaplay" && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-neutral-400">
              <Volume2 className="h-3.5 w-3.5 text-pink-400" />
              <span>Audio:</span>
            </div>
            <button
              type="button"
              onClick={() => onSelectSubOrDub("sub")}
              className={clsx(
                "rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer",
                subOrDub === "sub"
                  ? "bg-pink-600 text-white shadow"
                  : "border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
              )}
            >
              Japanese Sub
            </button>
            <button
              type="button"
              onClick={() => onSelectSubOrDub("dub")}
              className={clsx(
                "rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer",
                subOrDub === "dub"
                  ? "bg-pink-600 text-white shadow"
                  : "border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
              )}
            >
              English Dub
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.open(window.location.href, "_blank")}
            title="Open player in standalone tab"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-neutral-300 transition hover:bg-white/15 hover:text-white cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
            <span>Popout Tab</span>
          </button>
        </div>
      )}
    </div>
  );
}
