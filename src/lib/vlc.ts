/* Server 9 (WebStreamr): Stremio-addon stream resolution + "Play in VLC"
 * handoff for every platform.
 *
 * The addon (WebStreamrMBG) scrapes 20+ source sites live and returns
 * Stremio stream objects: { url, name, title, behaviorHints }. Direct
 * entries carry an /extract/ url (resolves to the file at play time);
 * page-only entries carry externalUrl. All calls go through our
 * /api/webstreamr routes (no CORS gamble, one shared fetch, resolve
 * logic server-side).
 *
 * VLC handoff per platform: desktop app (preload IPC -> bundled vlc.exe),
 * Android (vlc intent with browser fallback), iOS (vlc-x-callback), PC web
 * (yetflix-vlc:// bridge + focus detection: a real launch blurs the page,
 * still focused = app not installed). Browser-playable files (.mp4/.m3u8/
 * .webm) can also play inline via hls.js - see VlcSources.
 */

export type WsStream = {
  url?: string;
  externalUrl?: string;
  name?: string;
  title?: string;
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    videoSize?: number;
    filename?: string;
  };
};

/** one rendered source row (parsed from the addon's name/title lines) */
export type WsRow = {
  key: string;
  /** direct (extract) url, when the entry has one */
  fileUrl?: string;
  /** download page url, when the entry is page-only */
  pageUrl?: string;
  quality: string;
  size: string;
  source: string;
  file: string;
  audio: string;
};

export const fmtSize = (bytes?: number) => {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2).replace(/\.?0+$/, "")} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

const httpUrl = (u?: string) =>
  typeof u === "string" && /^https?:\/\//i.test(u) ? u : undefined;

/* name:  "WebStreamrMBG\n<flags>\n<quality>"
 * title: "<file> ⚠️ no seek\n💾 <size>\n🔗 <source>" */
export function parseStream(s: WsStream, i: number): WsRow {
  const nameLines = (s.name || "").split("\n").map((x) => x.trim());
  const titleLines = (s.title || "").split("\n").map((x) => x.trim());
  const quality = nameLines.length >= 3 ? nameLines[nameLines.length - 1] : "";
  const audio = nameLines.length >= 3 ? nameLines[1] : "";
  const file = (titleLines[0] || "").replace(/\s*⚠️.*$/, "").trim();
  const size =
    (titleLines.find((l) => l.startsWith("💾")) || "").replace("💾", "").trim() ||
    fmtSize(s.behaviorHints?.videoSize);
  const source = (titleLines.find((l) => l.startsWith("🔗")) || "")
    .replace("🔗", "")
    .trim();
  return {
    key: `${i}-${s.url || s.externalUrl || i}`,
    fileUrl: httpUrl(s.url),
    pageUrl: httpUrl(s.externalUrl),
    quality,
    size,
    source,
    file: file || "Unknown file",
    audio,
  };
}

/** stremio ids to try in order (IMDb first when TMDB knows it) */
export function wsIds(
  type: "movie" | "tv",
  tmdbId: string,
  imdbId: string | null,
  season: number,
  episode: number
): string[] {
  const ids: string[] = [];
  const imdb = imdbId && /^tt\d+$/.test(imdbId) ? imdbId : null;
  if (imdb) ids.push(type === "movie" ? imdb : `${imdb}:${season}:${episode}`);
  ids.push(
    type === "movie" ? `tmdb:${tmdbId}` : `tmdb:${tmdbId}:${season}:${episode}`
  );
  return ids;
}

/** streams for one stremio id (throws on addon failure/timeout) */
export async function fetchWsStreams(
  kind: "movie" | "series",
  stremioId: string,
  signal?: AbortSignal
): Promise<WsStream[]> {
  const r = await fetch(
    `/api/webstreamr/stream/${kind}/${encodeURIComponent(stremioId)}`,
    { signal }
  );
  if (!r.ok) throw new Error(`sources ${r.status}`);
  const j = (await r.json()) as { streams?: WsStream[] };
  return Array.isArray(j?.streams) ? j.streams : [];
}

export type WsResolved =
  | { ok: true; kind: "file" | "page"; url: string; links: string[]; stale?: boolean }
  | { ok: false; error: string };

/** resolve a stream url to a playable file (or a download-button page) */
export async function resolveWsUrl(url: string): Promise<WsResolved> {
  try {
    const r = await fetch(`/api/webstreamr/resolve?url=${encodeURIComponent(url)}`);
    const j = (await r.json()) as WsResolved;
    if (!j || typeof j !== "object" || !("ok" in j)) return { ok: false, error: "bad resolver reply" };
    return j;
  } catch {
    return { ok: false, error: "resolver unreachable" };
  }
}

