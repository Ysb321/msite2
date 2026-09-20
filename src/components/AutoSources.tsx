"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchWsStreams,
  resolveWsUrl,
  openInVlc,
  downloadFile,
  parseStream,
  wsIds,
  type WsRow,
} from "@/lib/vlc";
import { fmtTime } from "@/lib/player";
import { getResume, saveResume, clearResume, resumeKeyFor } from "@/lib/storage";
import SmartPlayer, { streamKind } from "@/components/SmartPlayer";
import { RotateCcwIcon } from "@/components/Icons";

type Props = {
  type: "movie" | "tv";
  tmdbId: string;
  imdbId: string | null;
  season: number;
  episode: number;
};

type Phase = "search" | "resolve" | "play" | "empty" | "dead";

const SEARCH_LINES = [
  "Contacting WebStreamr sources…",
  "Searching 20+ sites (HubCloud, HDHub4u, 4KHDHub…)…",
  "Still searching — big libraries take up to a minute…",
  "Almost there — ranking the best link…",
];

/* release-name hints that the browser probably can't decode (silent audio
 * or black screen) - ranked down, never blocked */
const NEEDS_VLC_HINT = /x265|hevc|h\.?265|ddp|dts|truehd|atmos/i;

function rankRows(rows: WsRow[]): WsRow[] {
  const score = (r: WsRow) => {
    let s = 0;
    if (r.fileUrl) s += 100;
    else if (!r.pageUrl) s -= 1000;
    const a = (r.audio || "").toLowerCase();
    if (/hindi|dual|multi/.test(a)) s += 30;
    else if (/tamil|telugu/.test(a)) s += 10;
    const q = (r.quality || "").toLowerCase();
    if (q.includes("1080")) s += 20;
    else if (q.includes("720")) s += 15;
    else if (q.includes("480")) s += 8;
    else if (q.includes("2160") || q.includes("4k")) s += 5;
    if (NEEDS_VLC_HINT.test(r.file)) s -= 12;
    if (/\.mkv/i.test(r.file)) s -= 4;
    return s;
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}

type PlayerState = {
  url: string;
  label: string;
  filename: string;
  rowKey: string;
  startAt: number;
  mountId: string;
};

const labelFor = (row: WsRow) =>
  row.quality ? `${row.quality} · ${row.source || row.file}` : row.source || row.file;

/* AutoPlay lane: WebStreamr with zero taps - searches the addon, ranks
 * the rows (direct-file first, Hindi/dual bonus, browser-friendly
 * codecs first), resolves and plays the best in SmartPlayer, and
 * auto-advances to the next candidate on dead links or playback
 * errors. The in-player source panel stays as the manual override. */
export default function AutoSources({ type, tmdbId, imdbId, season, episode }: Props) {
  const [phase, setPhase] = useState<Phase>("search");
  const [rows, setRows] = useState<WsRow[]>([]);
  const [status, setStatus] = useState("");
  const [tick, setTick] = useState(0);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [pages, setPages] = useState<{ key: string; label: string; url: string }[]>([]);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const alive = useRef(true);
  const runId = useRef(0);
  const orderRef = useRef<WsRow[]>([]);
  const triedRef = useRef<Set<string>>(new Set());
  const posRef = useRef(0);

  const siteKey = `${resumeKeyFor(type, tmdbId, season, episode)}:site-auto`;

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

  const playRow = useCallback(async (row: WsRow, run: number): Promise<boolean> => {
    if (!alive.current || run !== runId.current) return false;
    triedRef.current.add(row.key);
    const n = triedRef.current.size;
    const total = orderRef.current.length;
    setPhase("resolve");
    setStatus(
      `Generating best link — trying ${row.quality || "file"} · ${row.source || "source"} (${n}/${total})…`
    );
    try {
      const r = await resolveWsUrl(row.fileUrl || row.pageUrl || "");
      if (!alive.current || run !== runId.current) return false;
      if (r.ok && r.kind === "file") {
        const pos = posRef.current > 10 ? Math.floor(posRef.current) : 0;
        setPlayer({
          url: r.url,
          label: labelFor(row),
          filename: row.file,
          rowKey: row.key,
          startAt: pos,
          mountId: `${Date.now()}`,
        });
        setNote(r.stale ? "Link may be expired — trying anyway." : "");
        setPhase("play");
        return true;
      }
      if (r.ok) {
        setPages((p) =>
          p.some((x) => x.key === row.key)
            ? p
            : [...p, { key: row.key, label: labelFor(row), url: r.url }]
        );
      }
    } catch {}
    return false;
  }, []);

  const advance = useCallback(async (run: number) => {
    for (const row of orderRef.current) {
      if (triedRef.current.has(row.key)) continue;
      if (!alive.current || run !== runId.current) return;
      if (await playRow(row, run)) return;
    }
    if (alive.current && run === runId.current) setPhase("dead");
  }, [playRow]);

  /* search once per title (IMDb first when TMDB knows it), then auto-play */
  useEffect(() => {
    alive.current = true;
    const run = ++runId.current;
    triedRef.current = new Set();
    orderRef.current = [];
    setPages([]);
    setNote("");
    setPlayer(null);
    setRows([]);
    setPhase("search");
    setStatus("");
    setTick(0);
    const saved = getResume(siteKey);
    posRef.current =
      saved && saved.positionSec > 10 &&
      (!saved.durationSec || saved.positionSec < saved.durationSec * 0.97)
        ? Math.floor(saved.positionSec)
        : 0;
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(new Error("timeout")), 105000);
    const clock = setInterval(() => setTick((t) => t + 1), 9000);
    (async () => {
      try {
        const kind = type === "movie" ? "movie" : "series";
        let found: WsRow[] = [];
        let threw: unknown = null;
        for (const sid of wsIds(type, tmdbId, imdbId, season, episode)) {
          try {
            const list = await fetchWsStreams(kind, sid, ctrl.signal);
            if (!alive.current || run !== runId.current) return;
            const parsed = list.map(parseStream).filter((r) => r.fileUrl || r.pageUrl);
            if (parsed.length) {
              found = parsed;
              break;
            }
          } catch (e) {
            if (!alive.current || ctrl.signal.aborted || run !== runId.current) return;
            threw = e;
          }
        }
        if (!alive.current || run !== runId.current) return;
        if (!found.length) {
          if (threw) throw threw;
          setPhase("empty");
          return;
        }
        const ranked = rankRows(found);
        orderRef.current = ranked;
        setRows(ranked);
        await advance(run);
      } catch (e) {
        if (!alive.current || run !== runId.current) return;
        setNote(
          e instanceof Error && /abort|timeout/i.test(e.message)
            ? "Search timed out — the source sites are slow right now."
            : "Couldn't reach the sources."
        );
        setPhase("dead");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, tmdbId, imdbId, season, episode, retryKey]);

  /* in-player source hop (manual override): resolve, then seamless-switch */
  const pickSource = useCallback(async (key: string): Promise<string | null> => {
    const row = rows.find((r) => r.key === key);
    const target = row?.fileUrl || row?.pageUrl;
    if (!row || !target) return null;
    try {
      const r = await resolveWsUrl(target);
      if (!alive.current) return null;
      if (r.ok && r.kind === "file") {
        triedRef.current.add(row.key);
        const pos = posRef.current > 10 ? Math.floor(posRef.current) : 0;
        setNote(r.stale ? "Link may be expired — trying anyway." : "");
        setPlayer((p) =>
          p && {
            ...p,
            url: r.url,
            label: labelFor(row),
            filename: row.file,
            rowKey: row.key,
            startAt: pos,
          }
        );
        return r.url;
      }
      if (r.ok) {
        setPages((p) =>
          p.some((x) => x.key === row.key)
            ? p
            : [...p, { key: row.key, label: labelFor(row), url: r.url }]
        );
        setNote("That source needs a browser — trying another instead.");
        advance(runId.current);
        return null;
      }
      setNote("Couldn't load that source — trying another instead.");
      advance(runId.current);
      return null;
    } catch {
      return null;
    }
  }, [rows, advance]);

  /* playback error: auto-advance while candidates remain */
  const onPlayerError = useCallback(() => {
    if (!alive.current) return;
    const left = orderRef.current.some((r) => !triedRef.current.has(r.key));
    if (left) {
      setNote("This file won't play here — trying the next source…");
      advance(runId.current);
    } else {
      setNote("None of the sources played in this browser — VLC can still play them.");
      setPhase("dead");
    }
  }, [advance]);

  const onSiteTime = useCallback((time: number, duration?: number) => {
    if (!alive.current || time < 5) return;
    posRef.current = time;
    if (duration && time > duration * 0.97) {
      clearResume(siteKey);
      posRef.current = 0;
      return;
    }
    saveResume(siteKey, time, duration);
  }, [siteKey]);

  const nextSource = useCallback(() => {
    const left = orderRef.current.some((r) => !triedRef.current.has(r.key));
    if (!left) {
      setNote(`All ${orderRef.current.length} sources tried — this is the last one.`);
      return;
    }
    advance(runId.current);
  }, [advance]);

  const startOver = useCallback(() => {
    clearResume(siteKey);
    posRef.current = 0;
    setPlayer((p) => p && { ...p, startAt: 0, mountId: `${Date.now()}` });
  }, [siteKey]);

  const vlcFromPlayer = useCallback(() => {
    if (!player) return;
    openInVlc(player.url).then((out) => {
      if (!alive.current) return;
      setNote(out.note);
    });
  }, [player]);

  const downloadFromPlayer = useCallback(() => {
    if (!player) return;
    downloadFile(player.url, player.filename);
    copy(player.url);
    setNote("Download opened in a new tab (link also copied)");
  }, [player, copy]);

  const reportSource = useCallback(() => {
    if (!player) return;
    copy(
      `Yetflix report: ${type}/${tmdbId} s${season}e${episode}\nfile: ${player.filename}\nurl: ${player.url}`
    );
    setNote("Report copied — send it to us and we'll fix the source");
  }, [player, type, tmdbId, season, episode, copy]);

  /* ── playing ── */
  if (phase === "play" && player) {
    const codecHint = NEEDS_VLC_HINT.test(player.filename);
    return (
      <div className="flex h-full flex-col bg-black">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2 text-[12px]">
          <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-bold text-brand">
            Auto
          </span>
          <span className="min-w-0 flex-1 truncate text-neutral-400">{player.label}</span>
          <button
            onClick={nextSource}
            className="rounded-full bg-white/10 px-2.5 py-1 font-semibold text-neutral-200 hover:bg-white/20"
          >
            Next source
          </button>
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
        {codecHint && (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11px] text-neutral-500">
            HEVC/Dolby file — if there&apos;s no picture or no sound, use Open in VLC.
          </div>
        )}
        {note && (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11.5px] font-medium text-brand">
            {note}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <SmartPlayer
            key={`${player.mountId}-${streamKind(player.url)}`}
            mountId={player.mountId}
            url={player.url}
            title={player.filename}
            sources={rows.map((r) => ({
              key: r.key,
              quality: r.quality,
              size: r.size,
              source: r.source,
              file: r.file,
              audio: r.audio,
            }))}
            currentKey={player.rowKey}
            startAt={player.startAt}
            onPickSource={pickSource}
            onTimeupdate={onSiteTime}
            onError={onPlayerError}
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

  /* ── searching / resolving ── */
  if (phase === "search" || phase === "resolve") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-black px-6 text-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-brand" />
        <p className="text-[13px] font-semibold">
          {phase === "search" ? SEARCH_LINES[Math.min(tick, SEARCH_LINES.length - 1)] : status}
        </p>
        <p className="max-w-xs text-[11.5px] text-neutral-500">
          {phase === "search"
            ? "Live search across the source sites — first load can take up to a minute."
            : "Picking the best working link automatically — no taps needed."}
        </p>
      </div>
    );
  }

  /* ── empty / dead ── */
  return (
    <div className="relative flex h-full flex-col bg-black">
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="text-3xl">{phase === "empty" ? "📼" : "📡"}</span>
        <p className="text-[13px] font-bold">
          {phase === "empty" ? "No auto sources for this title yet" : note || "All sources failed"}
        </p>
        <p className="max-w-xs text-[11.5px] text-neutral-400">
          {phase === "empty"
            ? "New and cam releases are often missing here — try a Server above, or check back later."
            : "Every source was tried automatically — retry, or open a page link below."}
        </p>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="mt-1 flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-[12px] font-bold text-white"
        >
          <RotateCcwIcon className="h-3.5 w-3.5" /> Retry
        </button>
        {pages.length > 0 && (
          <div className="styled-scroll mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
            {pages.slice(0, 6).map((p) => (
              <span key={p.key} className="flex items-center gap-1.5 text-[11.5px]">
                <span className="max-w-[220px] truncate text-neutral-400">{p.label}</span>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-white/10 px-2.5 py-1 font-semibold text-neutral-200 hover:bg-white/20"
                >
                  Open page
                </a>
              </span>
            ))}
          </div>
        )}
      </div>
      {copied && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black">
          Link copied
        </div>
      )}
    </div>
  );
}
