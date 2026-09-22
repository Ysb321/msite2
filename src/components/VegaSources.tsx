"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  openInVlc,
  downloadFile,
} from "@/lib/vlc";
import SitePlayer from "@/components/SitePlayer";
import { PlayIcon, RotateCcwIcon, CheckIcon, ChevronIcon } from "@/components/Icons";

export type VegaStorageType =
  | "cloudflare_r2"
  | "aws"
  | "cf_worker"
  | "fastdl"
  | "pixeldrain"
  | "gofile"
  | "direct"
  | "ddl";

export type AvailableEpisode = {
  season: number;
  episode: number;
  title?: string;
};

export type VegaRow = {
  name: string;
  description: string;
  url: string;
  quality?: string;
  size?: string;
  provider?: string;
  subtitles?: { lang: string; name: string; url: string }[];
  headers?: Record<string, string>;
  blog?: string;
  linkType?: "direct" | "ddl" | "bypassed";
  storageType?: VegaStorageType;
  season?: number;
  episode?: number;
  isBypassed?: boolean;
  originalUrl?: string;
};

type Props = {
  type: "movie" | "tv";
  tmdbId: string;
  title: string;
  year: string;
  imdbId: string | null;
  season: number;
  episode: number;
  onSelectEpisode?: (season: number, episode: number) => void;
};

type Status = "loading" | "ready" | "empty" | "error";

const LOAD_LINES = [
  "Connecting to Vega Multi-Provider Engine...",
  "Querying MovieBoxWeb (AWS CloudFront Direct Streams)...",
  "Resolving HdHub4u & VegaMovies (Cloudflare R2 & Shorteners)...",
  "Decrypting WAF tokens & extracting Cloudflare R2 / AWS links...",
];

