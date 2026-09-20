"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  fmtSize,
  openInVlc,
  downloadFile,
  isDesktopVlc,
  isAndroid,
  isIOS,
  playableInBrowser,
  resolveWsUrl,
} from "@/lib/vlc";
import { fmtTime } from "@/lib/player";
import { getResume, saveResume, clearResume, resumeKeyFor } from "@/lib/storage";
import SitePlayer from "@/components/SitePlayer";
import { PlayIcon, RotateCcwIcon, CheckIcon, ChevronIcon, XIcon } from "@/components/Icons";

type Props = {
  type: "movie" | "tv";
  tmdbId: string;
  title: string;
  season: number;
  episode: number;
  /** SitePlayer skin - "netmirror" renders their ArtPlayer config */
  playerVariant?: "netmirror";
  /** stream endpoint root (default /api/netmirror/stream) */
  endpoint?: string;
  /** sources header label (default Hindi sources) */
  laneTitle?: string;
  /** resume namespace suffix (default site-nm - different encodes!) */
  resumeSuffix?: string;
  /** empty-state hint override */
  emptyHint?: string;
  /** loading-lines override (default: OTT lines) */
  loadLines?: string[];
  /** hide the NetMirror site-player button (non-NetMirror lanes) */
  hideSiteLink?: boolean;
  /** release year, forwarded as &year= for title matching */
  year?: string;
  /** IMDb ID (tt1234567), forwarded as &imdb= for title matching */
  imdbId?: string;
  /** original-language title, forwarded as &ot= for title matching (M2Box) */
  otTitle?: string;
  /** Server 24 presentation: sources open in a modern modal overlay instead of
   *  inline; page/generator links (HubCloud ?id=…) are resolved to direct files
   *  before VLC/download (VLC cannot play HTML pages); every row gets a
   *  Download button. Other lanes keep the classic inline list. */
  modal?: boolean;
};

type Status = "loading" | "ready" | "empty" | "error";

type NmRow = {
  key: string;
  quality: string;
  size: string;
  source: string;
  file: string;
  audio: string;
  url: string;
  lang: string;
};

type NmCaption = { lang: string; name: string; url: string };

const LOAD_LINES = [
  "Contacting Indian OTT sources…",
  "Searching Netflix · Hotstar · Prime · Disney…",
  "Still searching — the source sites are slow right now…",
  "Almost there — signing the stream urls…",
];