/* ── VLC handoff ─────────────────────────────────────────────────── */

export const isDesktopVlc = () =>
  typeof window !== "undefined" &&
  !!(window as unknown as { yetflixVlc?: { play?: unknown } }).yetflixVlc?.play;

export const isAndroid = () =>
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export const isIOS = () =>
  typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

/* files Chrome/Safari can play natively (.mp4/.webm/.mov) or via hls.js
 * (.m3u8) or direct video stream endpoints - proxy handles .mkv / range */
const BROWSER_PLAYABLE = /\.(m3u8|mp4|m4v|webm|mov|mkv)(\?|#|$)/i;
const DIRECT_STREAM_DOMAINS = /(googleusercontent\.com|googlevideo\.com|photos\.google\.com|workers\.dev|hcloud|r2\.dev|pixeldrain|pixelserver|cloudflarestorage\.com)/i;
export const playableInBrowser = (u?: string) => {
  if (!u) return false;
  if (u.includes("/api/m2box/proxy") || u.includes("/api/stream/proxy") || u.includes("/proxy") || u.startsWith("/api/")) return true;
  if (DIRECT_STREAM_DOMAINS.test(u)) return true;
  try {
    const decoded = decodeURIComponent(u);
    if (BROWSER_PLAYABLE.test(decoded)) return true;
  } catch {}
  return BROWSER_PLAYABLE.test(u);
};

/** Ensures direct media stream URLs (Pixeldrain, Cloudflare R2, Google UserContent, MKV files, etc.)
 *  are routed through the CORS and range-supporting /api/stream/proxy for integrated browser player playback. */
export function getPlayableMediaUrl(fileUrl: string): string {
  if (!fileUrl) return fileUrl;
  if (fileUrl.includes("/api/stream/proxy") || fileUrl.includes("/api/m2box/proxy")) {
    return fileUrl;
  }
  if (
    fileUrl.startsWith("http") &&
    (/pixeldrain|pixelserver|cloudflarestorage|r2\.dev|workers\.dev|googleusercontent|bcdnxw/i.test(fileUrl) ||
     /\.(mp4|webm|mkv|m4v)(\?|#|$)/i.test(fileUrl) ||
     !/\.(m3u8|mpd)(\?|#|$)/i.test(fileUrl))
  ) {
    try {
      const b64 = typeof window !== "undefined" ? window.btoa(unescape(encodeURIComponent(fileUrl))) : Buffer.from(fileUrl).toString("base64");
      return `/api/stream/proxy/video.mp4?b64=${encodeURIComponent(b64)}`;
    } catch {}
  }
  return fileUrl;
}

/** Android Chrome -> VLC app. #fragments are stripped and ; encoded (both
 *  break intent parsing); S.browser_fallback_url keeps the tap from dying
 *  silently when VLC isn't installed. */
export function vlcIntentUrl(fileUrl: string): string | null {
  const bare = fileUrl.split("#")[0];
  const data = bare.replace(/;/g, "%3B");
  const fallback = `;S.browser_fallback_url=${encodeURIComponent(bare)}`;
  if (data.startsWith("https://"))
    return `intent://${data.slice("https://".length)}#Intent;scheme=https;package=org.videolan.vlc${fallback};end`;
  if (data.startsWith("http://"))
    return `intent://${data.slice("http://".length)}#Intent;scheme=http;package=org.videolan.vlc${fallback};end`;
  return null;
}

/** VLC for iOS url scheme */
export function vlcIosUrl(fileUrl: string): string {
  return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(fileUrl)}`;
}

/** download a direct file (cross-origin links open in a tab - the browser
 *  then downloads whatever it can't play natively) */
export function downloadFile(url: string, filename: string) {
  if (!url) return;
  const directUrl = unwrapDirectUrl(url);
  try {
    const a = document.createElement("a");
    a.href = directUrl;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.download = filename || "video";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {}
}

/** Helper to convert any Pixeldrain / PixelServer URL to https://pixeldrain.dev/api/file/{fileId}?download format */
export function formatPixelUrl(fileUrl: string): string {
  if (!fileUrl) return fileUrl;
  try {
    const isPixel = /pixeldrain|pixelserver/i.test(fileUrl);
    if (isPixel) {
      const match = /(?:api\/file|u|file)\/([A-Za-z0-9_-]+)/i.exec(fileUrl) || /\/([A-Za-z0-9_-]{6,})\b/.exec(fileUrl);
      if (match && match[1]) {
        const fileId = match[1];
        return `https://pixeldrain.dev/api/file/${fileId}?download`;
      }
    }
  } catch {}
  return fileUrl;
}

