"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  openInVlc,
  downloadFile,
  isDesktopVlc,
  isAndroid,
  isIOS,
} from "@/lib/vlc";
import { fmtTime } from "@/lib/player";
import { getResume, saveResume, clearResume, resumeKeyFor } from "@/lib/storage";
import SitePlayer from "@/components/SitePlayer";
import { PlayIcon, RotateCcwIcon, CheckIcon, ChevronIcon } from "@/components/Icons";

type Props = {
  type: "movie" | "tv";
  tmdbId: string;
  title: string;
  year: string;
  imdbId: string | null;
  season: number;
  episode: number;
};

type Status = "loading" | "ready" | "empty" | "error";

type DdRow = {
  key: string;
  blog: string;
  quality: string;
  size: string;
  source: string;
  file: string;
  audio: string;
  hub: string;
  hubKind: string;
};

const LOAD_LINES = [
  "Contacting Hindi DDL blogs…",
  "Searching VegaMovies · MoviesDrive · HDMovie2…",
  "Still searching — the blogs are slow right now…",
  "Almost there — reading the quality sections…",
];

const isHlsFile = (u: string) => /\.m3u8(\?|#|$)/i.test(u);

const guessServer = (u: string) =>
  /googleusercontent/i.test(u)
    ? "G-Direct"
    : /busycdn/i.test(u)
      ? "Instant"
      : /pixeldrain/i.test(u)
        ? "Pixeldrain"
        : "Hub link";

/* file-ish iframe locations (direct files, ?link= wraps, known CDNs) */
const extractFile = (href: string): string => {
  if (!href || href === "about:blank") return "";
  try {
    const u = new URL(href);
    const link = u.searchParams.get("link");
    if (link && /^https:\/\//i.test(link)) return link;
    if (/\.(mp4|mkv|avi|mov|webm|flv|wmv|m3u8|mpd|ts|m4v)(\?|#|$)/i.test(u.pathname + u.search))
      return href;
    if (/googleusercontent\.com|busycdn\.xyz/i.test(u.hostname) && !u.pathname.startsWith("/api/"))
      return href;
    return "";
  } catch {
    return "";
  }
};

const platformHint = () =>
  isDesktopVlc()
    ? "Tap a quality — the hub page opens here, generate the link and it auto-plays (or opens in VLC)"
    : isAndroid() || isIOS()
      ? "Tap a quality — the hub page opens here, generate the link and it auto-plays (or opens in your VLC app)"
      : "Tap a quality — the hub page opens here, generate the link and it auto-plays (or opens in VLC via the desktop app)";

/* Server 11 (DesiDDL) - the Hindi-DDL lane: VegaMovies + MoviesDrive dual-
 * audio posts via nexdrive intermediates plus HDMovie2 GDFlix rows. Taps
 * open the hub page EMBEDDED (proxied same-origin, sandboxed, popups
 * blocked): the user clicks the hub's own Download / FSL / Generate
 * buttons and the file auto-plays in the site player (capture script +
 * location poll; paste box + raw-page fallback if our proxy is walled).
 * Own :site-dd resume namespace (different encodes from the others). */
export default function DdlSources({ type, tmdbId, title, year, imdbId, season, episode }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [rows, setRows] = useState<DdRow[]>([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [embed, setEmbed] = useState<{ row: DdRow; mode: "proxy" | "direct" } | null>(null);
  const [embedReady, setEmbedReady] = useState(false);
  const [embedError, setEmbedError] = useState("");
  const [embedLeft, setEmbedLeft] = useState(false);
  const [paste, setPaste] = useState("");
  const [addr, setAddr] = useState("");
  const [frameKey, setFrameKey] = useState(0);
  const [note, setNote] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [player, setPlayer] = useState<{
    url: string;
    label: string;
    filename: string;
    rowKey: string;
    startAt: number;
    mountId: string;
  } | null>(null);
  const [playError, setPlayError] = useState(false);
  const [pnote, setPnote] = useState("");
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const alive = useRef(true);
  const lastSent = useRef(0);
  const fileTaken = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [hint] = useState(platformHint);
  const [isPcWeb] = useState(() => !isDesktopVlc() && !isAndroid() && !isIOS());
  const [isPhone] = useState(() => isAndroid() || isIOS());

  const siteKey = `${resumeKeyFor(type, tmdbId, season, episode)}:site-dd`;

  useEffect(() => {
    alive.current = true;
    setStatus("loading");
    setRows([]);
    setError("");
    setTick(0);
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(new Error("timeout")), 100000);
    const clock = setInterval(() => setTick((n) => n + 1), 9000);
    (async () => {
      try {
        const kind = type === "movie" ? "movie" : "series";
        const params = new URLSearchParams({
          title, year, s: String(season), e: String(episode),
        });
        if (imdbId) params.set("imdb", imdbId);
        const res = await fetch(`/api/desiddl/stream/${kind}/${tmdbId}?${params}`, {
          signal: ctrl.signal,
        });
        if (!alive.current) return;
        if (!res.ok) throw new Error(`desiddl ${res.status}`);
        const body = await res.json();
        const list: DdRow[] = Array.isArray(body.rows) ? body.rows : [];
        if (!alive.current) return;
        if (list.length) {
          setRows(list);
          setStatus("ready");
        } else {
          setStatus("empty");
        }
      } catch (e) {
        if (!alive.current) return;
        setError(
          e instanceof Error && /abort|timeout/i.test(e.message)
            ? "Search timed out — the DDL blogs are slow right now."
            : "Couldn't reach the Hindi DDL blogs."
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
  }, [type, tmdbId, title, year, imdbId, season, episode, reload]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => alive.current && setCopied(false), 1600);
  }, []);

  const openPlayer = useCallback((row: DdRow, url: string, server: string, stale: boolean) => {
    const saved = getResume(siteKey);
    const pos =
      saved && saved.positionSec > 10 &&
      (!saved.durationSec || saved.positionSec < saved.durationSec * 0.97)
        ? Math.floor(saved.positionSec)
        : 0;
    lastSent.current = pos;
    setPlayError(false);
    setPnote(stale ? "Link may be expired — trying anyway." : server ? `Playing via ${server}` : "");
    setPlayer({
      url,
      label: `${row.quality} · ${row.blog}${server ? ` · ${server}` : ""}`,
      filename: row.file,
      rowKey: row.key,
      startAt: pos,
      mountId: `${Date.now()}`,
    });
    setSent((s) => ({ ...s, [row.key]: true }));
  }, [siteKey]);

  /* tap -> hub page embedded -> the user generates the link there ->
   * capture script / location poll hands the file back -> site player */
  const play = useCallback((row: DdRow) => {
    if (!row.hub) return;
    fileTaken.current = false;
    setPlayer(null);
    setPlayError(false);
    setEmbed({ row, mode: "proxy" });
    setEmbedReady(false);
    setEmbedError("");
    setEmbedLeft(false);
    setPaste("");
    setAddr("");
    setNote((n) => ({ ...n, [row.key]: "Hub page open — generate the link, it auto-plays" }));
  }, []);

  const playFile = useCallback((row: DdRow, url: string, server: string) => {
    if (!alive.current || fileTaken.current) return;
    fileTaken.current = true;
    setEmbed(null);
    openPlayer(row, url, server, false);
    setNote((n) => ({ ...n, [row.key]: "Playing in the site player" }));
  }, [openPlayer]);

  const pickSource = useCallback(async (key: string): Promise<string | null> => {
    const row = rows.find((r) => r.key === key);
    if (!row || !alive.current) return null;
    play(row);
    return null;
  }, [rows, play]);

  /* hub capture script -> file */
  useEffect(() => {
    if (!embed) return;
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; url?: string; message?: string };
      if (!d || typeof d !== "object") return;
      if (d.type === "yetflix-file" && typeof d.url === "string" && d.url.startsWith("https://")) {
        const u = d.url;
        playFile(embed.row, u, guessServer(u));
      } else if (d.type === "yetflix-navigate" && typeof d.url === "string" && d.url.startsWith("/api/desiddl/embed?url=")) {
        try {
          iframeRef.current?.contentWindow?.location.replace(d.url);
        } catch {
          /* poll backstop covers it */
        }
      } else if (d.type === "yetflix-embed-left") {
        setEmbedLeft(true);
      } else if (d.type === "yetflix-embed-ready") {
        setEmbedReady(true);
      } else if (d.type === "yetflix-embed-error") {
        setEmbedReady(true);
        setEmbedError(d.message || "Couldn't load the hub page.");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [embed, playFile]);

  /* backstop: watch the iframe location for file / ?link= hops */
  useEffect(() => {
    if (!embed || embed.mode !== "proxy") return;
    let throws = 0;
    const id = setInterval(() => {
      const fr = iframeRef.current;
      if (!fr || !alive.current) return;
      try {
        const href = fr.contentWindow?.location.href || "";
        throws = 0;
        setEmbedLeft(false);
        try {
          const target = new URL(href).searchParams.get("url") || "";
          setAddr(target ? target.replace(/^https?:\/\//i, "").slice(0, 64) : "");
        } catch {
          /* keep last */
        }
        const found = extractFile(href);
        if (found) {
          clearInterval(id);
          playFile(embed.row, found, "Hub link");
        }
      } catch {
        if (++throws >= 4) {
          setEmbedLeft(true);
          setAddr("");
        }
      }
    }, 700);
    return () => clearInterval(id);
  }, [embed, playFile]);

  const goBack = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      /* cross-origin: nothing to go back to */
    }
  }, []);

  const goReload = useCallback(() => {
    if (!embed) return;
    if (embed.mode === "direct") {
      setFrameKey((k) => k + 1);
      return;
    }
    try {
      iframeRef.current?.contentWindow?.location.reload();
    } catch {
      setFrameKey((k) => k + 1);
    }
  }, [embed]);

  const playPasted = useCallback(() => {
    const u = paste.trim();
    if (!embed || !/^https:\/\//i.test(u)) return;
    playFile(embed.row, u, "Pasted link");
  }, [embed, paste, playFile]);

  const onSiteTime = useCallback((time: number, duration?: number) => {
    if (!alive.current || time < 5) return;
    if (duration && time > duration * 0.97) {
      clearResume(siteKey);
      lastSent.current = 0;
      return;
    }
    if (time - lastSent.current < 5) return;
    lastSent.current = time;
    saveResume(siteKey, time, duration);
  }, [siteKey]);

  const startOver = useCallback(() => {
    clearResume(siteKey);
    lastSent.current = 0;
    setPlayError(false);
    setPlayer((p) => p && { ...p, startAt: 0, mountId: `${Date.now()}` });
  }, [siteKey]);

  const vlcFromPlayer = useCallback(() => {
    if (!player) return;
    openInVlc(player.url).then((out) => {
      if (!alive.current) return;
      setSent((s) => ({ ...s, [player.rowKey]: out.ok }));
      setPnote(out.note);
    });
  }, [player]);

  const downloadFromPlayer = useCallback(() => {
    if (!player) return;
    downloadFile(player.url, player.filename);
    copy(player.url);
    setPnote("Download opened in a new tab (link also copied)");
  }, [player, copy]);

  const reportSource = useCallback(() => {
    if (!player) return;
    copy(
      `Yetflix report: ${type}/${tmdbId} s${season}e${episode}\nfile: ${player.filename}\nurl: ${player.url}`
    );
    setPnote("Report copied — send it to us and we'll fix the source");
  }, [player, type, tmdbId, season, episode, copy]);

  /* ── inbuilt player ── */
  if (player) {
    return (
      <div className="flex h-full flex-col bg-black">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2 text-[12px]">
          <button
            onClick={() => setPlayer(null)}
            className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-semibold text-neutral-200 hover:bg-white/20"
          >
            <ChevronIcon dir="left" className="h-3.5 w-3.5" /> Sources
          </button>
          <span className="min-w-0 flex-1 truncate text-neutral-400">{player.label}</span>
          <button
            onClick={vlcFromPlayer}
            className="rounded-full bg-brand px-2.5 py-1 font-bold text-white"
          >
            Open in VLC
          </button>
          <button
            onClick={downloadFromPlayer}
            className="rounded-full bg-white/10 px-2.5 py-1 font-semibold text-neutral-200 hover:bg-white/20"
          >
            Download
          </button>
          <button
            onClick={() => copy(player.url)}
            className="rounded-full bg-white/10 px-2.5 py-1 font-semibold text-neutral-200 hover:bg-white/20"
          >
            Copy link
          </button>
        </div>
        {player.startAt > 10 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[12px]">
            <span className="rounded-full bg-brand/20 px-2.5 py-0.5 font-semibold text-brand">
              Resumed from {fmtTime(player.startAt)}
            </span>
            <button onClick={startOver} className="text-neutral-400 hover:text-white">
              Start over
            </button>
          </div>
        )}
        {playError && (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[11.5px]">
            <span className="font-semibold text-amber-300">
              This browser can&apos;t play the file.
            </span>
            <button
              onClick={vlcFromPlayer}
              className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-white"
            >
              Open in VLC
            </button>
          </div>
        )}
        {pnote && !playError && (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11.5px] font-medium text-brand">
            {pnote}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <SitePlayer
            key={`${player.mountId}-${isHlsFile(player.url) ? "h" : "p"}`}
            mountId={player.mountId}
            url={player.url}
            title={player.filename}
            sources={rows.map((r) => ({
              key: r.key,
              quality: r.quality,
              size: r.size,
              source: `${r.blog} · ${r.source}`,
              file: r.file,
              audio: r.audio,
            }))}
            currentKey={player.rowKey}
            startAt={player.startAt}
            onPickSource={pickSource}
            onTimeupdate={onSiteTime}
            onError={() => alive.current && setPlayError(true)}
            onVlc={vlcFromPlayer}
            onDownload={downloadFromPlayer}
            onReport={reportSource}
          />
        </div>
        {copied && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black">
            Link copied
          </div>
        )}
      </div>
    );
  }

  /* ── hub embed: the user generates the link, it auto-plays ── */
  if (embed) {
    const src =
      embed.mode === "proxy"
        ? `/api/desiddl/embed?url=${encodeURIComponent(embed.row.hub)}`
        : embed.row.hub;
    return (
      <div className="flex h-full flex-col bg-black">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2 text-[12px]">
          <button
            onClick={() => setEmbed(null)}
            className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-semibold text-neutral-200 hover:bg-white/20"
          >
            <ChevronIcon dir="left" className="h-3.5 w-3.5" /> Sources
          </button>
          {embed.mode === "proxy" && (
            <button
              onClick={goBack}
              title="Back"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-200 hover:bg-white/20"
            >
              <ChevronIcon dir="left" className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={goReload}
            title="Reload"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-200 hover:bg-white/20"
          >
            <RotateCcwIcon className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-neutral-400">
            {embed.row.quality} · {embed.row.blog} · {embed.row.source}
            {embed.row.size ? ` · ${embed.row.size}` : ""}
          </span>
          <a
            href={embed.row.hub}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white/10 px-2.5 py-1 font-semibold text-neutral-200 hover:bg-white/20"
          >
            Open page
          </a>
        </div>
        {!embedReady && !embedError && (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11.5px] text-neutral-400">
            Loading the hub page — its Download buttons work right here, no popups.
          </div>
        )}
        {embedError && (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11.5px] font-medium text-amber-300">
            {embedError}{" "}
            {embed.mode === "proxy" ? (
              <button
                onClick={() => {
                  setEmbed({ row: embed.row, mode: "direct" });
                  setEmbedError("");
                  setEmbedReady(false);
                }}
                className="underline hover:text-amber-200"
              >
                Load the real hub page instead
              </button>
            ) : (
              "Open the page outside, generate the link, paste it below."
            )}
          </div>
        )}
        {embedLeft && !embedError && (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11.5px] font-medium text-amber-300">
            The hub jumped out of the embed — generate the link there, copy it, paste it below.
          </div>
        )}
        {embed.mode === "direct" && !embedError && (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11.5px] text-neutral-400">
            Our server can&apos;t reach this hub, so this is the raw page — generate the link,
            copy it, paste it below and it plays here.
          </div>
        )}
        {embed.mode === "proxy" && addr && (
          <div className="truncate border-b border-white/10 px-3 py-1 font-mono text-[10.5px] text-neutral-500">
            {addr}
          </div>
        )}
        <div className="min-h-0 flex-1 bg-white">
          <iframe
            ref={iframeRef}
            key={`${embed.mode}-${embed.row.key}-${frameKey}`}
            src={src}
            title="Hub page — generate the download link here"
            sandbox="allow-scripts allow-same-origin allow-forms"
            allow="autoplay; encrypted-media; fullscreen"
            className="h-full w-full border-0"
            onLoad={() => setEmbedReady(true)}
          />
        </div>
        <div className="flex items-center gap-1.5 border-t border-white/10 px-3 py-2">
          <input
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && playPasted()}
            placeholder="…or paste a hub link here"
            inputMode="url"
            className="min-w-0 flex-1 rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white outline-none placeholder:text-neutral-500 focus:bg-white/15"
          />
          <button
            onClick={playPasted}
            className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-bold text-white"
          >
            Play
          </button>
        </div>
        {copied && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black">
            Link copied
          </div>
        )}
      </div>
    );
  }

  /* ── source list ── */
  return (
    <div className="relative flex h-full flex-col bg-black">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-[13px] font-bold">🇮🇳 Desi DDL</span>
        {status === "ready" && (
          <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-semibold text-brand">
            {rows.length} found
          </span>
        )}
        <span className="hidden min-w-0 flex-1 truncate text-[11.5px] text-neutral-500 sm:block">
          {hint}
        </span>
        {isPhone && (
          <a
            href="https://www.videolan.org/vlc/"
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
          >
            Get VLC
          </a>
        )}
        <button
          onClick={() => setReload((r) => r + 1)}
          title="Search again"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
        >
          <RotateCcwIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {isPcWeb && (
        <div className="border-b border-white/10 px-3 py-1.5 text-[11px] text-neutral-500">
          Tip: install the Yetflix desktop app — sources then open in VLC with one tap, no
          downloads.
        </div>
      )}

      <div className="styled-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
        {status === "loading" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-brand" />
            <p className="text-[13px] font-semibold">
              {LOAD_LINES[Math.min(tick, LOAD_LINES.length - 1)]}
            </p>
            <p className="max-w-xs text-[11.5px] text-neutral-500">
              Live search across the DDL blogs — first load can take up to a minute.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="text-3xl">📡</span>
            <p className="text-[13px] font-bold">{error}</p>
            <button
              onClick={() => setReload((r) => r + 1)}
              className="mt-1 rounded-full bg-brand px-4 py-1.5 text-[12px] font-bold text-white"
            >
              Retry
            </button>
          </div>
        )}

        {status === "empty" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="text-3xl">📼</span>
            <p className="text-[13px] font-bold">No DDL posts for this title yet</p>
            <p className="max-w-xs text-[11.5px] text-neutral-400">
              New and cam releases are often missing here — try a Server above, or check back
              later.
            </p>
          </div>
        )}

        {rows.map((row) => (
          <div
            key={row.key}
            onClick={() => play(row)}
            className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-white/5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white">
              {sent[row.key] ? (
                <CheckIcon className="h-4 w-4" />
              ) : (
                <PlayIcon className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] font-semibold">
                <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[11px] text-brand">
                  {row.blog}
                </span>
                {row.quality && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
                    {row.quality}
                  </span>
                )}
                {row.size && <span className="text-neutral-300">{row.size}</span>}
                {row.source && (
                  <span className="truncate font-normal text-neutral-400">{row.source}</span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[11.5px] text-neutral-500">
                {row.audio ? `${row.audio} · ` : ""}
                {row.file}
              </span>
              {note[row.key] && (
                <span className="mt-0.5 block text-[11.5px] font-medium text-brand">
                  {note[row.key]}
                </span>
              )}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copy(row.hub);
              }}
              title="Copy hub link"
              className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
            >
              Copy
            </button>
          </div>
        ))}
      </div>

      {copied && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black">
          Link copied
        </div>
      )}
    </div>
  );
}
