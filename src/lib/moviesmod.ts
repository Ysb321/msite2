/* MoviesMod (moviesmod.zone) Hindi-dubbed DDL resolver.
 *
 *  MoviesMod is a WordPress DDL blog (Dual Audio {Hindi-English} /
 *  Multi Audio {Hindi-English-...} WEB-DL + BluRay, 480p-2160p, movies +
 *  series, Hindi Series / K-Drama / Anime sections). Chain ported from
 *  the NuvioStreamsAddon `moviesmod` Stremio provider
 *  (tapframe/NuvioStreamsAddon, MIT - public instance sunset, code is
 *  the reference) + its `linkResolver` util:
 *
 *    blog search (?s=) -> similarity + year match -> post page
 *    (.thecontent h4 per quality / h3 Season episode buttons) ->
 *    modrefer.in (base64 ?url=) | links/posts/episodes.modpro.blog ->
 *    driveseed/driveleech direct (fast path) | unblocked* SID verify
 *    (cloud.unblockedgames.world ?sid=, CSX bypass: #landing forms
 *    -> ?go= token + cookie -> meta refresh; legacy s_343 dance kept
 *    as fallback) -> redirect -> window.location.replace file
 *    page -> Instant Download (?url= keys -> POST {origin}/api,
 *    x-token=host) | Resume Worker Bot (token + /download?id=) |
 *    Cloud Download | Direct (?type=1+2) | Resume Cloud -> workers / r2 /
 *    cdn.video-leech.pro CDN (video-seed.pro hop unwrapped to the
 *    video-downloads.googleusercontent.com file) -> HEAD validation.
 *
 *  Slimmed for an edge route: no axios/cheerio/redis (native fetch +
 *  regex parsing + in-memory TTL cache), CSX SID finish
 *  (SaurabhKaperwan/CSX bypass), driveseed links preferred over
 *  SID links (5 fewer hops), qualities/links resolved in parallel with
 *  tight timeouts, partial results returned. Hindi-ish posts (hindi /
 *  dual / multi / dubbed in the title) are preferred at match time.
 *  Files are dual/multi-audio single files, so captions[] is empty and
 *  lang is post-level. Nothing here is testable from the sandbox
 *  (egress), so every stage appends to diag for live debugging.
 */

export type MoviesModStream = {
  url: string;
  quality: string;
  size: number;
  platform: string;
  lang: string;
};

export type MoviesModCaption = { lang: string; name: string; url: string };

export type MoviesModResult = {
  title: string;
  streams: MoviesModStream[];
  captions: MoviesModCaption[];
  noSource: boolean;
  diag: string;
};

export type MoviesModOpts = {
  title: string;
  year?: string;
  kind: "movie" | "series";
  season: number;
  episode: number;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const T_GET = 8000;
const T_POST = 8000;
const T_HEAD = 6000;
const DOMAIN_TTL = 4 * 3600 * 1000;
const RESULT_TTL = 4 * 3600 * 1000;

const DOMAIN_CANDIDATES = ["https://moviesmod.zone", "https://moviesmod.build"];
const DOMAINS_JSON =
  "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
const UTILS_JSON =
  "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

let domainCache = { at: 0, base: "" };
const resultCache = new Map<string, { at: number; data: MoviesModResult }>();

/* ── http helpers (edge-safe, no deps) ── */

type GetOut = { status: number; text: string; url: string };

async function fetchText(url: string, init: RequestInit, timeoutMs: number): Promise<GetOut> {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text().catch(() => "");
    return { status: res.status, text, url: res.url || url };
  } finally {
    clearTimeout(killer);
  }
}

const httpGet = (url: string, headers?: Record<string, string>, timeoutMs = T_GET) =>
  fetchText(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*", ...headers } }, timeoutMs);

async function httpHead(url: string): Promise<number> {
  try {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), T_HEAD);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA, Range: "bytes=0-1" },
        signal: ctrl.signal,
      });
      return res.status;
    } finally {
      clearTimeout(killer);
    }
  } catch {
    return 0;
  }
}

async function httpPost(
  url: string,
  body: FormData | URLSearchParams,
  headers?: Record<string, string>
): Promise<GetOut> {
  const h: Record<string, string> = { "User-Agent": UA, ...headers };
  /* URLSearchParams needs an explicit content type; FormData sets its own */
  if (body instanceof URLSearchParams) h["Content-Type"] = "application/x-www-form-urlencoded";
  return fetchText(url, { method: "POST", headers: h, body: body as BodyInit }, T_POST);
}

const setCookiesOf = (res: Response): string[] => {
  try {
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof h.getSetCookie === "function") return h.getSetCookie();
    const single = res.headers.get("set-cookie");
    return single ? [single] : [];
  } catch {
    return [];
  }
};