export default function VegaSources({
  type,
  tmdbId,
  title,
  year,
  imdbId,
  season: initialSeason,
  episode: initialEpisode,
  onSelectEpisode,
}: Props) {
  const [currentSeason, setCurrentSeason] = useState<number>(initialSeason);
  const [currentEpisode, setCurrentEpisode] = useState<number>(initialEpisode);

  const [status, setStatus] = useState<Status>("loading");
  const [rows, setRows] = useState<VegaRow[]>([]);
  const [availableEpisodes, setAvailableEpisodes] = useState<AvailableEpisode[]>([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [bypassingUrl, setBypassingUrl] = useState<string | null>(null);
  const [bypassNotice, setBypassNotice] = useState<string | null>(null);

  const [player, setPlayer] = useState<{
    url: string;
    title: string;
    currentKey: string;
    subtitles?: { url: string; name: string; lang: string }[];
  } | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Sync state if props change from outside
  useEffect(() => {
    setCurrentSeason(initialSeason);
  }, [initialSeason]);

  useEffect(() => {
    setCurrentEpisode(initialEpisode);
  }, [initialEpisode]);

  const load = useCallback(
    (sNum = currentSeason, eNum = currentEpisode) => {
      setStatus("loading");
      setError("");
      setTick(0);
      setPlayer(null);

      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(new Error("timeout")), 35000);
      const clock = setInterval(() => setTick((n) => n + 1), 2500);

      (async () => {
        try {
          const kind = type === "movie" ? "movie" : "series";
          const params = new URLSearchParams({
            title,
            year,
            s: String(sNum),
            e: String(eNum),
          });
          if (imdbId) params.set("imdb", imdbId);

          const res = await fetch(`/api/vegaproviders/stream/${kind}/${tmdbId}?${params}`, {
            signal: ctrl.signal,
          });

          if (!alive.current) return;
          if (!res.ok) throw new Error(`Vega API responded with ${res.status}`);
          const body = await res.json();
          const list: VegaRow[] = Array.isArray(body.rows) ? body.rows : [];

          if (!alive.current) return;
          if (Array.isArray(body.availableEpisodes) && body.availableEpisodes.length > 0) {
            setAvailableEpisodes(body.availableEpisodes);
          }

          if (list.length > 0) {
            setRows(list);
            setStatus("ready");
          } else {
            setStatus("empty");
          }
        } catch (e) {
          if (!alive.current) return;
          setError(
            e instanceof Error && /abort|timeout/i.test(e.message)
              ? "Request timed out — Vega sources are taking longer than usual to respond."
              : "Could not retrieve sources from Vega Multi-Provider right now."
          );
          setStatus("error");
        } finally {
          clearTimeout(killer);
          clearInterval(clock);
        }
      })();

      return () => {
        ctrl.abort();
        clearTimeout(killer);
        clearInterval(clock);
      };
    },
    [type, tmdbId, title, year, imdbId, currentSeason, currentEpisode]
  );

  useEffect(() => {
    const cleanup = load(currentSeason, currentEpisode);
    return cleanup;
  }, [load, currentSeason, currentEpisode]);

  const handleSelectEpisode = (epNum: number, seasonNum = currentSeason) => {
    setCurrentSeason(seasonNum);
    setCurrentEpisode(epNum);
    if (onSelectEpisode) {
      onSelectEpisode(seasonNum, epNum);
    }
  };

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const [isAutomating, setIsAutomating] = useState(false);

  // On-demand bypass action for intermediate / WAF protected links
  const handleBypass = async (row: VegaRow) => {
    if (bypassingUrl) return;
    setBypassingUrl(row.url);
    setBypassNotice(`Decrypting tokens and resolving Cloudflare R2 / AWS links for ${row.name}...`);

    try {
      const res = await fetch("/api/vegaproviders/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: row.url,
          provider: row.provider,
          season: currentSeason,
          episode: currentEpisode,
        }),
      });

      const data = await res.json();
      if (Array.isArray(data.directLinks) && data.directLinks.length > 0) {
        const directList: VegaRow[] = data.directLinks.map((dl: any) => ({
          ...dl,
          name: `${dl.name} (Bypassed from ${row.provider || "Vega"})`,
          description: `${row.description} • Verified Direct Stream`,
          season: currentSeason,
          episode: currentEpisode,
          isBypassed: true,
        }));

        setRows((prev) => {
          // Prepend new direct links
          const filtered = prev.filter((p) => !directList.some((d) => d.url === p.url));
          return [...directList, ...filtered];
        });

        setBypassNotice(`✨ Successfully bypassed! Extracted ${directList.length} direct high-speed links.`);
        setTimeout(() => setBypassNotice(null), 4000);
      } else {
        setBypassNotice("Could not extract direct stream from this link. Try another source.");
        setTimeout(() => setBypassNotice(null), 3500);
      }
    } catch {
      setBypassNotice("Bypass request failed. Please check network connection.");
      setTimeout(() => setBypassNotice(null), 3500);
    } finally {
      setBypassingUrl(null);
    }
  };

  // Automated batch bypass for all un-bypassed DDL links
  const handleAutomateAllBypasses = async () => {
    if (isAutomating) return;
    const unbypassed = rows.filter(
      (r) =>
        r.linkType === "ddl" &&
        !r.isBypassed &&
        r.url &&
        (r.url.includes("greenmotors") ||
          r.url.includes("hubcloud") ||
          r.url.includes("modpro.blog") ||
          r.url.includes("cinematickit") ||
          r.url.includes("dramadrip") ||
          r.url.includes("unblocked"))
    );

    if (unbypassed.length === 0) {
      setBypassNotice("All available links are already direct Cloudflare R2 / AWS streams!");
      setTimeout(() => setBypassNotice(null), 3500);
      return;
    }

    setIsAutomating(true);
    setBypassNotice(`⚡ Automating bypass for ${unbypassed.length} source links in parallel...`);

    try {
      const results = await Promise.all(
        unbypassed.map(async (row) => {
          try {
            const res = await fetch("/api/vegaproviders/bypass", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: row.url,
                provider: row.provider,
                season: currentSeason,
                episode: currentEpisode,
              }),
            });
            const data = await res.json();
            if (Array.isArray(data.directLinks) && data.directLinks.length > 0) {
              return data.directLinks.map((dl: any) => ({
                ...dl,
                name: `${dl.name} (Auto-Bypassed from ${row.provider || "Vega"})`,
                description: `${row.description} • Verified Direct Stream`,
                season: currentSeason,
                episode: currentEpisode,
                isBypassed: true,
              }));
            }
            return [];
          } catch {
            return [];
          }
        })
      );

      const allDirect = results.flat();
      if (allDirect.length > 0) {
        setRows((prev) => {
          const filtered = prev.filter((p) => !allDirect.some((d) => d.url === p.url));
          return [...allDirect, ...filtered];
        });
        setActiveFilter("direct");
        setBypassNotice(`✨ Automation complete! Generated ${allDirect.length} direct high-speed streams.`);
      } else {
        setBypassNotice("Completed automation pass.");
      }
    } catch {
      setBypassNotice("Automation failed. Try bypassing individually.");
    } finally {
      setIsAutomating(false);
      setTimeout(() => setBypassNotice(null), 4000);
    }
  };

  // Filter calculations
  const counts = useMemo(() => {
    let r2 = 0;
    let aws = 0;
    let worker = 0;
    let direct = 0;

    for (const r of rows) {
      if (r.storageType === "cloudflare_r2") r2++;
      if (r.storageType === "aws") aws++;
      if (r.storageType === "cf_worker") worker++;
      if (r.linkType === "direct" || r.url.endsWith(".mp4")) direct++;
    }

    return { r2, aws, worker, direct, total: rows.length };
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (activeFilter === "r2" && r.storageType !== "cloudflare_r2") return false;
      if (activeFilter === "aws" && r.storageType !== "aws") return false;
      if (activeFilter === "worker" && r.storageType !== "cf_worker") return false;
      if (activeFilter === "direct" && r.linkType !== "direct") return false;
      if (activeFilter === "ddl" && r.linkType !== "ddl") return false;
      if (activeFilter === "1080p" && !r.quality?.includes("1080")) return false;
      if (activeFilter === "720p" && !r.quality?.includes("720")) return false;

      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        return (
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.provider?.toLowerCase().includes(q) ||
          (r.storageType && r.storageType.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [rows, activeFilter, searchFilter]);

  // Generate episode pills for TV series (defined before any early returns to respect React Hook rules)
  const seasonEpisodes = useMemo(() => {
    if (type !== "tv") return [];
    const list = availableEpisodes.filter((e) => e.season === currentSeason);
    if (list.length > 0) return list;

    // Fallback default episode list (1 to 24)
    return Array.from({ length: 16 }, (_, i) => ({
      season: currentSeason,
      episode: i + 1,
      title: `Episode ${i + 1}`,
    }));
  }, [type, availableEpisodes, currentSeason]);

  const availableSeasons = useMemo(() => {
    if (type !== "tv") return [1];
    const sSet = new Set<number>();
    availableEpisodes.forEach((e) => sSet.add(e.season));
    if (sSet.size === 0) return [1, 2, 3, 4, 5];
    return Array.from(sSet).sort((a, b) => a - b);
  }, [type, availableEpisodes]);

  if (player) {
    return (
      <div className="relative flex h-full flex-col bg-black">
        <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2 bg-neutral-950">
          <button
            onClick={() => setPlayer(null)}
            className="flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-neutral-200 hover:bg-white/20 hover:text-white transition"
          >
            ← Back to Vega Sources
          </button>
          <span className="max-w-md truncate text-xs font-medium text-neutral-300">
            {player.title}
          </span>
          <div className="w-16" />
        </div>
        <div className="relative flex-1 bg-black">
          <SitePlayer
            key={player.currentKey}
            mountId={player.currentKey}
            url={player.url}
            title={player.title}
            sources={rows.map((r, i) => ({
              key: `vega-${i}`,
              quality: r.quality || "HD",
              size: r.size || "",
              source: r.provider || "Vega",
              file: r.name,
              audio: r.storageType || "CDN",
            }))}
            currentKey={player.currentKey}
            startAt={0}
            onPickSource={async (k) => {
              const idx = parseInt(k.replace("vega-", ""), 10);
              return rows[idx]?.url || null;
            }}
            subtitles={player.subtitles}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-neutral-950 text-white overflow-y-auto">
      {/* Top Banner & Episode Showcase Header */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-neutral-950/95 backdrop-blur-md px-4 py-3 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Server 38 • Vega Engine & Cloudflare R2 / AWS Links
                </h2>
                <span className="rounded-md border border-brand/40 bg-brand/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-brand tracking-wider">
                  Zenda-Cross
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                {title} {year ? `(${year})` : ""} • High-speed direct Cloudflare R2, AWS CloudFront, & Bypassed Streams
              </p>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                onClick={() => load(currentSeason, currentEpisode)}
                disabled={status === "loading"}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-white/10 hover:text-white transition disabled:opacity-50"
              >
                <RotateCcwIcon className={`h-3 w-3 ${status === "loading" ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Episode Navigator for TV Shows */}
          {type === "tv" && (
            <div className="rounded-xl border border-white/10 bg-neutral-900/80 p-3 space-y-2.5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Episode Showcase:
                  </span>
                  <span className="rounded-md bg-brand/20 border border-brand/40 px-2 py-0.5 text-xs font-extrabold text-brand">
                    Season {currentSeason} • Episode {currentEpisode}
                  </span>
                </div>

                {availableSeasons.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-neutral-400">Season:</span>
                    <div className="flex items-center gap-1">
                      {availableSeasons.map((s) => (
                        <button
                          key={`s-${s}`}
                          onClick={() => handleSelectEpisode(1, s)}
                          className={`rounded px-2 py-0.5 text-[11px] font-bold transition ${
                            currentSeason === s
                              ? "bg-brand text-black"
                              : "bg-white/5 text-neutral-300 hover:bg-white/15"
                          }`}
                        >
                          S{s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Episode Scroller */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/20">
                <button
                  onClick={() => handleSelectEpisode(Math.max(1, currentEpisode - 1))}
                  disabled={currentEpisode <= 1}
                  className="flex-shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-neutral-300 hover:bg-white/15 hover:text-white disabled:opacity-40 transition"
                  title="Previous Episode"
                >
                  ◀ Prev
                </button>

                {seasonEpisodes.map((ep) => {
                  const isActive = ep.episode === currentEpisode;
                  return (
                    <button
                      key={`ep-pill-${ep.season}-${ep.episode}`}
                      onClick={() => handleSelectEpisode(ep.episode, ep.season)}
                      className={`flex-shrink-0 flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-bold transition ${
                        isActive
                          ? "border-brand bg-brand text-black shadow-md"
                          : "border-white/10 bg-white/5 text-neutral-300 hover:border-white/30 hover:bg-white/10"
                      }`}
                    >
                      <span>Ep {ep.episode}</span>
                    </button>
                  );
                })}

                <button
                  onClick={() => handleSelectEpisode(currentEpisode + 1)}
                  className="flex-shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-neutral-300 hover:bg-white/15 hover:text-white transition"
                  title="Next Episode"
                >
                  Next ▶
                </button>
              </div>
            </div>
          )}

          {/* Quick Filters (Cloudflare R2, AWS, Direct) */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              onClick={() => setActiveFilter("all")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeFilter === "all"
                  ? "bg-white text-black shadow-xs"
                  : "bg-white/5 text-neutral-300 hover:bg-white/10"
              }`}
            >
              All Sources ({counts.total})
            </button>

            <button
              onClick={() => setActiveFilter("r2")}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                activeFilter === "r2"
                  ? "border-amber-400 bg-amber-400 text-black shadow-xs"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              }`}
            >
              <span>☁️ Cloudflare R2</span>
              {counts.r2 > 0 && (
                <span className="rounded-full bg-amber-500/30 px-1.5 py-0.2 text-[10px]">
                  {counts.r2}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveFilter("aws")}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                activeFilter === "aws"
                  ? "border-sky-400 bg-sky-400 text-black shadow-xs"
                  : "border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
              }`}
            >
              <span>⚡ AWS CloudFront / S3</span>
              {counts.aws > 0 && (
                <span className="rounded-full bg-sky-500/30 px-1.5 py-0.2 text-[10px]">
                  {counts.aws}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveFilter("worker")}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                activeFilter === "worker"
                  ? "border-cyan-400 bg-cyan-400 text-black shadow-xs"
                  : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
              }`}
            >
              <span>🛡️ CF Worker</span>
              {counts.worker > 0 && (
                <span className="rounded-full bg-cyan-500/30 px-1.5 py-0.2 text-[10px]">
                  {counts.worker}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveFilter("direct")}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                activeFilter === "direct"
                  ? "border-emerald-400 bg-emerald-400 text-black shadow-xs"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              }`}
            >
              <span>🎬 Direct MP4</span>
              {counts.direct > 0 && (
                <span className="rounded-full bg-emerald-500/30 px-1.5 py-0.2 text-[10px]">
                  {counts.direct}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveFilter("1080p")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                activeFilter === "1080p"
                  ? "bg-white text-black"
                  : "bg-white/5 text-neutral-300 hover:bg-white/10"
              }`}
            >
              1080p
            </button>

            <button
              onClick={handleAutomateAllBypasses}
              disabled={isAutomating}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                isAutomating
                  ? "border-brand/40 bg-brand/20 text-brand animate-pulse cursor-wait"
                  : "border-brand/60 bg-brand/10 text-brand hover:bg-brand/20 hover:border-brand shadow-sm"
              }`}
              title="Automatically bypass all intermediate and shortener links to generate direct Cloudflare R2 and AWS streams"
            >
              <span>⚡ {isAutomating ? "Bypassing All..." : "Auto-Bypass All"}</span>
            </button>

            <div className="flex-1 min-w-[140px] max-w-xs ml-auto">
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter streams or server..."
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white placeholder-neutral-500 focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          {/* Bypass notification notice */}
          {bypassNotice && (
            <div className="rounded-lg border border-brand/40 bg-brand/15 px-3.5 py-2 text-xs font-semibold text-brand flex items-center justify-between">
              <span>{bypassNotice}</span>
              <button onClick={() => setBypassNotice(null)} className="text-white/60 hover:text-white">
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-4 sm:p-6">
        {status === "loading" && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 rounded-full border-2 border-brand/20 animate-ping" />
              <div className="h-12 w-12 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">
                {LOAD_LINES[tick % LOAD_LINES.length]}
              </p>
              <p className="text-xs text-neutral-400">
                Resolving links for {type === "tv" ? `Season ${currentSeason} • Episode ${currentEpisode}` : title}...
              </p>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-xl text-red-400 border border-red-500/20">
              ⚠️
            </div>
            <p className="text-sm font-bold text-red-300">{error}</p>
            <p className="max-w-md text-xs text-neutral-400">
              The Vega provider scrapers might be temporarily experiencing network delays.
            </p>
            <button
              onClick={() => load(currentSeason, currentEpisode)}
              className="mt-1 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black hover:bg-brand/90 transition shadow-md"
            >
              Retry Vega Providers
            </button>
          </div>
        )}

        {status === "empty" && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-xl text-neutral-400 border border-white/10">
              🔍
            </div>
            <p className="text-sm font-bold text-white">
              No stream links found for {type === "tv" ? `Season ${currentSeason} • Episode ${currentEpisode}` : title}
            </p>
            <p className="max-w-md text-xs text-neutral-400">
              Try switching episodes above, or use other server providers like Server 11 (DesiDDL).
            </p>
            <button
              onClick={() => load(currentSeason, currentEpisode)}
              className="mt-1 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
            >
              Search Again
            </button>
          </div>
        )}

        {status === "ready" && (
          <div className="max-w-5xl mx-auto space-y-2.5">
            {filteredRows.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-neutral-900/40 p-8 text-center">
                <p className="text-xs text-neutral-400">No streams match your filter. Select "All Sources" above.</p>
              </div>
            ) : (
              filteredRows.map((row, idx) => {
                const isDirect = row.linkType === "direct" || row.url.includes(".mp4");
                const isBypassing = bypassingUrl === row.url;

                // Storage type tag
                const storageBadge =
                  row.storageType === "cloudflare_r2" ? (
                    <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      ☁️ Cloudflare R2
                    </span>
                  ) : row.storageType === "aws" ? (
                    <span className="rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                      ⚡ AWS CloudFront / S3
                    </span>
                  ) : row.storageType === "cf_worker" ? (
                    <span className="rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                      🛡️ CF Worker CDN
                    </span>
                  ) : row.storageType === "pixeldrain" ? (
                    <span className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      ⚡ Pixeldrain Direct
                    </span>
                  ) : null;

                const providerColor =
                  row.provider === "MovieBoxWeb"
                    ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                    : row.provider === "Vega"
                    ? "border-blue-500/30 bg-blue-500/15 text-blue-300"
                    : row.provider === "HdHub4u"
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                    : row.provider === "MoviesMod"
                    ? "border-purple-500/30 bg-purple-500/15 text-purple-300"
                    : row.provider === "World4uFree"
                    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-300"
                    : "border-rose-500/30 bg-rose-500/15 text-rose-300";

                return (
                  <div
                    key={`${row.url}-${idx}`}
                    className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-3.5 hover:border-brand/40 hover:bg-neutral-900/90 transition shadow-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${providerColor}`}
                        >
                          {row.provider || row.blog || "Vega"}
                        </span>

                        {storageBadge}

                        {row.isBypassed && (
                          <span className="rounded-md border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                            ✨ Bypassed Direct
                          </span>
                        )}

                        {row.quality && (
                          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-neutral-200">
                            {row.quality}
                          </span>
                        )}

                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                            isDirect
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                              : "border-sky-500/30 bg-sky-500/15 text-sky-300"
                          }`}
                        >
                          {isDirect ? "⚡ Direct MP4 Stream" : "☁️ High-Speed DDL"}
                        </span>

                        {row.subtitles && row.subtitles.length > 0 && (
                          <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                            💬 {row.subtitles.length} Subtitles
                          </span>
                        )}
                      </div>

                      <h3 className="text-xs sm:text-sm font-semibold text-white group-hover:text-brand transition truncate">
                        {row.name}
                      </h3>

                      <p className="text-[11.5px] text-neutral-400 truncate">
                        {row.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
                      {isDirect ? (
                        <button
                          onClick={() => {
                            setPlayer({
                              url: row.url,
                              title: `${title} - ${row.name}`,
                              currentKey: `vega-${idx}`,
                              subtitles: row.subtitles,
                            });
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-bold text-black hover:bg-brand/90 transition shadow-sm"
                        >
                          <PlayIcon className="h-3.5 w-3.5 fill-current" />
                          Play
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleBypass(row)}
                            disabled={isBypassing}
                            className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition shadow-sm disabled:opacity-50"
                            title="Bypass intermediate link to extract Cloudflare R2 / AWS direct stream"
                          >
                            <span>{isBypassing ? "⏳ Bypassing..." : "⚡ Bypass to R2 / AWS"}</span>
                          </button>

                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-white/20 transition"
                          >
                            <span>Open</span>
                            <span className="text-[10px]">↗</span>
                          </a>
                        </>
                      )}

                      <button
                        onClick={() => openInVlc(row.url, `${title} - ${row.name}`)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-white/15 hover:text-white transition"
                        title="Open stream in VLC player"
                      >
                        VLC
                      </button>

                      <button
                        onClick={() => downloadFile(row.url, `${title.replace(/\s+/g, "_")}.mp4`)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-white/15 hover:text-white transition"
                        title="Download file"
                      >
                        Download
                      </button>

                      <button
                        onClick={() => copyToClipboard(row.url)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-semibold text-neutral-400 hover:bg-white/15 hover:text-white transition"
                        title="Copy direct URL"
                      >
                        {copiedUrl === row.url ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
