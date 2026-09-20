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
 * (.m3u8) - everything else (.mkv/Dolby) needs real VLC */
const BROWSER_PLAYABLE = /\.(m3u8|mp4|m4v|webm|mov)(\?|#|$)/i;
export const playableInBrowser = (u?: string) => !!u && BROWSER_PLAYABLE.test(u);

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
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.download = filename || "video";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {}
}

/** hand a direct file url to the installed VLC (or report exactly why not).
 *  Site-relative proxy paths (/api/...) are resolved to absolute first -
 *  VLC, intents and clipboards cannot use relative urls. */
export async function openInVlc(fileUrl: string): Promise<{ ok: boolean; note: string }> {
  let abs = fileUrl;
  try {
    abs = new URL(fileUrl, window.location.origin).toString();
  } catch {}
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
      return { ok: false, note: "Desktop VLC not found — rebuild the desktop app" };
    }
    if (isAndroid()) {
      const intent = vlcIntentUrl(abs);
      if (intent) {
        window.location.href = intent;
        return { ok: true, note: "Opening VLC app… (no VLC? tap Get VLC above)" };
      }
    }
    if (isIOS()) {
      window.location.href = vlcIosUrl(abs);
      return { ok: true, note: "Opening VLC app… (no VLC? tap Get VLC above)" };
    }
    /* PC web: fire the desktop bridge and watch focus - a real launch blurs
     * the page (OS prompt / app switch); still focused after 2.5s = the app
     * isn't installed. The link is copied either way. */
    try {
      let ref = "";
      try {
        ref = `&ref=${encodeURIComponent(new URL(abs).origin)}`;
      } catch {}
      const f = document.createElement("iframe");
      f.style.display = "none";
      f.src = `yetflix-vlc://play?url=${encodeURIComponent(abs)}${ref}`;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 4000);
    } catch {}
    await copyLink();
    const launched = await new Promise<boolean>((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          window.removeEventListener("blur", onBlur);
          resolve(false);
        }
      }, 2500);
      const onBlur = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          window.removeEventListener("blur", onBlur);
          resolve(true);
        }
      };
      window.addEventListener("blur", onBlur);
    });
    return launched
      ? { ok: true, note: "Opening VLC…" }
      : { ok: false, note: "Desktop app not detected — install it for one-tap VLC (link copied)" };
  } catch {
    await copyLink();
    return { ok: false, note: "VLC didn't open — link copied instead" };
  }
}