/* minimal cookie jar for the SID dance (fetch has no jar on edge) */
class Jar {
  private m = new Map<string, string>();
  header(): string {
    return [...this.m.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  store(setCookies: string[]) {
    for (const c of setCookies) {
      const pair = c.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.m.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  set(name: string, value: string) {
    this.m.set(name, value);
  }
}

const jarGet = async (jar: Jar, url: string, headers?: Record<string, string>) => {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), T_GET);
  try {
    const ck = jar.header();
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        ...(ck ? { Cookie: ck } : {}),
        ...headers,
      },
      signal: ctrl.signal,
    });
    jar.store(setCookiesOf(res));
    return { status: res.status, text: await res.text().catch(() => ""), url: res.url || url };
  } finally {
    clearTimeout(killer);
  }
};

const jarPost = async (
  jar: Jar,
  url: string,
  body: URLSearchParams,
  headers?: Record<string, string>
) => {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), T_POST);
  try {
    const ck = jar.header();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(ck ? { Cookie: ck } : {}),
        ...headers,
      },
      body: body as BodyInit,
      signal: ctrl.signal,
    });
    jar.store(setCookiesOf(res));
    return { status: res.status, text: await res.text().catch(() => ""), url: res.url || url };
  } finally {
    clearTimeout(killer);
  }
};

const jarPostForm = async (
  jar: Jar,
  url: string,
  body: FormData,
  headers?: Record<string, string>
): Promise<GetOut> => {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), T_POST);
  try {
    const ck = jar.header();
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA, ...(ck ? { Cookie: ck } : {}), ...headers },
      body: body as BodyInit,
      signal: ctrl.signal,
    });
    jar.store(setCookiesOf(res));
    return { status: res.status, text: await res.text().catch(() => ""), url: res.url || url };
  } finally {
    clearTimeout(killer);
  }
};

/* HEAD with redirects followed -> final url (CSX instant-link unwrap;
 * redirect:"manual" hides Location on edge runtimes, so follow w/o body) */
const headFollow = async (url: string): Promise<string> => {
  try {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), T_GET);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA },
        signal: ctrl.signal,
      });
      return res.url || "";
    } finally {
      clearTimeout(killer);
    }
  } catch {
    return "";
  }
};

/* ── tiny html utils (regex, no cheerio) ── */

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => {
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return "";
      }
    });

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

type Anchor = { tag: string; href: string; text: string };

const anchorsIn = (html: string): Anchor[] => {
  const out: Anchor[] = [];
  const re = /<a\b[^>]*?href="([^"]+)"[^>]*?>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ tag: m[0].slice(0, 400), href: decodeEntities(m[1]), text: stripTags(m[2]) });
    if (out.length > 400) break;
  }
  return out;
};

const allInputs = (formInner: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /<input\b[^>]*?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formInner)) !== null) {
    const nm = /name="([^"]*)"/i.exec(m[0]);
    if (!nm || !nm[1]) continue;
    const vl = /value="([^"]*)"/i.exec(m[0]);
    out[nm[1]] = vl ? decodeEntities(vl[1]) : "";
  }
  return out;
};

const toParams = (o: Record<string, string>): URLSearchParams => {
  const p = new URLSearchParams();
  for (const k of Object.keys(o)) p.append(k, o[k]);
  return p;
};

const formById = (html: string, id: string): { action: string; inner: string } | null => {
  const open = new RegExp(`<form\\b[^>]*?\\bid="${id}"[^>]*?>`, "i").exec(html);
  if (!open || open.index === undefined) return null;
  const action = /action="([^"]*)"/i.exec(open[0]);
  const rest = html.slice(open.index + open[0].length);
  const close = /<\/form\s*>/i.exec(rest);
  return { action: action ? decodeEntities(action[1]) : "", inner: close ? rest.slice(0, close.index) : rest };
};

const metaRefreshUrl = (html: string): string => {
  const m =
    /<meta\b[^>]*?http-equiv="refresh"[^>]*?content="([^"]*)"[^>]*?>/i.exec(html) ||
    /<meta\b[^>]*?content="([^"]*)"[^>]*?http-equiv="refresh"[^>]*?>/i.exec(html);
  if (!m) return "";
  const u = /url=(.*)/i.exec(m[1]);
  return u ? u[1].replace(/["']/g, "").trim() : "";
};

const scriptsWith = (html: string, needle: string): string[] => {
  const out: string[] = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1].includes(needle)) out.push(m[1]);
    if (out.length > 10) break;
  }
  return out;
};

/* ── text utils ── */

