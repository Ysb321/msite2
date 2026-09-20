/* M2Box (m2box.org, the MovieBox web build) core helpers — shared by the
 * /api/m2box/stream route. Extracted from the route so the pure pieces are
 * unit-testable and the route file exports only HTTP handlers (a Next.js
 * route.ts requirement).
 *
 * How m2box plays video (reverse-engineered from their Nuxt bundle):
 *  - Every fetch goes to the SITE ORIGIN (m2box.org) which proxies the
 *    MovieBox BFF under /wefeed-h5api-bff/* — calling h5-api.aoneroom.com
 *    directly works for detail but play returns empty without the right
 *    headers, so everything goes through m2box.org with browser headers.
 *  - GET /wefeed-h5api-bff/detail?detailPath={slug} -> subject metadata
 *    + resource.seasons[] (se/maxEp per season, resolutions).
 *  - GET /wefeed-h5api-bff/subject/play?subjectId={id}&se={s}&ep={e}
 *    &detailPath={slug} -> streams[] (progressive MP4) or hls[] rows:
 *    { url, resolutions, size, duration, format, codecName }.
 *    CRITICAL: this endpoint needs a browser UA + a Referer on the
 *    title's own page (https://m2box.org/movies/{slug}) or it returns
 *    hasResource:false with an empty list.
 *  - Streams are direct signed CDN mp4s (bcdnxw.hakunaymatata.com), so rows
 *    play inline or hand off to VLC like every other lane.
 *
 * Title matching: m2box exposes NO keyword search to anonymous callers
 * (subject/search requires a session token), so we build a title index from
 * their public sitemaps (~355k movie slugs on the sibling themoviebox.org)
 * plus the paginated SSR TV/anime list pages and the home/trending
 * catalogs, then match the TMDB title against detailPath slugs (normalized)
 * with year verification from the detail payload's releaseDate. The index
 * is two-phase (featured rows first, full sitemaps only when needed) and
 * persisted to the runtime Cache API on Cloudflare, so cold isolates skip
 * the crawl (and its subrequest budget) entirely. */

/* ── edge-safe MD5 ─────────────────────────────────────────────────────
 * The client token needs md5(reversed-unix-seconds). Web Crypto has no
 * MD5 and this repo deploys on Cloudflare Pages, where every API lane
 * runs on the Edge Runtime (no node:crypto) — so a compact RFC-1321
 * implementation lives here. Deterministic (hardcoded K/S tables) and
 * byte-identical to node's createHash("md5"). */
const MD5_K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
  0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
  0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
  0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
  0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
  0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);
const MD5_S = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);

export function md5Hex(input: string): string {
  const msg = new TextEncoder().encode(input);
  /* pad to 64-byte blocks: msg + 0x80 + zeros + 8-byte LE bit length */
  const padded = (((msg.length + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(padded);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = msg.length * 8;
  dv.setUint32(padded - 8, bitLen >>> 0, true);
  dv.setUint32(padded - 4, Math.floor(bitLen / 4294967296), true);

  const M = new Uint32Array(16);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      const s = MD5_S[i];
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0 >>> 0, true);
  odv.setUint32(4, b0 >>> 0, true);
  odv.setUint32(8, c0 >>> 0, true);
  odv.setUint32(12, d0 >>> 0, true);
  let hex = "";
  for (let i = 0; i < 16; i++) hex += out[i].toString(16).padStart(2, "0");
  return hex;
}

export const SITE = "https://m2box.org";
/* their sibling web build hosts the public title sitemaps (referenced by
 * m2box's own sitemap.xml redirect): 71 sub-sitemaps x 5000 urls of
 * moviesDetail/{slug} rows covering the whole catalog. This is the only
 * full index available anonymously (subject/search needs a session). */
const SITEMAP_HOST = "https://themoviebox.org";
const SITEMAP_INDEX = `${SITEMAP_HOST}/sitemap_index_themoviebox.org_movies_detail.xml`;
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/* anonymous client token: "<unixSeconds>,<md5(reversed-seconds-string)>" -
 * ported verbatim from their bundle (hx/Cx in B410pHzd.js). detail and the
 * catalogs work without it; sending it keeps every call uniform. */
export function clientToken(): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  return `${ts},${md5Hex(ts.split("").reverse().join(""))}`;
}

export function m2boxHeaders(detailPath?: string): Record<string, string> {
  return {
    accept: "application/json, */*",
    "user-agent": UA,
    "accept-language": "en-US,en;q=0.9",
    "x-client-token": clientToken(),
    "x-request-lang": "en",
    "x-client-info": JSON.stringify({ timezone: "Asia/Kolkata" }),
    ...(detailPath ? { referer: `${SITE}/movies/${detailPath}` } : {}),
  };
}

/* one resilient fetch (2 attempts, 429/5xx backoff) -> raw text; JSON and
 * XML consumers parse separately (sitemaps are XML) */
export async function fetchText(url: string, headers: Record<string, string>, timeoutMs = 12000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel().catch(() => {});
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return await res.text();
    } catch {
      if (attempt === 1) return null;
    }
  }
  return null;
}