const isHlsFile = (u: string) => /\.m3u8(\?|#|$)/i.test(u);

/** player language label: Hindi rows get the 🇮🇳 prefix, others raw */
const langLabel = (raw?: string) => {
  const t = (raw || "").trim();
  if (!t) return "";
  return /hindi/i.test(t) ? `🇮🇳 ${t}` : t;
};

/* Parse an addon stream row into display fields (link type, size, quality,
 * audio flag). Pure and shared by every HindiSources lane AND the HDHub
 * browser-direct fallback, so the row labels can never drift apart again. */
export const parseStreamInfo = (description: string, name: string) => {
  const desc = description || "";
  const nameStr = name || "";

  // Extract link type: FSLv2, FSL, PixelDrain, HubDrive, 10Gbps, HubCloud, 4KHDHub, etc.
  let linkType = "Direct";
  if (desc.includes("FSLv2")) linkType = "FSLv2";
  else if (desc.includes("FSL")) linkType = "FSL";
  else if (desc.includes("PixelDrain") || desc.includes("pixeldrain")) linkType = "Pixeldrain";
  else if (desc.includes("HubDrive")) linkType = "HubDrive";
  else if (desc.includes("10Gbps")) linkType = "10Gbps";
  else if (desc.includes("HubCloud")) linkType = "HubCloud";
  else if (desc.includes("4KHDHub")) linkType = "4KHDHub";
  else if (nameStr.includes("4KHDHub")) linkType = "4KHDHub";
  else if (desc.includes("[HDHub]")) linkType = "HDHub";
  else if (desc.includes("[WebStreamr]")) linkType = "WebStreamr";

  // Extract size from description
  let sizeStr = "Unknown";
  const sizeMatch = desc.match(/💾\s*([\d.]+)\s*(GB|MB)/i);
  if (sizeMatch) {
    sizeStr = `${sizeMatch[1]} ${sizeMatch[2]}`;
  }

  // Extract quality from name, falling back to the description (HDHub
  // puts the real resolution there while names say "4KHDHub 4K")
  let quality = "Auto";
  const qualityMatch = nameStr.match(/(\d{3,4})p/i) || desc.match(/(\d{3,4})p/i);
  if (qualityMatch) {
    quality = qualityMatch[1] + "p";
  }

  // Extract audio language from description
  let audioLang = "";
  if (desc.toLowerCase().includes("hindi")) audioLang = "🇮🇳";
  else if (desc.toLowerCase().includes("tamil")) audioLang = "🇹🇦";
  else if (desc.toLowerCase().includes("telugu")) audioLang = "🇮🇳";
  else if (desc.toLowerCase().includes("english")) audioLang = "🇬🇧";

  // Build source label: linkType + quality + size + audio
  const sourceParts = [linkType];
  if (quality && quality !== "Auto") sourceParts.push(quality);
  if (sizeStr && sizeStr !== "Unknown") sourceParts.push(sizeStr);
  if (audioLang) sourceParts.push(audioLang);
  const source = sourceParts.join(" ");

  return { linkType, size: sizeStr, quality, source, audioLang };
};

/* Display order for addon rows: Hindi first, then quality descending
 * ("2160p" -> 2160; "Auto"/unparsable sorts last). Used by the HDHub
 * browser-direct fallback so it matches the server path's ordering. */
export const addonRowSort = (a: NmRow, b: NmRow) => {
  const aHi = /hindi/i.test(a.source) ? 0 : 1;
  const bHi = /hindi/i.test(b.source) ? 0 : 1;
  if (aHi !== bHi) return aHi - bHi;
  return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
};

/* Page links (HubCloud/HubDrive ?id=… generators, GDFlix file pages) are HTML,
 * not media — VLC cannot play them and browsers would just show the site.
 * Resolve through the Server 9 resolver (follows generator redirects, scrapes
 * the direct file, probes liveness) to a real media url first. Direct media
 * urls pass through untouched. */
const PAGE_LINK = /\?[&]?(id|link|url)=|\/[a-z0-9]{8,}\/?($|\?)|hubdrive\.pics\/file\//i;
/* hosts that serve the actual bytes directly — never generators, never resolve */
const DIRECT_HOST = /(^|\.)(pixeldrain\.dev|pixeldrain\.com|r2\.dev|cloudflarestorage\.com|googleusercontent\.com|googlevideo\.com|dropboxusercontent\.com|gofile\.io)$/i;
export const needsResolve = (u: string) => {
  if (!/^https?:\/\//i.test(u)) return false;
  if (playableInBrowser(u)) return false;
  try {
    if (DIRECT_HOST.test(new URL(u).hostname)) return false;
  } catch {
    return false;
  }
  return PAGE_LINK.test(u) || !/\.(mkv|mp4|webm|m4v|mov|avi|m3u8|mpd)(\?|#|$)/i.test(u);
};

const resolveRowUrl = async (
  url: string
): Promise<{ ok: boolean; url: string; note: string }> => {
  if (!needsResolve(url)) return { ok: true, url, note: "" };
  const r = await resolveWsUrl(url);
  if (r.ok && r.kind === "file")
    return { ok: true, url: r.url, note: r.stale ? "Link may be stale — VLC will try anyway" : "" };
  if (r.ok && r.kind === "page")
    return { ok: false, url: r.url, note: "Couldn't auto-resolve — download page opened in a new tab instead" };
  return { ok: false, url, note: "Couldn't resolve this link right now — try another one" };
};

const platformHint = () =>
  isDesktopVlc()
    ? "Tap a quality — it plays here, or opens in VLC"
    : isAndroid() || isIOS()
      ? "Tap a quality — it plays here, or opens in your VLC app"
      : "Tap a quality — it plays here, or opens in VLC via the desktop app";

/* Server 10 (NetMirror) - the Hindi-OTT lane: direct signed mp4s, no
 * link generation needed, so taps play instantly. Subtitle tracks ride
 * along (Hindi auto-loads). Resume key is namespaced (:site-nm) so it
 * never collides with Server 9's (:site) - different encodes. */
export default function HindiSources({
  type,
  tmdbId,
  title,
  season,
  episode,
  playerVariant,
  endpoint,
  laneTitle,
  resumeSuffix,
  emptyHint,
  loadLines,
  hideSiteLink,
  year,
  imdbId,
  otTitle,
  modal,
}: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [rows, setRows] = useState<NmRow[]>([]);
  const [captions, setCaptions] = useState<NmCaption[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
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
  /* Server 24 modal presentation + resolved-link cache (page link -> direct file) */
  const [showModal, setShowModal] = useState(false);
  const resolvedRef = useRef<Map<string, { ok: boolean; url: string; note: string }>>(new Map());
  /* HDHub generator tokens are one-time and the addon caches manifests, so a
   * cached link can be dead by the time it's tapped. First dead tap silently
   * re-queries the addon (fresh tokens) and shows a short banner. */
  const [staleNote, setStaleNote] = useState(false);
  const staleRefreshed = useRef(false);
  const alive = useRef(true);
  const lastSent = useRef(0);
  const [hint] = useState(platformHint);
  const [isPcWeb] = useState(() => !isDesktopVlc() && !isAndroid() && !isIOS());
  const [isPhone] = useState(() => isAndroid() || isIOS());
  /* portal guard: document.body doesn't exist during SSR prerender */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const siteKey = `${resumeKeyFor(type, tmdbId, season, episode)}:${resumeSuffix || "site-nm"}`;

  useEffect(() => {
    alive.current = true;
    setStatus("loading");
    setRows([]);
    setCaptions([]);
    setError("");
    setAdding(false);
    setTick(0);
    resolvedRef.current.clear(); // fresh search -> drop stale resolved links
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(new Error("timeout")), 90000);
    const clock = setInterval(() => setTick((n) => n + 1), 9000);
    (async () => {
      try {
        const kind = type === "movie" ? "movie" : "series";
        const id = type === "movie" ? tmdbId : `${tmdbId}:${season}:${episode}`;
        const res = await fetch(
          `${endpoint || "/api/netmirror/stream"}/${kind}/${id}?title=${encodeURIComponent(title)}${year ? `&year=${encodeURIComponent(year)}` : ""}${imdbId ? `&imdb=${encodeURIComponent(imdbId)}` : ""}${otTitle ? `&ot=${encodeURIComponent(otTitle)}` : ""}`,
          { signal: ctrl.signal }
        );
        if (!alive.current) return;
        if (!res.ok) throw new Error(`netmirror ${res.status}`);
        const body = await res.json();
        if (typeof body.laneError === "string" && body.laneError) {
          if (!alive.current) return;
          if (typeof body.diag === "string" && body.diag)
            console.warn("[netmirror]", body.diag.slice(0, 400));
          // HDHub lane only: the addon blocked OUR SERVER (e.g. Cloudflare 403
          // on the datacenter IP). hdhub.thevolecitor.qzz.io sends
          // access-control-allow-origin: *, so retry DIRECTLY from this
          // browser — the visitor's own IP passes. Same proxy-first /
          // direct-fallback idea as the TMDB lane. Other lanes don't send
          // fallbackUrl and skip this entirely.
          if (body.hdhubFailed === true && typeof body.fallbackUrl === "string" && body.fallbackUrl) {
            try {
              const fb = await fetch(body.fallbackUrl, {
                signal: ctrl.signal,
                headers: { accept: "application/json" },
              });
              const fdata = fb.ok ? await fb.json() : null;
              const seen = new Set<string>();
              const usable = (Array.isArray(fdata?.streams) ? fdata.streams : []).filter((s: any) => {
                if (!s || !s.url || s.externalUrl || !s.name) return false;
                if (String(s.name).includes("Donation") || String(s.name).includes("Discord")) return false;
                if (seen.has(s.url)) return false;
                seen.add(s.url);
                return true;
              });
              if (alive.current && usable.length) {
                console.info("[hdhub] server blocked by addon; browser-direct fallback ok");
                const parsedFb: NmRow[] = usable.map((s: any, i: number) => {
                  const info = parseStreamInfo(String(s.description || ""), String(s.name || ""));
                  return {
                    key: `hdhub-fb-${i}`,
                    quality: info.quality,
                    size: info.size,
                    source: info.source,
                    file: title,
                    audio: info.audioLang,
                    url: s.url,
                    lang: langLabel(s.lang),
                  };
                });
                // Same ordering contract as the server path: Hindi rows first,
                // then quality descending.
                parsedFb.sort(addonRowSort);
                setRows(parsedFb);
                setStatus("ready");
                return;
              }
            } catch {
              /* addon unreachable from the browser too — fall through to the error */
            }
            if (!alive.current) return;
          }
          setError(body.laneError.slice(0, 160));
          setStatus("error");
          return;
        }
        setAdding(body.noSource === true);
        const streams = Array.isArray(body.streams) ? body.streams : [];
        const caps: NmCaption[] = Array.isArray(body.captions) ? body.captions : [];
        const label = typeof body.title === "string" && body.title ? body.title : title;
        const hasHi = caps.some((c) => c.lang.toLowerCase().startsWith("hi"));
        
        const parsed: NmRow[] = streams
          .filter((s: { url?: string; description?: string; name?: string }) => s && s.url)
          .map((s: { quality?: string; size?: number; url: string; platform?: string; lang?: string; description?: string; name?: string }, i: number) => {
            const { source, quality, size, audioLang } = parseStreamInfo(s.description || "", s.name || "");
            return {
              key: `${source.replace(/\s+/g, "-").toLowerCase()}-${i}`,
              quality: quality,
              size: size,
              source: source,
              file: label,
              audio: audioLang || (hasHi ? "🇮🇳 हिन्दी CC" : caps.length ? "CC" : ""),
              url: s.url,
              lang: langLabel(s.lang),
            };
          });
        if (!alive.current) return;
        if (parsed.length) {
          setRows(parsed);
          setCaptions(caps);
          setStatus("ready");
        } else {
          setStatus("empty");
        }
      } catch (e) {
        if (!alive.current) return;
        setError(
          e instanceof Error && /abort|timeout/i.test(e.message)
            ? "Search timed out — the OTT sources are slow right now."
            : "Couldn't reach the Hindi sources."
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
  }, [type, tmdbId, title, season, episode, reload]);

  /* Server 24 modal: pop the sources modal open as soon as rows land */
  useEffect(() => {
    if (modal && status === "ready") setShowModal(true);
  }, [modal, status]);

  /* lock page scroll while the modal is up */
  useEffect(() => {
    if (!modal || !showModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [modal, showModal]);

  /* close on Escape (same convention as the CardPreview overlay) */
  useEffect(() => {
    if (!modal || !showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, showModal]);

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

  /* Resolve a row's url (cached per row): page/generator links become direct
   * files, direct media passes through. Shared by play/VLC/download so VLC
   * never receives an HTML page (it cannot play those — the reported bug). */
  const rowUrl = useCallback(async (row: NmRow): Promise<{ url: string; ok: boolean; note: string }> => {
    const cached = resolvedRef.current.get(row.key);
    if (cached) return cached;
    const r = await resolveRowUrl(row.url);
    resolvedRef.current.set(row.key, r);
    return r;
  }, []);

  const play = useCallback(async (row: NmRow) => {
    if (!row.url || busy) return;
    setBusy(row.key);
    try {
      const saved = getResume(siteKey);
      const pos =
        saved && saved.positionSec > 10 &&
        (!saved.durationSec || saved.positionSec < saved.durationSec * 0.97)
          ? Math.floor(saved.positionSec)
          : 0;
      lastSent.current = pos;
      setPlayError(false);
      setPnote("");

      const { url, ok, note } = await rowUrl(row);
      if (!alive.current) return;
      if (note) setPnote(note);
      if (!ok) {
        /* unresolvable page: the generator token is usually spent (the addon
         * caches manifests) — silently refresh the links once, then the next
         * tap plays. After that, fall back to opening the page (mirrors
         * Server 9's kind:page handling). */
        if (modal && !staleRefreshed.current) {
          staleRefreshed.current = true;
          setStaleNote(true);
          setTimeout(() => alive.current && setStaleNote(false), 8000);
          setReload((r) => r + 1); // re-runs the search effect -> fresh tokens
          return;
        }
        try { window.open(url, "_blank", "noreferrer"); } catch {}
        setSent((s) => ({ ...s, [row.key]: false }));
        return;
      }

      // Check if playable in browser - if not, trigger VLC with the DIRECT url
      if (!playableInBrowser(url)) {
        const out = await openInVlc(url);
        if (!alive.current) return;
        setSent((s) => ({ ...s, [row.key]: out.ok }));
        if (out.note) setPnote(out.note);
        return;
      }

      if (modal) setShowModal(false); // hand the pane to the player
      setPlayer({
        url,
        label: `${row.quality} · ${row.source}`,
        filename: row.file,
        rowKey: row.key,
        startAt: pos,
        mountId: `${Date.now()}`,
      });
      setSent((s) => ({ ...s, [row.key]: true }));
    } finally {
      if (alive.current) setBusy(null);
    }
  }, [busy, siteKey, rowUrl, modal]);

  /* per-row download: resolve page links first, then hand the file to the
   * browser (link also copied — cross-origin downloads open a tab). A dead
   * generator token also triggers the one-shot silent refresh. */
  const downloadRow = useCallback(
    async (row: NmRow) => {
      if (!row.url || busy) return;
      setBusy(row.key);
      try {
        const { url, ok } = await rowUrl(row);
        if (!alive.current) return;
        if (!ok) {
          if (modal && !staleRefreshed.current) {
            staleRefreshed.current = true;
            setStaleNote(true);
            setTimeout(() => alive.current && setStaleNote(false), 8000);
            setReload((r) => r + 1); // re-runs the search effect -> fresh tokens
            return;
          }
          try { window.open(url, "_blank", "noreferrer"); } catch {}
          return;
        }
        downloadFile(url, `${title} ${row.quality}`.trim() || "video");
        copy(url);
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [busy, title, copy, rowUrl, modal]
  );

  /* in-player quality hop: resolve the picked row exactly like a fresh tap
   * (same !ok handling — a dead token triggers the one-shot refresh instead
   * of installing an unplayable page url) */
  const pickSource = useCallback(
    async (key: string): Promise<string | null> => {
      const row = rows.find((r) => r.key === key);
      if (!row || !alive.current) return null;
      setPlayError(false);
      const { url, ok, note } = await rowUrl(row);
      if (!alive.current) return null;
      if (!ok) {
        if (modal && !staleRefreshed.current) {
          staleRefreshed.current = true;
          setStaleNote(true);
          setTimeout(() => alive.current && setStaleNote(false), 8000);
          setPnote("Link expired — fetching fresh ones from HDHub…");
          setReload((r) => r + 1); // re-runs the search effect -> fresh tokens
          return null;
        }
        if (note) setPnote(note);
        return null;
      }
      setPlayer((p) =>
        p && { ...p, url, label: `${row.quality} · ${row.source}`, filename: row.file, rowKey: row.key }
      );
      return url;
    },
    [rows, rowUrl, modal]
  );

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
            onClick={() => {
              setPlayer(null);
              if (modal) setShowModal(true); // back to the sources modal
            }}
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
            variant={playerVariant}
            url={player.url}
            title={player.filename}
            sources={rows.map((r) => ({
              key: r.key,
              quality: r.quality,
              size: r.size,
              source: r.source,
              file: r.file,
              audio: r.audio,
              lang: r.lang,
            }))}
            currentKey={player.rowKey}
            startAt={player.startAt}
            subtitles={captions}
            showAudio
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

  /* ── source rows (shared by the inline list and the Server 24 modal) ── */
  const list = (
    <div className="styled-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
      {status === "loading" && (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-brand" />
          <p className="text-[13px] font-semibold">
            {(loadLines || LOAD_LINES)[Math.min(tick, (loadLines || LOAD_LINES).length - 1)]}
          </p>
          <p className="max-w-xs text-[11.5px] text-neutral-500">
            Live search across the sources — first load can take up to a minute.
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
          <p className="text-[13px] font-bold">
            {adding
              ? "Still being added — check back soon"
              : laneTitle
                ? "No sources for this title yet"
                : "No Hindi sources for this title yet"}
          </p>
          <p className="max-w-xs text-[11.5px] text-neutral-400">
            {emptyHint ||
              "Only OTT titles (Netflix / Hotstar / Prime / Disney) land here — try a Server above, or check back later."}
          </p>
        </div>
      )}

      {rows.map((row) => (
        <div
          key={row.key}
          onClick={() => play(row)}
          className={clsx(
            "flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-white/5",
            busy === row.key && "pointer-events-none opacity-70"
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white">
            {busy === row.key ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : sent[row.key] ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <PlayIcon className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] font-semibold">
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
          </span>
          {modal && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                downloadRow(row);
              }}
              title="Download this file"
              className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
            >
              Download
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              copy(row.url);
            }}
            title="Copy link"
            className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
          >
            Copy
          </button>
        </div>
      ))}
    </div>
  );

  /* Server 24: sources in a modern modal — auto-opens when rows land, the
   * inline player takes over the pane while playing, then hands back. The
   * overlay is portalled to document.body so it always centers on the real
   * viewport (the sources pane sits inside overflow-hidden flex containers
   * that otherwise trap position:fixed) and adapts to phone screens. */
  if (modal) {
    if (!mounted) return <div className="relative flex h-full flex-col bg-black" />;
    return (
      <>
        <div className="relative flex h-full flex-col bg-black">
          {status === "ready" ? (
            <button
              onClick={() => setShowModal(true)}
              className="anim-fade-in group flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition-transform group-hover:scale-105">
                <PlayIcon className="h-7 w-7" />
              </span>
              <span className="text-[15px] font-bold">{rows.length} HDHub links ready</span>
              <span className="max-w-xs text-[12px] text-neutral-400">
                Browse sources — direct play, VLC handoff and downloads
              </span>
              <span className="rounded-full bg-white/10 px-3.5 py-1.5 text-[11.5px] font-semibold text-neutral-200 transition group-hover:bg-white/20">
                Open sources
              </span>
            </button>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-brand" />
              <p className="text-[12.5px] font-semibold text-neutral-300">
                {status === "error" ? error : "Scanning HDHub sources…"}
              </p>
              {(status === "loading" || status === "error") && (
                <button
                  onClick={() => setReload((r) => r + 1)}
                  className={clsx(
                    "rounded-full px-4 py-1.5 text-[12px] font-bold",
                    status === "error" ? "bg-brand text-white" : "bg-white/10 text-neutral-300"
                  )}
                >
                  {status === "error" ? "Retry" : "Search again"}
                </button>
              )}
            </div>
          )}
        </div>
        {showModal &&
          createPortal(
            <div
              className="anim-fade-in fixed inset-0 z-[450] flex items-center justify-center bg-black/85 p-3 sm:p-6"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowModal(false);
              }}
            >
              <div className="modal-in flex h-[85dvh] max-h-[85dvh] w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-950 shadow-2xl sm:h-[80vh] sm:max-h-[80vh] sm:max-w-xl">
                <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3 sm:px-4">
                  <span className="min-w-0 truncate text-[13px] font-bold">
                    {laneTitle || "🏰 HDHub sources"}
                  </span>
                  {status === "ready" && (
                    <span className="shrink-0 rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-semibold text-brand">
                      {rows.length} links
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
                      className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
                    >
                      Get VLC
                    </a>
                  )}
                  <button
                    onClick={() => setReload((r) => r + 1)}
                    title="Search again"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
                  >
                    <RotateCcwIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setShowModal(false)}
                    title="Close"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
                {staleNote && (
                  <div className="border-b border-white/10 bg-amber-400/10 px-4 py-2 text-[11.5px] font-medium text-amber-300">
                    That link had expired — fetching fresh ones from HDHub… try again in a moment.
                  </div>
                )}
                {list}
              </div>
            </div>,
            document.body
          )}
        {copied &&
          createPortal(
            <div className="fixed bottom-6 left-1/2 z-[460] -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black">
              Link copied
            </div>,
            document.body
          )}
      </>
    );
  }

  /* classic inline list (every other lane) */
  return (
    <div className="relative flex h-full flex-col bg-black">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-[13px] font-bold">{laneTitle || "🇮🇳 Hindi sources"}</span>
        {!hideSiteLink && (
          <a
            href={
              type === "movie"
                ? `https://netmirror.center/movie/${tmdbId}/?embed=1`
                : `https://netmirror.center/tv/${tmdbId}/?embed=1&s=${season}&e=${episode}`
            }
            target="_blank"
            rel="noreferrer"
            title="Open this title in NetMirror's own site player (new tab)"
            className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
          >
            NetMirror ↗
          </a>
        )}
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

      {list}

      {copied && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black">
          Link copied
        </div>
      )}
    </div>
  );
}