const b64ToUtf8 = (s: string): string => {
  const bin = atob(s.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/* blog buttons sometimes hide the target in ?url=<base64> (CSX flow) */
const unb64Href = (href: string): string => {
  if (href.includes("modrefer.in")) return href;
  const i = href.indexOf("url=");
  if (i < 0) return href;
  const b64 = href.slice(i + 4).split("&")[0].split("#")[0];
  if (!b64 || b64.length > 4000) return href;
  try {
    const dec = b64ToUtf8(b64);
    if (/^https?:\/\//i.test(dec) && dec.length < 2000) return dec;
  } catch {}
  return href;
};

/* Dice bigram similarity (string-similarity replacement, ~20 lines) */
const dice = (a: string, b: string): number => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const g: string[] = [];
    for (let i = 0; i < s.length - 1; i++) g.push(s.slice(i, i + 2));
    return g;
  };
  const gx = grams(x);
  const gy = grams(y);
  const counts = new Map<string, number>();
  for (const g of gx) counts.set(g, (counts.get(g) || 0) + 1);
  let hits = 0;
  for (const g of gy) {
    const c = counts.get(g) || 0;
    if (c > 0) {
      hits++;
      counts.set(g, c - 1);
    }
  }
  return (2 * hits) / (gx.length + gy.length);
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractQuality = (text: string): string => {
  if (!text) return "Unknown";
  if (/2160p/i.test(text)) return "2160p";
  if (/4k/i.test(text)) return "2160p";
  if (/1080p/i.test(text)) return "1080p";
  if (/720p/i.test(text)) return "720p";
  if (/480p/i.test(text)) return "480p";
  return "Unknown";
};

const qualityNum = (q: string): number => {
  const m = /(\d{3,4})p/i.exec(q || "");
  return m ? Number(m[1]) : 0;
};

const parseSizeBytes = (s: string): number => {
  const m = /([0-9.,]+)\s*([KMGT]B)/i.exec(s || "");
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return 0;
  const unit = m[2].toUpperCase();
  const mult = unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : unit === "GB" ? 1024 ** 3 : 1024 ** 4;
  return Math.round(n * mult);
};

const fixWorkerUrl = (u: string): string => {
  if (!u.includes("workers.dev") && !u.includes(".r2.dev")) return u;
  const parts = u.split("/");
  parts[parts.length - 1] = parts[parts.length - 1].replace(/ /g, "%20");
  return parts.join("/");
};

const isHindiPost = (t: string) => /hindi|dual|multi|dubbed/i.test(t || "");

/* ── stages ── */

async function pickDomain(d: string[]): Promise<string> {
  if (domainCache.base && Date.now() - domainCache.at < DOMAIN_TTL) return domainCache.base;
  const verify = async (c: string): Promise<boolean> => {
    try {
      const r = await httpGet(c, undefined, 6000);
      return r.status >= 200 && r.status < 400 && /latestPost|MoviesMod|\/download-/i.test(r.text.slice(0, 60000));
    } catch {
      return false;
    }
  };
  /* fast path: zone is verified alive, skip the domain lists (2 fetches) */
  if (await verify(DOMAIN_CANDIDATES[0])) {
    domainCache = { at: Date.now(), base: DOMAIN_CANDIDATES[0] };
    d.push(`domain=${DOMAIN_CANDIDATES[0]}`);
    return DOMAIN_CANDIDATES[0];
  }
  const candidates = [...DOMAIN_CANDIDATES];
  const listJobs = [DOMAINS_JSON, UTILS_JSON].map(async (u) => {
    try {
      const r = await httpGet(u, undefined, 6000);
      if (r.status < 200 || r.status >= 400) return;
      const j = JSON.parse(r.text) as { moviesmod?: string };
      if (typeof j.moviesmod === "string" && j.moviesmod && !candidates.includes(j.moviesmod)) {
        candidates.push(j.moviesmod);
      }
    } catch {}
  });
  await Promise.all(listJobs);
  for (const c of candidates) {
    if (await verify(c)) {
      domainCache = { at: Date.now(), base: c };
      d.push(`domain=${c} (fallback)`);
      return c;
    }
    d.push(`domain ${c} unreachable`);
  }
  throw new Error("no reachable moviesmod domain");
}

type SearchHit = { title: string; url: string };

async function searchBlog(base: string, title: string, d: string[]): Promise<SearchHit[]> {
  let r = await httpGet(`${base}/search/${encodeURIComponent(title)}`);
  if (r.status < 200 || r.status >= 400) {
    r = await httpGet(`${base}/?s=${encodeURIComponent(title)}`);
  }
  if (r.status < 200 || r.status >= 400) throw new Error(`search http ${r.status}`);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  /* latestPost sections (split, not nested-div match - nesting-safe) */
  const parts = r.text.split(/class="[^"]*\blatestPost\b[^"]*"/i);
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 6000);
    const tag = /<a\b[^>]*?href="([^"]+)"[^>]*?>/i.exec(chunk);
    if (!tag) continue;
    const href = decodeEntities(tag[1]);
    const tm = /title="([^"]+)"/i.exec(tag[0]);
    if (!tm || seen.has(href)) continue;
    seen.add(href);
    hits.push({ title: stripTags(tm[1]), url: href });
  }
  /* fallback: any titled /download- link (post urls look like it) */
  if (!hits.length) {
    for (const a of anchorsIn(r.text)) {
      if (!a.href.includes("/download-")) continue;
      const tm = /title="([^"]+)"/i.exec(a.tag);
      const t = tm ? stripTags(tm[1]) : a.text;
      if (!t || seen.has(a.href)) continue;
      seen.add(a.href);
      hits.push({ title: t, url: a.href });
    }
    if (hits.length) d.push("search: fallback-selector");
  }
  d.push(`search: ${hits.length} hits`);
  return hits.slice(0, 12);
}