export async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 12000) {
  const text = await fetchText(url, headers, timeoutMs);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ── keyword search (SSR page) ─────────────────────────────────────────
 * m2box renders /web/searchResult?keyword=... server-side with /detail/{slug}
 * links for BOTH movies and TV. Fresh (unlike the sitemap dump, which is
 * full of stale slugs) and 1 subrequest — the cheapest reliable matcher.
 * Results are cached briefly so multi-episode taps don't refetch. */
const searchCache = new Map<string, { at: number; slugs: string[] }>();
const SEARCH_TTL = 10 * 60 * 1000;
const SEARCH_HREF = /href="[^"]*\/detail\/([a-zA-Z0-9-]+)"/g;

export async function searchSlugs(keyword: string, diag: string[]): Promise<string[]> {
  const key = words(keyword);
  if (!key) return [];
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.slugs;
  const html = await fetchText(`${SITE}/web/searchResult?keyword=${encodeURIComponent(key)}`, {
    accept: "text/html,*/*",
    "user-agent": UA,
    "accept-language": "en-US,en;q=0.9",
  }, 15000);
  if (!html) {
    diag.push("search:fail");
    return hit ? hit.slugs : [];
  }
  const slugs: string[] = [];
  for (const m of html.matchAll(SEARCH_HREF)) {
    if (!slugs.includes(m[1])) slugs.push(m[1]);
    if (slugs.length >= 12) break;
  }
  diag.push(`search:${slugs.length}`);
  searchCache.set(key, { at: Date.now(), slugs });
  return slugs;
}

/* ── title index (full catalog via the public sitemaps) ────────────── */

/* slug -> parsed title words (built lazily, then cached process-wide and
 * persisted across isolates via the runtime Cache API; the catalog barely
 * changes between deploys. Slugs like "inception-russian-40v6bCfWC6" end
 * with a random 8-12 char token; language markers (russian/hindi...) stay
 * part of the title text. */
const SUFFIX = /-[a-zA-Z0-9]{8,12}$/;
export const slugIndex = new Map<string, string>(); // slug -> normalized title words

/* TV + anime have no sitemap; the site's SSR list pages carry /detail/{slug}
 * links and DO paginate (?page=N, ~15 pages each). Crawled alongside the
 * movie sitemaps into the same slug index. */
const LIST_PAGES = ["/web/tv-series", "/web/animated-series"];
const LIST_PAGES_DEPTH = 16;
const DETAIL_HREF = /\/detail\/([a-z0-9-]+-[a-zA-Z0-9]{8,12})/g;

/* best-effort persistence across isolates: the runtime Cache API exists on
 * Cloudflare workers (zero config) but not in Node dev — every touch is
 * guarded and failure is non-fatal. Cloudflare's free plan caps an
 * invocation at 50 subrequests, so persisting the catalog is what lets a
 * cold isolate serve a request that would otherwise need ~120 fetches. */
const SNAPSHOT_URL = "https://m2box-index.internal/slug-index-v1.json";
const cacheBucket = (): any => {
  try {
    return (globalThis as any).caches?.default ?? null;
  } catch {
    return null;
  }
};

let smallPromise: Promise<void> | null = null;
let fullPromise: Promise<void> | null = null;
let fullReady = false;

/* restore a previously saved catalog snapshot (whole index in one cache
 * read instead of the crawl) */
