import { isKidsActive } from "./storage";

/* ── TMDB data layer ────────────────────────────────────────────────────────
 * Strategy (mirrors how NetOut on Cloudflare Pages works, plus a backend):
 *   1. Try our backend proxy /api/tmdb/... (key stays server-side, HTTP-cached)
 *   2. If the proxy is unreachable (offline sandbox, static hosting…), fall
 *      back to calling TMDB directly from the browser with the public key.
 * A sticky flag makes the switch instant after the first failure.
 * ──────────────────────────────────────────────────────────────────────────── */

const envKey =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_TMDB_API_KEY) ||
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_TMDB_API_KEY);
export const TMDB_KEY = envKey || "f8243ad5d5cd1ef0ebe5d6c5bfcc59f2";
export const TMDB_BASE = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p";
export const IMG_ALT = "https://images.tmdb.org/t/p";

export type Media = {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  profile_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  popularity?: number;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: any[];
  credits?: any;
  videos?: any;
  images?: any;
  similar?: any;
  recommendations?: any;
  homepage?: string;
  tagline?: string;
  status?: string;
  original_language?: string;
  production_companies?: any[];
  networks?: any[];
  last_episode_to_air?: any;
  next_episode_to_air?: any;
  known_for_department?: string;
  known_for?: Media[];
  character?: string;
};

export const titleOf = (m?: Media | null) =>
  m?.title || m?.name || m?.original_title || m?.original_name || "Untitled";

export type { ProgressItem, ListItem } from "./storage";

export const yearOf = (m?: Media | null) => {
  const d = m?.release_date || m?.first_air_date || "";
  return d ? d.slice(0, 4) : "";
};

export const typeOf = (m: Media): "movie" | "tv" =>
  m.media_type === "tv" || m.media_type === "person"
    ? "tv"
    : m.media_type === "movie"
    ? "movie"
    : !!m.first_air_date || !!m.name
    ? "tv"
    : "movie";

/** Returns optimized TMDB image URL */
export const img = (path?: string | null, size = "w500") => {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${IMG}/${size}${cleanPath}`;
};

/** Returns secondary fallback mirror URLs including local server proxy */
export const getImgFallbacks = (path?: string | null, size = "w500") => {
  if (!path) return [];
  if (path.startsWith("http") || path.startsWith("data:")) return [path];
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return [
    `${IMG}/${size}${cleanPath}`,
    `${IMG_ALT}/${size}${cleanPath}`,
    `/api/tmdb-image/${size}${cleanPath}`,
    `${IMG}/w342${cleanPath}`,
  ];
};

/** Generates responsive srcset string for high-DPI displays without overfetching */
export const imgSrcSet = (path?: string | null, type: "poster" | "backdrop" = "poster") => {
  if (!path || path.startsWith("data:")) return undefined;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (type === "poster") {
    return `${IMG}/w185${cleanPath} 185w, ${IMG}/w342${cleanPath} 342w, ${IMG}/w500${cleanPath} 500w, ${IMG}/w780${cleanPath} 780w`;
  }
  return `${IMG}/w300${cleanPath} 300w, ${IMG}/w780${cleanPath} 780w, ${IMG}/w1280${cleanPath} 1280w, ${IMG}/original${cleanPath} 1920w`;
};

/**
 * Creates an ultra-lightweight SVG placeholder data URL for broken or missing images.
 * Renders instantly with 0 network latency and beautiful Yetflix styling.
 */
export function placeholderPoster(title: string, year?: string | number): string {
  const safeTitle = (title || "Yetflix")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .slice(0, 36);

  const safeYear = year ? String(year).slice(0, 4) : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#14151f" />
      <stop offset="50%" stop-color="#1b1c2b" />
      <stop offset="100%" stop-color="#0e0f17" />
    </linearGradient>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e50914" />
      <stop offset="100%" stop-color="#b20710" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
  <circle cx="200" cy="230" r="48" fill="#ffffff" fill-opacity="0.04" />
  <path d="M185 205 L225 230 L185 255 Z" fill="url(#brandGrad)" />
  <text x="200" y="320" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="700" text-anchor="middle" letter-spacing="-0.02em">
    ${safeTitle}
  </text>
  ${
    safeYear
      ? `<text x="200" y="348" fill="#9ca3af" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" text-anchor="middle">${safeYear}</text>`
      : ""
  }
  <text x="200" y="560" fill="#e50914" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" text-anchor="middle" letter-spacing="0.1em">
    YETFLIX
  </text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Preload helper to warm images in background */
export function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !src) return resolve();
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });
}

/** Preload a batch of images without blocking main thread */
export function preloadImages(srcs: (string | null | undefined)[]) {
  if (typeof window === "undefined") return;
  const valid = srcs.filter(Boolean) as string[];
  if (!valid.length) return;

  const loadNext = (index: number) => {
    if (index >= valid.length) return;
    preloadImage(valid[index]).then(() => {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => loadNext(index + 1));
      } else {
        setTimeout(() => loadNext(index + 1), 30);
      }
    });
  };

  loadNext(0);
}

/** Detect keys that were never replaced after copying .env.example */
const looksLikePlaceholder = (k: string) =>
  !k || /^your_|^<|placeholder|xxxx/i.test(k.trim());

export class TmdbError extends Error {
  code: "NO_KEY" | "HTTP";
  status?: number;
  constructor(message: string, code: "NO_KEY" | "HTTP", status?: number) {
    super(message);
    this.name = "TmdbError";
    this.code = code;
    this.status = status;
  }
}

let proxyDown = false;