function pickResult(
  hits: SearchHit[],
  title: string,
  year: string | undefined,
  kind: "movie" | "series",
  d: string[]
): SearchHit | null {
  /* Hindi-ish posts first (the lane's promise), any post as fallback */
  const pools = [hits.filter((h) => isHindiPost(h.title)), hits];
  for (let pi = 0; pi < pools.length; pi++) {
    const pool = pools[pi];
    if (!pool.length) continue;
    let best: SearchHit | null = null;
    let bestScore = 0;
    for (const h of pool) {
      const s = dice(title, h.title);
      if (s > bestScore) {
        bestScore = s;
        best = h;
      }
    }
    if (best && bestScore > 0.3) {
      if (kind === "movie" && year && !best.title.includes(year)) {
        d.push(`match: "${best.title.slice(0, 50)}" year-mismatch`);
      } else {
        d.push(`match: "${best.title.slice(0, 60)}" (${bestScore.toFixed(2)}${pi === 1 ? ",non-hindi" : ""})`);
        return best;
      }
    }
    /* strict fallback: word-boundary title + year (movie) / season (tv) */
    const rx = new RegExp(`\\b${escapeRegExp(title.toLowerCase())}\\b`);
    const strict =
      kind === "movie"
        ? pool.find((h) => rx.test(h.title.toLowerCase()) && (!year || h.title.includes(year)))
        : pool.find((h) => rx.test(h.title.toLowerCase()) && h.title.toLowerCase().includes("season"));
    if (strict) {
      d.push(`match-strict: "${strict.title.slice(0, 60)}"`);
      return strict;
    }
  }
  d.push("match: none");
  return null;
}

type QualityLink = { quality: string; url: string };

async function extractDownloadLinks(postUrl: string, d: string[]): Promise<QualityLink[]> {
  const r = await httpGet(postUrl);
  if (r.status < 200 || r.status >= 400) throw new Error(`post http ${r.status}`);
  const links: QualityLink[] = [];
  const heads: { tag: string; text: string; start: number; end: number }[] = [];
  const re = /<(h3|h4)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r.text)) !== null && heads.length < 60) {
    heads.push({ tag: m[1], text: stripTags(m[2]), start: m.index, end: m.index + m[0].length });
  }
  heads.forEach((h, i) => {
    const block = r.text.slice(h.end, i + 1 < heads.length ? heads[i + 1].start : h.end + 20000);
    if (h.tag === "h3" && h.text.toLowerCase().includes("season")) {
      for (const a of anchorsIn(block)) {
        if (!/maxbutton-(episode-links|batch-zip|g-drive|af-download)/i.test(a.tag)) continue;
        if (/batch/i.test(a.text)) continue;
        links.push({ quality: `${h.text} - ${a.text}`, url: unb64Href(a.href) });
      }
    } else if (h.tag === "h4") {
      const hit = anchorsIn(block)
        .map((x) => unb64Href(x.href))
        .find((h) => /modrefer\.in|modpro\.blog|unblocked|driveseed|driveleech/i.test(h));
      if (hit) links.push({ quality: extractQuality(h.text), url: hit });
    }
  });
  d.push(`post: ${links.length} quality-links`);
  return links;
}

type ServerLink = { server: string; url: string };

/* SID verifiers: any unblocked* host (tech.* legacy, cloud.* current) */
const isSidUrl = (u: string) => u.includes("unblocked");

const fastScore = (u: string) => (u.includes("driveseed") || u.includes("driveleech") ? 0 : 1);

const sortFastFirst = (links: ServerLink[]): ServerLink[] =>
  links.slice(0, 6).sort((a, b) => fastScore(a.url) - fastScore(b.url));