export async function restoreIndexSnapshot(diag: string[]): Promise<boolean> {
  try {
    const bucket = cacheBucket();
    if (!bucket) return false;
    const hit = await bucket.match(SNAPSHOT_URL);
    if (!hit) return false;
    const entries = JSON.parse(await hit.text()) as [string, string][];
    if (!Array.isArray(entries) || !entries.length) return false;
    for (const [slug, w] of entries) if (!slugIndex.has(slug)) slugIndex.set(slug, w);
    diag.push(`snapshot:${slugIndex.size}`);
    fullReady = true;
    return true;
  } catch {
    return false;
  }
}

/* persist whatever catalog is loaded (even a partial one) */
export async function saveIndexSnapshot(diag: string[]): Promise<void> {
  try {
    const bucket = cacheBucket();
    if (!bucket || slugIndex.size < 1000) return;
    const body = JSON.stringify(Array.from(slugIndex.entries()));
    await bucket.put(
      SNAPSHOT_URL,
      new Response(body, { headers: { "cache-control": "public, max-age=604800" } })
    );
    diag.push("saved");
  } catch {
    diag.push("save-fail");
  }
}

/* cheap phase: home + trending catalogs — only ~400 rows but they carry the
 * currently featured movies AND TV/anime (which the movie sitemaps lack),
 * in 2 upstream calls */
async function buildSmall(diag: string[]): Promise<void> {
  const h = m2boxHeaders();
  const take = (list: any[]) => {
    for (const item of list || []) {
      const s = item?.subject || item;
      const path = s?.detailPath || s?.detailPathName;
      if (!path || slugIndex.has(path)) continue;
      slugIndex.set(path, words(path.replace(SUFFIX, "").replace(/-/g, " ")));
    }
  };
  const home = await fetchJson(`${SITE}/wefeed-h5api-bff/home?host=m2box.org`, h);
  if (home?.code === 0) {
    for (const section of home?.data?.operatingList || []) {
      if (Array.isArray(section?.subjects)) take(section.subjects);
      if (Array.isArray(section?.banner?.items)) take(section.banner.items);
    }
  }
  const trend = await fetchJson(
    `${SITE}/wefeed-h5api-bff/subject/trending?page=1&perPage=36`,
    h
  );
  if (trend?.code === 0) take(trend?.data?.items || trend?.data?.subjects || []);
  diag.push(`small:${slugIndex.size}`);
}

/* full phase: all 71 movie sub-sitemaps (~355k rows, 10 concurrent: lands
 * in ~10-15s once, then every request is a local map scan) plus the
 * paginated TV/anime list pages into the same slug index */
async function buildFull(diag: string[]): Promise<void> {
  const h = m2boxHeaders();
  const idx = await fetchText(SITEMAP_INDEX, h);
  const subs = (idx ? idx.match(/<loc>([^<]+)<\/loc>/g) : null) || [];
  if (subs.length) {
    const picked = subs.map((l) => l.replace(/<\/?loc>/g, ""));
    const re = /<loc>([^<]+)<\/loc>/g;
    for (let i = 0; i < picked.length; i += 10) {
      const parts = await Promise.all(
        picked.slice(i, i + 10).map(async (u) => (await fetchText(u, h, 20000)) || "")
      );
      for (const xml of parts) {
        for (const m of xml.matchAll(re)) {
          const slug = m[1].split("/").pop() || "";
          if (!slug || slugIndex.has(slug)) continue;
          slugIndex.set(slug, words(slug.replace(SUFFIX, "").replace(/-/g, " ")));
        }
      }
    }
  } else {
    diag.push("sitemap:index-fail");
  }
  diag.push(`sitemap:${slugIndex.size}`);

  const addSlugs = (html: string) => {
    for (const m of html.matchAll(DETAIL_HREF)) {
      const slug = m[1];
      if (!slugIndex.has(slug))
        slugIndex.set(slug, words(slug.replace(SUFFIX, "").replace(/-/g, " ")));
    }
  };
  for (const base of LIST_PAGES) {
    for (let i = 0; i < LIST_PAGES_DEPTH; i += 4) {
      const pages = await Promise.all(
        [0, 1, 2, 3].map(async (k) => {
          const html = await fetchText(`${SITE}${base}?page=${i + k + 1}`, h, 15000);
          return html || "";
        })
      );
      const before = slugIndex.size;
      for (const html of pages) addSlugs(html);
      if (slugIndex.size === before) break; // past the last page
    }
  }
  diag.push(`total:${slugIndex.size}`);
}