async function tmdbFetch(
  path: string,
  params: Record<string, string | number | undefined> = {}
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }

  // 1) backend proxy
  if (!proxyDown) {
    try {
      const res = await fetch(`/api/tmdb/${path}?${qs}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 503) proxyDown = true;
      else if (res.ok) return res.json();
      else if (res.status >= 500) proxyDown = true;
    } catch {
      proxyDown = true;
    }
  }

  // 2) direct browser → TMDB (NetOut-style static deployment path)
  if (TMDB_KEY && !looksLikePlaceholder(TMDB_KEY)) {
    qs.set("api_key", TMDB_KEY);
    try {
      const res = await fetch(`${TMDB_BASE}/${path}?${qs}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok)
        throw new TmdbError(`TMDB responded ${res.status}`, "HTTP", res.status);
      return res.json();
    } catch (err) {
      if (err instanceof TmdbError) throw err;
      proxyDown = false;
      throw new TmdbError(
        "Can't reach TMDB from the browser (network blocked, CORS or offline) and the server proxy is unavailable",
        "HTTP"
      );
    }
  }
  if (looksLikePlaceholder(TMDB_KEY)) {
    throw new TmdbError(
      "PLACEHOLDER: .env.local still contains 'your_tmdb_v3_api_key' — replace it with your real key, then restart the dev server",
      "NO_KEY"
    );
  }
  throw new TmdbError(
    "TMDB API key is not configured — create .env.local from .env.example",
    "NO_KEY"
  );
}

/* SWR fetcher with a persistent snapshot cache */
const memorySnapshots = new Map<string, any>();

export function primeCache(key: string, data: any) {
  if (data === undefined) return;
  memorySnapshots.set(key, data);
}

export function getCached(key: string) {
  if (memorySnapshots.has(key)) return { data: memorySnapshots.get(key) };
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(`tmdbcache:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        memorySnapshots.set(key, parsed);
        return { data: parsed };
      }
    } catch {}
  }
  return {};
}

function persistSnapshot(key: string, data: any) {
  if (data === undefined || data === null) return;
  memorySnapshots.set(key, data);
  if (typeof window !== "undefined" && memorySnapshots.size < 200) {
    try {
      localStorage.setItem(`tmdbcache:${key}`, JSON.stringify(data));
    } catch {
      try {
        const keys = Object.keys(localStorage).filter((k) =>
          k.startsWith("tmdbcache:")
        );
        keys
          .slice(0, Math.ceil(keys.length / 2))
          .forEach((k) => localStorage.removeItem(k));
      } catch {}
    }
  }
}

const inflight = new Map<string, Promise<any>>();
function deduped(key: string, fn: () => Promise<any>) {
  if (!inflight.has(key)) {
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return inflight.get(key)!;
}

/* Kids mode filtering */
const KIDS_SAFE_MOVIE = new Set([16, 10751]);
const KIDS_SAFE_TV = new Set([10762, 10751]);

export function kidsSafeItem(item: any): boolean {
  if (!item || item.adult) return false;
  const ids: number[] =
    item.genre_ids ?? item.genres?.map((g: any) => g.id) ?? [];
  const media = item.media_type ?? (item.first_air_date ? "tv" : "movie");
  const safe = media === "tv" ? KIDS_SAFE_TV : KIDS_SAFE_MOVIE;
  return ids.some((id) => safe.has(id));
}

export function sanitizeForKids(data: any): any {
  if (!data || !Array.isArray(data.results)) return data;
  return { ...data, results: data.results.filter(kidsSafeItem) };
}

export function swrFetcher(key: string): Promise<any> {
  return deduped(key, async () => {
    const [path, qs] = key.split("?");
    const params: Record<string, string> = {};
    if (qs) new URLSearchParams(qs).forEach((v, k) => (params[k] = v));
    let data = await tmdbFetch(path, params);
    try {
      if (isKidsActive()) data = sanitizeForKids(data);
    } catch {}
    queueMicrotask(() => persistSnapshot(key, data));
    return data;
  });
}

export { tmdbFetch };

/* Convenience typed helpers */
export const getTrending = (
  type: "movie" | "tv",
  window: "day" | "week" = "week",
  page = 1
) => swrFetcher(`trending/${type}/${window}?page=${page}`);

export const searchMulti = (query: string, page = 1) =>
  swrFetcher(
    `search/multi?query=${encodeURIComponent(
      query
    )}&include_adult=false&page=${page}`
  );

export const getDetails = (type: "movie" | "tv", id: string | number) =>
  swrFetcher(
    `${type}/${id}?append_to_response=credits,videos,similar,recommendations,images` +
      `&include_image_language=en,null`
  );

/** Instantly prefetch modal details into memory/HTTP cache on hover or focus */
export function prefetchTitleDetails(type: "movie" | "tv" | string, id: number | string) {
  if (!id) return;
  const t = type === "tv" ? "tv" : "movie";
  const key = `${t}/${id}?append_to_response=credits,videos,similar,recommendations,images&include_image_language=en,null`;
  swrFetcher(key).catch(() => {});
  if (t === "tv") {
    swrFetcher(`tv/${id}/season/1`).catch(() => {});
  }
}

export function bestLogo(images: any): string | undefined {
  const logos = images?.logos;
  if (!Array.isArray(logos) || logos.length === 0) return undefined;
  const score = (l: any) =>
    (l.iso_639_1 === "en" ? 1000 : 0) + (l.vote_count ?? 0);
  const best = [...logos].sort((a, b) => score(b) - score(a))[0];
  return best?.file_path;
}