async function resolveIntermediate(
  initialUrl: string,
  refererUrl: string,
  quality: string,
  d: string[],
  depth = 0
): Promise<ServerLink[]> {
  if (depth > 2) return [];
  let host = "";
  try {
    host = new URL(initialUrl).hostname;
  } catch {
    return [];
  }
  try {
    if (host.includes("dramadrip.com")) {
      const r = await httpGet(initialUrl, { Referer: refererUrl });
      const seasonM = /Season \d+/i.exec(quality);
      const qM = /(480p|720p|1080p|2160p|4k)[ \w\d-]*/i.exec(quality);
      if (!seasonM || !qM) return [];
      const seasonId = seasonM[0].toLowerCase();
      const parts = qM[0].toLowerCase().replace(/msubs.*/i, "").replace(/esubs.*/i, "").replace(/\{.*/, "").trim().split(/\s+/);
      const h2re = /<h2[^>]*wp-block-heading[^>]*>([\s\S]*?)<\/h2>/gi;
      const secs: { head: string; start: number }[] = [];
      let hm: RegExpExecArray | null;
      while ((hm = h2re.exec(r.text)) !== null) secs.push({ head: stripTags(hm[1]).toLowerCase(), start: hm.index });
      for (let i = 0; i < secs.length; i++) {
        if (!secs[i].head.includes(seasonId)) continue;
        const chunk = r.text.slice(secs[i].start, i + 1 < secs.length ? secs[i + 1].start : secs[i].start + 30000);
        const hit = anchorsIn(chunk).find(
          (a) =>
            /episodes\.modpro\.blog|cinematickit\.org/i.test(a.href) &&
            parts.every((p) => a.text.toLowerCase().includes(p))
        );
        if (hit) return resolveIntermediate(hit.href, initialUrl, quality, d, depth + 1);
      }
      return [];
    }
    if (host.includes("cinematickit.org")) {
      const r = await httpGet(initialUrl, { Referer: refererUrl });
      const all = anchorsIn(r.text);
      let found = all.filter(
        (a) => /driveseed|driveleech|unblocked/i.test(a.href) && a.text && !/batch/i.test(a.text)
      );
      if (!found.length) found = all.filter((a) => /modrefer\.in|dramadrip\.com/i.test(a.href) && a.text);
      return sortFastFirst(found.map((a) => ({ server: a.text, url: a.href })));
    }
    if (host.endsWith(".modpro.blog")) {
      const r = await httpGet(initialUrl, { Referer: refererUrl });
      const found = anchorsIn(r.text).filter(
        (a) =>
          /driveseed|driveleech|unblocked/i.test(a.href) &&
          a.text &&
          !/batch|comment/i.test(a.text)
      );
      /* CSX picks a.maxbutton-1 / a.maxbutton-5 first (sort is stable) */
      found.sort((a, b) => (/maxbutton-[15]/i.test(a.tag) ? 0 : 1) - (/maxbutton-[15]/i.test(b.tag) ? 0 : 1));
      return sortFastFirst(found.map((a) => ({ server: a.text, url: a.href })));
    }
    if (host.includes("modrefer.in")) {
      const enc = new URL(initialUrl).searchParams.get("url");
      if (!enc) return [];
      let decoded = "";
      try {
        decoded = b64ToUtf8(enc);
      } catch {
        return [];
      }
      const r = await httpGet(decoded, { Referer: refererUrl });
      const sec = /<div[^>]*timed-content-client_show_0_5_0[^>]*>([\s\S]*?)<\/div>/i.exec(r.text);
      let pool = sec ? anchorsIn(sec[1]) : [];
      if (!pool.length) {
        pool = anchorsIn(r.text).filter((a) => /driveseed|driveleech|unblocked|modpro\.blog/i.test(a.href));
      }
      return sortFastFirst(pool.filter((a) => a.href).map((a) => ({ server: a.text || "link", url: a.href })));
    }
    d.push(`intermediate: unknown host ${host}`);
    return [];
  } catch (e) {
    d.push(`intermediate ${host} err:${e instanceof Error ? e.message.slice(0, 30) : "?"}`);
    return [];
  }
}

/* unblocked* SID verify -> driveleech/driveseed redirect url (CSX bypass
 * port: #landing forms -> ?go= token + cookie -> meta refresh; the
 * legacy s_343 dance is kept as fallback for old verifier pages) */
async function resolveSid(sidUrl: string): Promise<string | null> {
  try {
    const origin = new URL(sidUrl).origin;
    const jar = new Jar();
    const s0 = await jarGet(jar, sidUrl);
    const f0 = formById(s0.text, "landing");
    if (!f0 || !f0.action) return null;
    const in0 = allInputs(f0.inner);
    if (!Object.keys(in0).length) return null;
    const s1 = await jarPost(jar, new URL(f0.action, s0.url).href, toParams(in0), { Referer: s0.url });
    const f1 = formById(s1.text, "landing");
    if (!f1 || !f1.action) return null;
    const in1 = allInputs(f1.inner);
    const s2 = await jarPost(jar, new URL(f1.action, s1.url).href, toParams(in1), { Referer: s1.url });
    /* current finish: ?go=<token>, cookie named = token holds _wp_http2 */
    const goScript = scriptsWith(s2.text, "?go=").find((s) => /\?go=([^"'\s&]+)/.test(s));
    const goM = goScript ? /\?go=([^"'\s&]+)/.exec(goScript) : null;
    if (goM && goM[1]) {
      jar.set(goM[1], in1["_wp_http2"] || "");
      const s3 = await jarGet(jar, `${origin}?go=${goM[1]}`, { Referer: s2.url });
      const meta = metaRefreshUrl(s3.text);
      if (meta) return new URL(meta, origin).href;
    }
    /* legacy finish: s_343 cookie + c.setAttribute href page */
    const cM = /s_343\('([^']+)',\s*'([^']+)'/.exec(s2.text);
    const lM = /c\.setAttribute\("href",\s*"([^"]+)"\)/.exec(s2.text);
    if (!cM || !lM) return null;
    jar.set(cM[1].trim(), cM[2].trim());
    const s3 = await jarGet(jar, new URL(lM[1].trim(), origin).href, { Referer: s2.url });
    const meta = metaRefreshUrl(s3.text);
    if (!meta) return null;
    return new URL(meta, origin).href;
  } catch {
    return null;
  }
}

async function followRedirectToFilePage(
  redirectUrl: string,
  note?: (s: string) => void
): Promise<{ html: string; url: string }> {
  const r = await httpGet(redirectUrl, undefined, T_GET);
  const scripts = scriptsWith(r.text, "window.location.replace");
  const m = scripts.length ? /window\.location\.replace\("([^"]+)"\)/.exec(scripts[0]) : null;
  note?.(`fp:${r.status}/${Math.round(r.text.length / 1024)}k${m ? "[r]" : ""}`);
  if (m && m[1]) {
    const filePage = new URL(m[1], new URL(redirectUrl).origin).href;
    const r2 = await httpGet(filePage);
    note?.(`fp2:${r2.status}/${Math.round(r2.text.length / 1024)}k`);
    return { html: r2.text, url: r2.url || filePage };
  }
  return { html: r.text, url: r.url || redirectUrl };
}

const filePageInfo = (html: string): { size: number; name: string } => {
  const sizeM = /Size\s*:\s*([0-9.,]+\s*[KMGT]B)/i.exec(html);
  let name = "";
  const nameM = /Name\s*:\s*([^<]{1,200})/i.exec(html);
  if (nameM) name = stripTags(nameM[1]);
  if (!name) {
    const h5 = /<div[^>]*card-header[^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(html);
    if (h5) name = stripTags(h5[1]).replace(/\[.*\]/, "").trim();
  }
  return { size: parseSizeBytes(sizeM ? sizeM[1] : ""), name };
};

/* HEAD check -> status (0 = network/timeout = uncertain -> keep) */
async function validVideoUrl(url: string): Promise<number> {
  return httpHead(url);
}

async function apiKeysToUrl(href: string, origin: string): Promise<string | null> {
  try {
    const u = new URL(href, origin);
    const keys = u.searchParams.get("url");
    if (!keys) return /^https?:/i.test(href) ? href : null;
    const fd = new FormData();
    fd.append("keys", keys);
    const r = await httpPost(`${u.origin}/api`, fd, { "x-token": u.hostname });
    if (r.status < 200 || r.status >= 400) return null;
    try {
      const j = JSON.parse(r.text) as { url?: string };
      return typeof j.url === "string" && j.url ? j.url : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

const isDirectCdn = (href: string) =>
  href.includes("cdn.video-leech.pro") ||
  href.includes("workers.dev") ||
  href.includes(".r2.dev") ||
  (href.startsWith("http") && !href.includes("?url="));

/* file page -> final playable url (linkResolver port) */
async function extractFinalDownload(
  html: string,
  pageUrl: string,
  note?: (s: string) => void
): Promise<string | null> {
  const origin = new URL(pageUrl).origin;
  const all = anchorsIn(html);
  const firstValid = async (urls: (string | null)[]): Promise<string | null> => {
    for (const u of urls) {
      if (!u || !/^https?:/i.test(u)) continue;
      const st = await validVideoUrl(u);
      try {
        note?.(`val:${new URL(u).hostname}=${st}`);
      } catch {}
      if (st === 0 || (st >= 200 && st < 400)) return u;
    }
    return null;
  };
  note?.(
    `btns:${[/Cloud Download/i, /Instant Download/i, /Resume Worker Bot/i, /Direct Links/i, /Resume Cloud/i]
      .map((rx) => (all.some((a) => rx.test(a.text)) ? "1" : "0"))
      .join("")}`
  );
  const byText = (rx: RegExp) => all.find((a) => rx.test(a.text));

  /* 1. Cloud Download (direct href) */
  const cloud = byText(/Cloud Download/i);
  if (cloud?.href && /^https?:/i.test(cloud.href)) {
    const hit = await firstValid([cloud.href]);
    if (hit) return hit;
  }
  /* 2. Instant Download: CSX 302 unwrap first, /api POST fallback */
  const instant = byText(/Instant Download/i);
  if (instant?.href) {
    if (isDirectCdn(instant.href)) {
      const hit = await firstValid([fixWorkerUrl(instant.href)]);
      if (hit) return hit;
    } else {
      /* follow (HEAD, no body) -> final url may carry ?url=<file> */
      try {
        const f = await headFollow(new URL(instant.href, origin).href);
        if (f && f !== instant.href) {
          note?.(`inst302:${f.slice(0, 90)}`);
          let unwrapped = f.includes("?url=") ? f.slice(f.indexOf("?url=") + 5) : f;
          try {
            if (unwrapped.includes("%")) unwrapped = decodeURIComponent(unwrapped);
          } catch {}
          if (/googleusercontent|workers\.dev|\.r2\.dev|\.mp4|\.mkv|\.m3u8/i.test(unwrapped) || f.includes("?url=")) {
            const abs = /^https?:/i.test(unwrapped) ? unwrapped : new URL(unwrapped, origin).href;
            const hit = await firstValid([abs]);
            if (hit) return hit;
          }
        }
      } catch {}
      const via = await apiKeysToUrl(instant.href, origin);
      note?.(`instApi:${via ? "y" : "n"}`);
      const hit = await firstValid([via]);
      if (hit) return hit;
    }
  }
  /* 3. Resume Worker Bot (jar keeps PHPSESSID for the token POST) */
  const worker = byText(/Resume Worker Bot/i);
  if (worker?.href) {
    try {
      const workerUrl = new URL(worker.href, origin).href;
      const wjar = new Jar();
      const r = await jarGet(wjar, workerUrl);
      const target = scriptsWith(r.text, "formData.append('token'").find(
        (s) => /formData\.append\('token', '([^']+)'\)/.test(s) && /fetch\('\/download\?id=([^']+)',/.test(s)
      );
      if (target) {
        const token = /formData\.append\('token', '([^']+)'\)/.exec(target)?.[1] || "";
        const id = /fetch\('\/download\?id=([^']+)',/.exec(target)?.[1] || "";
        if (token && id) {
          const fd = new FormData();
          fd.append("token", token);
          const wOrigin = new URL(workerUrl).origin;
          const api = await jarPostForm(wjar, `${wOrigin}/download?id=${id}`, fd, {
            "x-requested-with": "XMLHttpRequest",
            Referer: workerUrl,
            Origin: wOrigin,
          });
          try {
            const j = JSON.parse(api.text) as { url?: string };
            note?.(`work:${typeof j.url === "string" && j.url ? "y" : "n"}`);
            const hit = await firstValid([typeof j.url === "string" ? j.url : null]);
            if (hit) return hit;
          } catch {}
        }
      }
    } catch {}
  }
  /* 4. Direct Links (?type=1+2, all .btn-success) */
  const direct = byText(/Direct Links/i);
  if (direct?.href) {
    try {
      const cf = new URL(direct.href, origin);
      const pages = await Promise.all(
        ["1", "2"].map(async (t) => {
          try {
            const r = await httpGet(`${cf.href}${cf.search ? "&" : "?"}type=${t}`);
            return anchorsIn(r.text)
              .filter((a) => /btn-success/i.test(a.tag) && /^https?:/i.test(a.href))
              .map((a) => a.href);
          } catch {
            return [] as string[];
          }
        })
      );
      note?.(`dir:${pages.flat().length}`);
      const hit = await firstValid(pages.flat());
      if (hit) return hit;
    } catch {}
  }
  /* 5. Resume Cloud */
  const resume = byText(/Resume Cloud|Cloud Resume Download/i);
  if (resume?.href) {
    const directHttp = /^https?:/i.test(resume.href) && isDirectCdn(resume.href);
    if (directHttp) {
      const hit = await firstValid([resume.href]);
      if (hit) return hit;
    } else {
      try {
        const r = await httpGet(new URL(resume.href, origin).href);
        const btn = anchorsIn(r.text).find((a) => /btn-success/i.test(a.tag) && /^https?:/i.test(a.href));
        const hit = await firstValid([btn ? btn.href : null]);
        if (hit) return hit;
      } catch {}
    }
  }
  /* 6. last resort: plausible direct links on the page */
  const scan = all.find((a) => /workers\.dev|workerseed|driveleech\.net\/d\/|driveseed\.org\/d\//i.test(a.href));
  note?.(`scan:${scan ? "y" : "n"}`);
  return firstValid([scan ? scan.href : null]);
}

/* cdn.video-leech.pro -> follow -> video-seed.pro?url=<gdrive> unwrap */
async function unwrapVideoLeech(url: string): Promise<string> {
  try {
    const r = await httpGet(url, undefined, 12000);
    const finals = [r.url, url];
    for (const f of finals) {
      try {
        const u = new URL(f);
        if (!u.hostname.includes("video-seed.pro")) continue;
        const g = u.searchParams.get("url");
        if (g && g.includes("video-downloads.googleusercontent.com")) return decodeURIComponent(g);
      } catch {}
    }
  } catch {}
  return url;
}

const episodeNumOf = (server: string): number | null => {
  const pats = [/episode\s+(\d+)/i, /ep\s+(\d+)/i, /e(\d+)/i, /\b(\d+)\b/];
  for (const p of pats) {
    const m = p.exec(server || "");
    if (m) return Number(m[1]);
  }
  return null;
};

type DriveseedHit = { server: string; url: string; driveseedRedirectUrl: string };

/* ── main ── */

export async function resolveMoviesMod(opts: MoviesModOpts): Promise<MoviesModResult> {
  const { title, year, kind, season, episode } = opts;
  const d: string[] = [`mm5: "${title.slice(0, 60)}" ${kind}${kind === "series" ? ` s${season}e${episode}` : ""}`];
  const cacheKey = `mm:v1:${kind}:${season}:${episode}:${title}:${year || ""}`;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_TTL) {
    return { ...cached.data, diag: `${cached.data.diag} | cached` };
  }

  const base = await pickDomain(d);
  const hits = await searchBlog(base, title, d);
  if (!hits.length) {
    const out: MoviesModResult = { title, streams: [], captions: [], noSource: true, diag: d.join(" | ") };
    return out;
  }
  const picked = pickResult(hits, title, year, kind, d);
  if (!picked) {
    return { title, streams: [], captions: [], noSource: false, diag: d.join(" | ") };
  }
  const lang = isHindiPost(picked.title) ? "Hindi" : "";
  let links = await extractDownloadLinks(picked.url, d);
  if (!links.length) throw new Error(`mm: no download links (${d.join(" | ").slice(0, 100)})`);
  /* one row per tier: drop 10bit/HEVC when an x264 tier-mate exists
   * (browsers can't play HEVC anyway; each spare quality costs ~8
   * subrequests and CF free allows 50/invocation) */
  {
    const byTier = new Map<string, QualityLink[]>();
    for (const l of links) {
      const t = extractQuality(l.quality);
      const arr = byTier.get(t) || [];
      arr.push(l);
      byTier.set(t, arr);
    }
    const kept: QualityLink[] = [];
    for (const [, arr] of byTier) {
      const x264 = arr.filter((l) => !/10bit|hevc|x265/i.test(l.quality));
      kept.push(...(x264.length ? x264 : arr));
    }
    if (kept.length !== links.length) d.push(`tiers: ${links.length} -> ${kept.length}`);
    links = kept;
  }

  if (kind === "series") {
    const n = season;
    const rx = new RegExp(`\\bseason\\s*0*${n}\\b|\\bs0*${n}e\\d|\\bs0*${n}\\b`, "i");
    const before = links.length;
    links = links.filter((l) => rx.test(l.quality));
    d.push(`season-filter: ${before} -> ${links.length}`);
    if (!links.length) {
      return { title: picked.title, streams: [], captions: [], noSource: false, diag: d.join(" | ") };
    }
  }

  /* per-quality: intermediate -> driveseed redirect urls (parallel) */
  type Q = { quality: string; hits: DriveseedHit[] };
  const qJobs = links.map(async (link): Promise<Q | null> => {
    try {
      const servers = await resolveIntermediate(link.url, picked.url, link.quality, d);
      /* one link per quality (CSX-style) + a single fallback: each SID
       * costs ~4 subrequests and CF free allows 50/invocation */
      for (const s of servers.slice(0, 2)) {
        try {
          let cur = s.url;
          if (isSidUrl(cur)) {
            const sid = await resolveSid(cur);
            if (!sid) continue;
            cur = sid;
          }
          if (cur.includes("driveseed.org") || cur.includes("driveleech")) {
            const hit: DriveseedHit = { server: s.server, url: s.url, driveseedRedirectUrl: cur };
            return { quality: link.quality, hits: [hit] };
          }
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
  });
  let qualities = (await Promise.all(qJobs)).filter((x): x is Q => !!x);
  d.push(`resolved: ${qualities.length}/${links.length} qualities`);
  if (!qualities.length) throw new Error(`mm: intermediates dead (${d.join(" | ").slice(0, 100)})`);

  /* tv: keep only this episode's server links */
  if (kind === "series") {
    qualities = qualities
      .map((q) => ({ ...q, hits: q.hits.filter((h) => episodeNumOf(h.server) === episode) }))
      .filter((q) => q.hits.length > 0);
    d.push(`episode-filter: ${qualities.length} qualities left`);
    if (!qualities.length) {
      return { title: picked.title, streams: [], captions: [], noSource: false, diag: d.join(" | ") };
    }
  }

  /* per-link: redirect -> file page -> final cdn url (parallel) */
  const notes: string[] = [];
  const note = (s: string) => {
    if (notes.length < 22) notes.push(s);
  };
  const seenFiles = new Set<string>();
  const seenUrls = new Set<string>();
  const streams: MoviesModStream[] = [];
  const fJobs = qualities.map(async (q): Promise<MoviesModStream[]> => {
    const jobs = q.hits.map(async (h): Promise<MoviesModStream | null> => {
      try {
        try {
          note(`rh:${new URL(h.driveseedRedirectUrl).hostname}`);
        } catch {}
        note(`ru:${h.driveseedRedirectUrl.slice(0, 100)}`);
        const fp = await followRedirectToFilePage(h.driveseedRedirectUrl, note);
        const info = filePageInfo(fp.html);
        note(`fi:${info.size || 0}/${info.name ? info.name.slice(0, 24) : "noname"}`);
        if (info.name && seenFiles.has(info.name)) return null;
        let final = await extractFinalDownload(fp.html, fp.url, note);
        if (!final) return null;
        if (final.includes("cdn.video-leech.pro")) final = await unwrapVideoLeech(final);
        if (seenUrls.has(final)) return null;
        seenUrls.add(final);
        if (info.name) seenFiles.add(info.name);
        return {
          url: final,
          quality: extractQuality(q.quality),
          size: info.size,
          platform: "MoviesMod",
          lang,
        };
      } catch (e) {
        note(`err:${(e instanceof Error ? e.message : "?").slice(0, 70)}`);
        return null;
      }
    });
    return (await Promise.all(jobs)).filter((x): x is MoviesModStream => !!x);
  });
  for (const batch of await Promise.all(fJobs)) streams.push(...batch);
  streams.sort((a, b) => qualityNum(b.quality) - qualityNum(a.quality) || b.size - a.size);
  d.push(`streams: ${streams.length}`);
  d.push(`final: ${notes.join("; ") || "nolinks"}`);

  const out: MoviesModResult = {
    title: picked.title,
    streams,
    captions: [],
    noSource: false,
    diag: d.join(" | "),
  };
  if (streams.length) {
    resultCache.set(cacheKey, { at: Date.now(), data: out });
    if (resultCache.size > 50) resultCache.delete(resultCache.keys().next().value as string);
  }
  return out;
}