/** Unwrap proxy URLs containing b64/url parameters to extract the direct raw stream URL */
export function unwrapDirectUrl(fileUrl: string): string {
  if (!fileUrl) return fileUrl;
  let target = fileUrl;
  try {
    if (target.startsWith("/")) {
      const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
      target = new URL(target, origin).toString();
    }
    const parsed = new URL(target);
    const b64 = parsed.searchParams.get("b64");
    const paramUrl = parsed.searchParams.get("url") || parsed.searchParams.get("target") || parsed.searchParams.get("stream");

    if (b64) {
      let decoded = "";
      try {
        const rawB64 = decodeURIComponent(b64);
        if (typeof window !== "undefined" && typeof window.atob === "function") {
          decoded = decodeURIComponent(escape(window.atob(rawB64)));
        } else if (typeof Buffer !== "undefined") {
          decoded = Buffer.from(rawB64, "base64").toString("utf8");
        }
      } catch {
        try {
          if (typeof window !== "undefined" && typeof window.atob === "function") {
            decoded = window.atob(b64);
          } else if (typeof Buffer !== "undefined") {
            decoded = Buffer.from(b64, "base64").toString("utf8");
          }
        } catch {}
      }
      if (decoded && (decoded.startsWith("http://") || decoded.startsWith("https://"))) {
        target = decoded;
      }
    } else if (paramUrl && (paramUrl.startsWith("http://") || paramUrl.startsWith("https://"))) {
      target = paramUrl;
    }
  } catch {}

  return formatPixelUrl(target);
}

/** Generate and trigger download of an M3U playlist file for VLC */
export function downloadM3uPlaylist(fileUrl: string, title?: string) {
  try {
    const abs = unwrapDirectUrl(fileUrl);
    const cleanTitle = (title || "Video Stream").replace(/[\r\n]/g, " ");
    const m3uContent = `#EXTM3U\n#EXTINF:-1,${cleanTitle}\n${abs}\n`;
    const blob = new Blob([m3uContent], { type: "audio/x-mpegurl" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${cleanTitle.replace(/[^a-zA-Z0-9_\- ]/g, "_")}.m3u`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch {}
}

/** Generate a vlc:// protocol URL for a video stream URL */
export function generateVlcProtocolUrl(fileUrl: string): string {
  const abs = unwrapDirectUrl(fileUrl);
  return `vlc://${abs}`;
}

/** hand a direct file url to the installed VLC (or report exactly why not).
 *  Site-relative proxy paths (/api/...) are resolved to absolute first -
 *  VLC, intents and clipboards cannot use relative urls. */
export async function openInVlc(fileUrl: string, title?: string): Promise<{ ok: boolean; note: string }> {
  const abs = unwrapDirectUrl(fileUrl);
  const vlcProtocolUrl = `vlc://${abs}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(abs);
    } catch {}
  };

  try {
    if (isDesktopVlc()) {
      let referer: string | undefined;
      try {
        referer = new URL(abs).origin;
      } catch {}
      const opened = await (
        window as unknown as {
          yetflixVlc: { play: (u: string, h?: object) => Promise<unknown> };
        }
      ).yetflixVlc.play(abs, referer ? { Referer: referer } : undefined);
      if (opened) return { ok: true, note: "Sent to VLC ✓" };
    }

    if (isAndroid()) {
      const intent = vlcIntentUrl(abs);
      if (intent) {
        window.location.href = intent;
        return { ok: true, note: "Opening VLC app… (no VLC? tap Get VLC)" };
      }
    }

    if (isIOS()) {
      window.location.href = vlcIosUrl(abs);
      return { ok: true, note: "Opening VLC app… (no VLC? tap Get VLC)" };
    }

    // Attempt vlc:// protocol scheme launch
    try {
      window.location.href = vlcProtocolUrl;
    } catch {}

    // Download .m3u playlist file (natively associated with VLC on PC)
    downloadM3uPlaylist(abs, title);
    await copyLink();

    return {
      ok: true,
      note: "Downloaded .m3u file (Open in VLC) & copied stream URL to clipboard!",
    };
  } catch {
    downloadM3uPlaylist(abs, title);
    await copyLink();
    return { ok: false, note: "Downloaded .m3u file & copied link for VLC" };
  }
}