/* Build (or restore) the title index. `full: false` is the cheap path every
 * request starts with; `full: true` pulls the whole catalog and persists a
 * snapshot so later cold isolates skip the crawl entirely. */
export async function ensureIndex(diag: string[], full: boolean): Promise<void> {
  if (fullReady) return;
  if (!full) {
    if (!smallPromise) {
      smallPromise = (async () => {
        if (slugIndex.size) return;
        if (await restoreIndexSnapshot(diag)) return;
        await buildSmall(diag);
      })().catch(() => {
        smallPromise = null; // allow a retry on the next request
        diag.push("small:error");
      });
    }
    await smallPromise;
    return;
  }
  if (!fullPromise) {
    fullPromise = (async () => {
      if (await restoreIndexSnapshot(diag)) return; // sets fullReady itself
      await buildFull(diag); // small rows already in the map simply dedupe
      fullReady = true;
      await Promise.race([saveIndexSnapshot(diag), new Promise((r) => setTimeout(r, 5000))]);
    })().catch(() => {
      fullPromise = null; // allow a retry on the next request
      diag.push("index:error");
    });
  }
  await fullPromise;
}

export const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // strip [Hindi][CAM] tags
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const words = (s: string) => norm(s).split(" ").filter(Boolean).slice(0, 8).join(" ");

/* slug-index matching: slug-title words vs the requested title (raw then
 * original). Exact-normalized equality always wins; otherwise the longest
 * containment hit. Year can't be checked pre-detail (slugs carry no date)
 * so it's verified after. */
export function matchSlugs(target: string, orig: string, limit = 4): string[] {
  const t = target && words(target);
  const o = orig && words(orig);
  if (!t && !o) return [];
  const scored: { slug: string; tier: number; dist: number }[] = [];
  const tLen = (t || "").length;
  for (const [slug, sWords] of slugIndex) {
    if ((t && sWords === t) || (o && sWords === o)) {
      /* exact: tier 0, but keep walking so dead exact slugs can fall
       * through to near candidates */
      scored.push({ slug, tier: 0, dist: 0 });
      continue;
    }
    let tier = 0;
    if (t && (sWords.includes(t) || t.includes(sWords))) tier = 1;
    else if (o && (sWords.includes(o) || o.includes(sWords))) tier = 1;
    if (!tier) continue;
    /* closest length wins: "inception russian" beats
     * "inception version francaise" for "inception" */
    scored.push({ slug, tier, dist: Math.abs(sWords.length - tLen) });
  }
  scored.sort((a, b) => a.tier - b.tier || a.dist - b.dist);
  const out = scored.slice(0, limit).map((x) => x.slug);
  return out;
}

/* verify a detail subject against the requested title (+year ±1) */
export function verifySubject(s: any, title: string, origTitle: string, year: string): boolean {
  const realWords = words(s?.title || "");
  const want = words(title);
  const wantO = origTitle ? words(origTitle) : "";
  const titleOk =
    (realWords && want && (realWords === want || realWords.includes(want) || want.includes(realWords))) ||
    (realWords && wantO && (realWords === wantO || realWords.includes(wantO) || wantO.includes(realWords)));
  if (!titleOk) return false;
  if (year) {
    const ry = Number(String(s?.releaseDate || "").slice(0, 4));
    if (ry && Math.abs(ry - Number(year)) > 1) return false;
  }
  return true;
}

/* ── stream mapping ─────────────────────────────────────────────────── */

const fmtSize = (bytes: number | string | undefined) => {
  const b = Number(bytes || 0);
  if (b > 0) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return "";
};

export function toRows(streams: any[], hls: any[], source: string) {
  const rows: { name: string; description: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const s of [...streams, ...hls]) {
    if (!s?.url || typeof s.url !== "string") continue;
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    const res = s.resolutions && s.resolutions !== "0" ? `${s.resolutions}p` : "";
    const size = fmtSize(s.size);
    const format = s.format || (hls.length && !streams.length ? "HLS" : "MP4");
    rows.push({
      name: `M2Box ${res || format}`.trim(),
      description: `[M2Box]${size ? ` 💾 ${size}` : ""}${res ? ` ${res}` : ""} ${format}${source ? ` · ${source}` : ""}`,
      url: s.url,
    });
  }
  return rows;
}
