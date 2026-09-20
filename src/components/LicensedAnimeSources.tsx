"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { PlayIcon, RotateCcwIcon, ChevronIcon } from "@/components/Icons";

/* Server 18 — the licensed anime lane. Lists episodes found on the
 * rightsholders' own YouTube channels (Muse Asia, Ani-One Asia, Gundam
 * Channel INTL) and plays the picked one in YouTube's privacy-enhanced
 * player, so the view counts for the licensor.
 *
 * Unlike the other lanes this embeds an official player rather than a
 * resolved file, so there is no VLC/download path and no resume
 * bookkeeping of our own — YouTube handles playback position itself. */

type Props = {
  type: "movie" | "tv";
  tmdbId: string;
  title: string;
  /** original_title / original_name — catches romaji-only uploads */
  altTitle?: string;
  season: number;
  episode: number;
};

type Source = {
  key: string;
  videoId: string;
  title: string;
  channel: string;
  url: string;
  embed: string;
  length?: string;
  published?: string;
  episode?: number;
  audio: "sub" | "dub" | "unknown";
  score: number;
};

type Status = "loading" | "ready" | "empty" | "error";

const LOAD_LINES = [
  "Checking the licensors' official channels…",
  "Searching Muse Asia · Ani-One · Gundam Channel…",
  "Matching the episode number…",
  "Almost there — confirming the upload…",
];

const audioLabel = (a: Source["audio"]) =>
  a === "dub" ? "Dub" : a === "sub" ? "Sub" : "";

export default function LicensedAnimeSources({
  type,
  tmdbId,
  title,
  altTitle,
  season,
  episode,
}: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<Source | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setStatus("loading");
    setSources([]);
    setPicked(null);
    setListOpen(false);
    setError("");
    setTick(0);
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(new Error("timeout")), 30000);
    const clock = setInterval(() => setTick((n) => n + 1), 6000);
    (async () => {
      try {
        const kind = type === "movie" ? "movie" : "series";
        const id = type === "movie" ? tmdbId : `${tmdbId}:${season}:${episode}`;
        const qs = new URLSearchParams({ title });
        if (altTitle && altTitle !== title) qs.set("alt", altTitle);
        const res = await fetch(`/api/licensedanime/stream/${kind}/${id}?${qs}`, {
          signal: ctrl.signal,
        });
        if (!alive.current) return;
        if (!res.ok) throw new Error(`licensedanime ${res.status}`);
        const body = await res.json();
        if (typeof body.diag === "string" && body.diag)
          console.info("[licensed-anime]", body.diag.slice(0, 400));
        if (typeof body.laneError === "string" && body.laneError) {
          setError(body.laneError.slice(0, 160));
          setStatus("error");
          return;
        }
        const list: Source[] = Array.isArray(body.sources) ? body.sources : [];
        if (!alive.current) return;
        if (list.length) {
          setSources(list);
          setPicked(list[0]);
          setStatus("ready");
        } else {
          setStatus("empty");
        }
      } catch (e) {
        if (!alive.current) return;
        setError(
          e instanceof Error && /abort|timeout/i.test(e.message)
            ? "Search timed out — the channel search is slow right now."
            : "Couldn't reach the licensed channels."
        );
        setStatus("error");
      } finally {
        clearTimeout(killer);
        clearInterval(clock);
      }
    })();
    return () => {
      alive.current = false;
      ctrl.abort();
      clearTimeout(killer);
      clearInterval(clock);
    };
  }, [type, tmdbId, title, altTitle, season, episode, reload]);

  /* ── player ── */
  if (status === "ready" && picked) {
    return (
      <div className="relative h-full w-full bg-black">
        <iframe
          key={picked.videoId}
          src={`${picked.embed}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={picked.title}
          className="h-full w-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture; accelerometer"
          allowFullScreen
        />

        {/* source bar: which official channel this is coming from */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
          <div className="pointer-events-auto flex max-w-[70%] items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 backdrop-blur">
            <span className="shrink-0 text-[11px]">🌸</span>
            <span className="truncate text-[11px] font-semibold text-white">
              {picked.channel}
            </span>
            {audioLabel(picked.audio) && (
              <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-200">
                {audioLabel(picked.audio)}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              Official
            </span>
          </div>
          {sources.length > 1 && (
            <button
              onClick={() => setListOpen((o) => !o)}
              className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-black/75 px-3 py-1.5 text-[11px] font-semibold text-neutral-200 backdrop-blur transition hover:text-white"
            >
              {sources.length} sources
              <ChevronIcon dir={listOpen ? "left" : "right"} className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* alternate uploads (other licensors / sub vs dub) */}
        {listOpen && sources.length > 1 && (
          <div className="absolute inset-y-0 right-0 w-[min(340px,80%)] overflow-y-auto bg-black/90 p-2 backdrop-blur">
            <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Official uploads
            </p>
            {sources.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  setPicked(s);
                  setListOpen(false);
                }}
                className={clsx(
                  "mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition hover:bg-white/10",
                  picked.key === s.key && "bg-white/10 ring-1 ring-brand/60"
                )}
              >
                <PlayIcon
                  className={clsx(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    picked.key === s.key ? "text-brand" : "text-neutral-500"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-neutral-100">
                    {s.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                    {s.channel}
                    {s.length ? ` · ${s.length}` : ""}
                    {audioLabel(s.audio) ? ` · ${audioLabel(s.audio)}` : ""}
                  </span>
                </span>
              </button>
            ))}
            <a
              href={picked.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block rounded-md px-2 py-2 text-[11px] text-neutral-400 hover:text-white"
            >
              Open on YouTube ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  /* ── loading ── */
  if (status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-brand" />
        <p className="text-[13px] font-semibold text-neutral-300">
          {LOAD_LINES[Math.min(tick, LOAD_LINES.length - 1)]}
        </p>
        <p className="max-w-sm text-[11.5px] text-neutral-500">
          Muse Asia · Ani-One Asia · Gundam Channel INTL — official licensor channels
        </p>
      </div>
    );
  }

  /* ── empty / error ── */
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="text-4xl">🌸</span>
      <p className="text-sm font-bold">
        {status === "error" ? "Licensed channels unavailable" : "Not in the licensed catalogue"}
      </p>
      <p className="max-w-md text-[12.5px] leading-relaxed text-neutral-400">
        {status === "error"
          ? error
          : "The licensors' own channels don't carry this title (their rights are per-title and per-region). Their catalogue rotates, so it may appear later."}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => setReload((r) => r + 1)}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-neutral-200 transition hover:bg-white/20"
        >
          <RotateCcwIcon className="h-3.5 w-3.5" /> Retry
        </button>
        <a
          href={`https://www.youtube.com/channel/UCGbshtvS9t-8CW11W7TooQg/search?query=${encodeURIComponent(title)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-neutral-200 transition hover:bg-white/20"
        >
          Search Muse Asia ↗
        </a>
      </div>
    </div>
  );
}
