/* Nuvio Hindi lane (Server 15): XDMovies + HindMoviez, ported from
 * phisher98/phisher-nuvio-providers (Sept 2026). TMDB title/id in,
 * direct files out (HubCloud FSL / HubCDN HLS / Pixeldrain /
 * StreamTape / vidmoly-family + direct passthrough), played in
 * HindiSources/SitePlayer. Movies + series.
 * Deviations from upstream (all robustness wins): no TMDB call (we
 * already have title/year/id), gdflix/gofile skipped (upstream calls
 * extractors that don't exist and crashes the run), HindMoviez
 * buttons go through the full extractor (upstream only tries the
 * vidmoly family), unknown hosts must pass a HEAD check (upstream
 * passes unplayable pages through as rows).
 * Edge-safe: native fetch + regex, no deps. Budget ~35 cold. */

export type NuvioArgs = {
  title: string;
  year?: string;
  tmdbId: number;
  kind: "movie" | "series";
  season: number;
  episode: number;
};

export type NuvioStream = {
  url: string;
  quality: string;
  size?: number;
  platform: string;
  lang: string;
};

export type NuvioResult = {
  title: string;
  streams: NuvioStream[];
  captions: { lang: string; name: string; url: string }[];
  noSource: boolean;
  laneError?: string;
  diag: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const T_GET = 9000;
const T_HEAD = 6000;
const RESULT_TTL = 4 * 3600 * 1000;

const XD_BASES = ["https://new.xdmovies.wtf", "https://top.xdmovies.wtf"];
const XD_TOKEN = "7297skkihkajwnsgaklakshuwd";
const XD_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
  "x-auth-token": XD_TOKEN,
};
const HMZ_BASES = ["https://hindmovie.fit", "https://hindmoviez.cafe"];
const HMZ_HEADERS = { "User-Agent": UA };

const resultCache = new Map<string, { at: number; data: NuvioResult }>();

type GetOut = { status: number; text: string; url: string };

async function httpGet(url: string, headers?: Record<string, string>, timeoutMs = T_GET): Promise<GetOut> {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*", ...headers },
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, text, url: res.url || url };
  } finally {
    clearTimeout(killer);
  }
}

async function httpHead(url: string): Promise<{ status: number; type: string }> {
  try {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), T_HEAD);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA, Range: "bytes=0-1" },
        signal: ctrl.signal,
      });
      return { status: res.status, type: res.headers.get("content-type") || "" };
    } finally {
      clearTimeout(killer);
    }
  } catch {
    return { status: 0, type: "" };
  }
}

/* HEAD with redirect-following (edge can't read manual Location) */
async function headFollow(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), T_HEAD);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA },
        signal: ctrl.signal,
      });
      return res.url || url;
    } finally {
      clearTimeout(killer);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("headFollow: timeout");
    }
    throw err;
  }
}

const strip = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const absUrl = (href: string, base: string): string | null => {
  try {
    const u = new URL(href, base);
    return /^https?:$/i.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};

/* anchors whose OPEN TAG matches cls (attribute-order agnostic:
 * class-before-href regexes silently miss href-first markup) */
function anchorsWithClass(html: string, cls: RegExp): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const open = m[0].slice(0, m[0].indexOf(">") + 1);
    if (!cls.test(open)) continue;
    const href = /href="([^"]+)"/i.exec(open)?.[1];
    if (!href) continue;
    out.push({ href, text: strip(m[1]).slice(0, 120) });
  }
  return out;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const qualityOf = (s: string): string => {
  const m = /(\d{3,4})\s?[pP]|(4k)/i.exec(s || "");
  if (!m) return "Auto";
  if (m[2]) return "2160p";
  const n = Number(m[1]);
  return n >= 2000 ? "2160p" : `${n}p`;
};

const sizeBytes = (s: string): number => {
  const m = /([\d.]+)\s*(GB|MB|KB)/i.exec(s || "");
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  return Math.round(v * (u === "GB" ? 1024 ** 3 : u === "MB" ? 1024 ** 2 : 1024));
};

/* Dean Edwards packer unpack (verbatim port from the nuvio extractors) */
function unpack(packed: string): string | null {
  const dq = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\).*?return\s+p\s*}\s*\(\s*"(.*?)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"(.*?)"\.split\("\|"\)/s;
  const sq = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\).*?return\s+p\s*}\s*\(\s*'(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)/s;
  const match = dq.exec(packed) || sq.exec(packed);
  if (!match) return null;
  let p = match[1];
  const a = parseInt(match[2], 10);
  let c = parseInt(match[3], 10);
  const k = match[4].split("|");
  const e = (n: number): string =>
    (n < a ? "" : e(Math.floor(n / a))) + (n % a > 35 ? String.fromCharCode((n % a) + 29) : (n % a).toString(36));
  while (c--) {
    if (k[c]) p = p.replace(new RegExp(`\\b${e(c)}\\b`, "g"), k[c]);
  }
  return p;
}

/* ── vidmoly-family extractors (shared wrapper) ── */

async function extractVidmolyFamily(url: string): Promise<string | null> {
  const h = hostOf(url);
  try {
    const r = await httpGet(url, h.includes("voe.") ? undefined : { Referer: url });
    if (r.status < 200 || r.status >= 400) return null;
    if (h.includes("vidmoly")) return /file:\s*["'](.*?m3u8.*?)["']/i.exec(r.text)?.[1] || null;
    if (h.includes("voe.sx") || h.includes("voe.network")) return /hls':\s*'(.*?)'/i.exec(r.text)?.[1] || null;
    const up = unpack(r.text);
    if (!up) return null;
    if (h.includes("filemoon") || h.includes("abyssplayer") || h.includes("rubystm")) {
      return /file:\s*["'](.*?m3u8.*?)["']/i.exec(up)?.[1] || null;
    }
    return /sources:\s*\[\s*{\s*file:\s*["'](.*?m3u8.*?)["']/i.exec(up)?.[1] || null;
  } catch {
    return null;
  }
}

const VIDMOLY_FAM = ["vidmoly", "filemoon", "abyssplayer", "rubystm", "streamhide", "cloudy.upns", "gdmirrorbot", "emturbovid", "voe.sx", "voe.network"];
const SKIP_HOSTS = ["linkrit", "google.", "ampproject.org", "gstatic.", "doubleclick.", "ddl2", "gdflix", "gofile"];
const DIRECT_EXT = /\.(mp4|m3u8|mkv|avi)(\?|#|$)/i;

/* ── hub-family extractors (xdmovies port) ── */

async function extractPixeldrain(link: string, fallbackQuality: string): Promise<NuvioStream[]> {
  const fileId = /(?:file|u)\/([A-Za-z0-9]+)/.exec(link)?.[1] || link.split("/").pop() || "";
  const direct = `https://pixeldrain.com/api/file/${fileId}?download`;
  if (!fileId) return [{ url: link, quality: "Auto", platform: "Pixeldrain", lang: "" }];
  try {
    const r = await httpGet(`https://pixeldrain.com/api/file/${fileId}/info`, HMZ_HEADERS);
    if (r.status >= 200 && r.status < 400) {
      const info = JSON.parse(r.text) as { name?: string; size?: number };
      return [
        {
          url: direct,
          quality: qualityOf(info.name || "") !== "Auto" ? qualityOf(info.name || "") : fallbackQuality,
          size: typeof info.size === "number" ? info.size : undefined,
          platform: "Pixeldrain",
          lang: "",
        },
      ];
    }
  } catch {}
  return [{ url: direct, quality: fallbackQuality, platform: "Pixeldrain", lang: "" }];
}

async function extractStreamtape(link: string): Promise<NuvioStream[]> {
  try {
    const u = new URL(link);
    u.hostname = "streamtape.com";
    const r = await httpGet(u.toString(), HMZ_HEADERS);
    if (r.status < 200 || r.status >= 400) return [];
    const inner = /document\.getElementById\('videolink'\)\.innerHTML = (.*?);/i.exec(r.text)?.[1] || r.text;
    const m = /'(\/\/streamtape\.com\/get_video[^']+)'/i.exec(inner);
    if (m) return [{ url: `https:${m[1]}`, quality: "Auto", platform: "StreamTape", lang: "" }];
    return [];
  } catch {
    return [];
  }
}

async function extractHubCdn(url: string, tag: string, note: (s: string) => void): Promise<NuvioStream[]> {
  try {
    const r = await httpGet(url, HMZ_HEADERS);
    const enc = /r=([A-Za-z0-9+/=]+)/.exec(r.text)?.[1];
    if (!enc) {
      note("hubcdn:nor");
      return [];
    }
    const data = atob(enc);
    const link = data.slice(data.lastIndexOf("link=") + 5).trim();
    if (!/^https?:/i.test(link)) {
      note("hubcdn:badlink");
      return [];
    }
    note("hubcdn:m3u8");
    return [{ url: link, quality: qualityOf(link), platform: `${tag} · HubCDN`, lang: "" }];
  } catch {
    return [];
  }
}

type Btn = { href: string; text: string };

async function extractHubCloud(
  url: string, referer: string, tag: string, note: (s: string) => void, depth = 0
): Promise<NuvioStream[]> {
  if (depth > 1) return [];
  let cur = url.includes("hubcloud.ink") ? url.replace("hubcloud.ink", "hubcloud.dad") : url;
  try {
    if (/\/(video|drive)\//i.test(cur)) {
      const r = await httpGet(cur, { Referer: referer });
      const php = /<a\b[^>]*href="([^"]*hubcloud\.php[^"]*)"/i.exec(r.text)?.[1];
      if (!php) return [];
      const abs = absUrl(php, cur);
      return abs ? extractHubCloud(abs, cur, tag, note, depth + 1) : [];
    }
    let r = await httpGet(cur, { Referer: referer });
    if (r.status < 200 || r.status >= 400) return [];
    if (!cur.includes("hubcloud.php")) {
      const second = /var url = '([^']*)'/i.exec(r.text)?.[1];
      if (second) {
        const abs = absUrl(second, cur);
        if (!abs) return [];
        cur = abs;
        r = await httpGet(cur, { Referer: referer });
        if (r.status < 200 || r.status >= 400) return [];
      }
    }
    const size = strip(/<i\b[^>]*id="size"[^>]*>([^<]*)<\/i>/i.exec(r.text)?.[1] || "");
    const header = strip(/<div\b[^>]*class="[^"]*card-header[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(r.text)?.[1] || "");
    const quality = qualityOf(header);
    const bytes = sizeBytes(size);
    const btns: Btn[] = [];
    for (const a of anchorsWithClass(r.text, /class="[^"]*btn/i)) {
      if (/telegram/i.test(a.text) || /telegram/i.test(a.href)) continue;
      btns.push({ href: a.href, text: a.text });
      if (btns.length >= 8) break;
    }
    const rank = (b: Btn): number => {
      if (b.text.includes("FSL V2")) return 0;
      if (/\bFSL\b/.test(b.text)) return 1;
      if (b.text.includes("S3 Server")) return 2;
      if (b.text.includes("Download File")) return 3;
      if (b.text.includes("10Gbps")) return 4;
      if (b.href.includes("pixeldra")) return 5;
      return 9;
    };
    btns.sort((a, b) => rank(a) - rank(b));
    const rows: NuvioStream[] = [];
    for (const b of btns.slice(0, 3)) {
      if (b.href.includes("pixeldra")) {
        const px = await extractPixeldrain(b.href, quality);
        for (const p of px) rows.push({ ...p, platform: `${tag} · ${p.platform}`, size: p.size || bytes || undefined });
        continue;
      }
      if (b.text.includes("BuzzServer")) {
        note("hub:buzz-skip");
        continue;
      }
      const abs = absUrl(b.href, cur);
      if (!abs) continue;
      if (b.text.includes("10Gbps")) {
        const fin = await headFollow(abs);
        const m = /link=([^&]+)/i.exec(fin);
        rows.push({
          url: m ? decodeURIComponent(m[1]) : fin,
          quality,
          size: bytes || undefined,
          platform: `${tag} · HubCloud 10Gbps`,
          lang: "",
        });
        continue;
      }
      const label = b.text.includes("FSL V2")
        ? "FSL V2"
        : /\bFSL\b/.test(b.text)
          ? "FSL"
          : b.text.includes("S3 Server")
            ? "S3"
            : "Download";
      rows.push({ url: abs, quality, size: bytes || undefined, platform: `${tag} · HubCloud ${label}`, lang: "" });
    }
    note(`hub:${rows.length}btns`);
    return rows;
  } catch {
    return [];
  }
}

/* unified final resolver (both providers; stricter than upstream) */
async function resolveFinal(
  url: string, referer: string, tag: string, note: (s: string) => void, depth = 0
): Promise<NuvioStream[]> {
  const h = hostOf(url);
  if (!h || depth > 2) return [];
  const mk = (u: string, platform: string, quality = "Auto", size?: number): NuvioStream => ({ url: u, quality, size, platform, lang: "" });
  if (SKIP_HOSTS.some((s) => h.includes(s))) {
    note(`skip:${h.split(".")[0]}`);
    return [];
  }
  if (h.includes("hubcloud")) return extractHubCloud(url, referer, tag, note);
  if (h.includes("hubcdn")) return extractHubCdn(url, tag, note);
  if (h.includes("pixeldrain")) return (await extractPixeldrain(url, "Auto")).map((p) => ({ ...p, platform: `${tag} · ${p.platform}` }));
  if (h.includes("streamtape")) {
    return (await extractStreamtape(url)).map((p) => ({ ...p, platform: `${tag} · ${p.platform}` }));
  }
  if (h.includes("hubdrive")) {
    try {
      const r = await httpGet(url, { Referer: referer });
      const href = anchorsWithClass(r.text, /btn-success1/i)[0]?.href;
      const abs = href ? absUrl(href, url) : null;
      return abs ? resolveFinal(abs, url, tag, note, depth + 1) : [];
    } catch {
      return [];
    }
  }
  if (h.includes("hblinks")) {
    try {
      const r = await httpGet(url, { Referer: referer });
      const hrefs: string[] = [];
      for (const bm of r.text.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
        const a = /<a\b[^>]*href="([^"]+)"/i.exec(bm[1])?.[1];
        if (a) hrefs.push(a);
        if (hrefs.length >= 2) break;
      }
      const out: NuvioStream[] = [];
      for (const href of hrefs) {
        const abs = absUrl(href, url);
        if (abs) out.push(...(await resolveFinal(abs, url, tag, note, depth + 1)));
      }
      return out;
    } catch {
      return [];
    }
  }
  if (h.includes("hubstream") || h.includes("hdstream4u")) {
    return [mk(url, `${tag} · ${h.includes("hubstream") ? "HubStream" : "HdStream4u"}`)];
  }
  if (VIDMOLY_FAM.some((s) => h.includes(s))) {
    const file = await extractVidmolyFamily(url);
    if (!file || !/^https?:/i.test(file)) {
      note(`vfam:${h.split(".")[0]}=none`);
      return [];
    }
    note(`vfam:${h.split(".")[0]}=m3u8`);
    return [mk(file, `${tag} · ${h.split(".")[0]}`, qualityOf(file))];
  }
  /* unknown host: HEAD-gated passthrough (upstream passes blindly) */
  if (DIRECT_EXT.test(url) || url.includes("/api/file/") || url.includes(".cloudflarestorage.com")) {
    const st = await httpHead(url);
    if ((st.status >= 200 && st.status < 400) || st.status === 0) {
      return [mk(url, `${tag} · Direct`, qualityOf(url))];
    }
    note(`val:${h.split(".")[0]}=${st.status}`);
    return [];
  }
  const st = await httpHead(url);
  if (st.status >= 200 && st.status < 400 && /video|mpeg|octet-stream/i.test(st.type)) {
    return [mk(url, `${tag} · Direct`, qualityOf(url))];
  }
  note(`drop:${h.split(".")[0]}`);
  return [];
}

/* ── XDMovies (exact tmdb_id match via their search API) ── */

async function resolveXD(args: NuvioArgs, d: string[], note: (s: string) => void): Promise<NuvioStream[]> {
  const { title, tmdbId, kind, season, episode } = args;
  let base = "";
  let items: { tmdb_id?: number | string; path?: string; title?: string; name?: string }[] = [];
  for (const b of XD_BASES) {
    try {
      const r = await httpGet(
        `${b}/php/search_api.php?query=${encodeURIComponent(title)}&fuzzy=true`,
        { ...XD_HEADERS, Referer: `${b}/` }
      );
      if (r.status < 200 || r.status >= 400) {
        d.push(`xd:${b.split(".")[1]}=http${r.status}`);
        continue;
      }
      const j = JSON.parse(r.text) as unknown;
      if (!Array.isArray(j)) {
        d.push(`xd:${b.split(".")[1]}=nojson`);
        continue;
      }
      base = b;
      items = j;
      break;
    } catch {
      d.push(`xd:${b.split(".")[1]}=err`);
    }
  }
  if (!base) return [];
  d.push(`xd:search:${items.length}`);
  const matched = items.find((x) => Number(x.tmdb_id) === tmdbId);
  if (!matched?.path) {
    d.push("xd:match:none");
    return [];
  }
  d.push("xd:match:tmdb");
  const lang = /hindi|dubbed|dual/i.test(`${matched.title || ""} ${matched.name || ""} ${title}`) ? "Hindi" : "";
  let html = "";
  d.push(`xd:path:${(matched.path || "").slice(0, 60)}`);
  const pageBases = [base, ...XD_BASES.filter((b) => b !== base)];
  const headerSets: { mode: string; h: Record<string, string> }[] = [
    { mode: "xd", h: { ...XD_HEADERS, Referer: `${base}/` } },
    { mode: "plain", h: { "User-Agent": UA, Referer: `${base}/`, Accept: "text/html,*/*" } },
  ];
  let pageOk = "";
  for (const pb of pageBases) {
    for (const hs of headerSets) {
      try {
        const r = await httpGet(`${pb}${matched.path}`, hs.h);
        if (r.status >= 200 && r.status < 400) {
          html = r.text;
          pageOk = `${pb.split(".")[1]}:${hs.mode}`;
          break;
        }
        d.push(`xd:page:${pb.split(".")[1]}:${hs.mode}=http${r.status}`);
      } catch (e) {
        d.push(`xd:page:${pb.split(".")[1]}:${hs.mode}=err:${(e instanceof Error ? e.message : "?").slice(0, 20)}`);
      }
    }
    if (pageOk) break;
  }
  if (!pageOk) return [];
  d.push(`xd:page:ok:${pageOk}`);
  const raws: string[] = [];
  if (kind === "movie") {
    for (const chunk of html.split("download-item").slice(1, 8)) {
      const href = /<a\b[^>]*href="([^"]+)"/i.exec(chunk)?.[1];
      if (href) raws.push(href);
      if (raws.length >= 4) break;
    }
  } else {
    const want = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`.toLowerCase();
    for (const chunk of html.split("episode-card").slice(1, 12)) {
      if (!chunk.toLowerCase().includes(want)) continue;
      for (const m of chunk.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
        raws.push(m[1]);
        if (raws.length >= 4) break;
      }
      if (raws.length >= 4) break;
    }
  }
  d.push(`xd:links:${raws.length}`);
  const jobs = raws.slice(0, 4).map(async (raw): Promise<NuvioStream[]> => {
    try {
      const abs = absUrl(raw, base);
      if (!abs) return [];
      let fin = abs;
      if (hostOf(abs).includes("xdmovies")) {
        fin = await headFollow(abs);
        if (fin === abs) {
          try {
            fin = (await httpGet(abs, { ...XD_HEADERS, Referer: base })).url;
          } catch {}
        }
      }
      const rows = await resolveFinal(fin, base, "XD", note);
      return rows.map((r) => ({ ...r, lang }));
    } catch {
      return [];
    }
  });
  return (await Promise.all(jobs)).flat();
}

/* ── HindMoviez (title search + maxbutton/get-links/a.btn chain) ── */

type Hit = { title: string; url: string };

function parseHmzSearch(html: string, base: string): Hit[] {
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const a = /<h2\b[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(m[1]);
    if (!a) continue;
    const abs = absUrl(a[1], base);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push({ title: strip(a[2]).slice(0, 140), url: abs });
    if (out.length >= 12) break;
  }
  return out;
}

const normWords = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);

async function resolveHMZ(args: NuvioArgs, d: string[], note: (s: string) => void): Promise<NuvioStream[]> {
  const { title, year = "", kind, season, episode } = args;
  let base = "";
  let searchHtml = "";
  for (const b of HMZ_BASES) {
    try {
      const r = await httpGet(`${b}/page/1/?s=${encodeURIComponent(title)}`, HMZ_HEADERS);
      if (r.status < 200 || r.status >= 400) continue;
      if (!/<article\b/i.test(r.text)) continue;
      base = b;
      searchHtml = r.text;
      break;
    } catch {}
  }
  if (!base) {
    d.push("hmz:search:fail");
    return [];
  }
  const hits = parseHmzSearch(searchHtml, base);
  d.push(`hmz:search:${hits.length}`);
  const qw = normWords(title);
  const scored = hits.map((h) => {
    const hw = new Set(normWords(h.title));
    const overlap = qw.length ? qw.filter((w) => hw.has(w)).length / qw.length : 0;
    const yearHit = !!year && h.title.includes(year);
    const hindiHit = /hindi|dubbed|dual/i.test(h.title);
    const seasonHit = new RegExp(`season\\s*0*${season}\\b`, "i").test(h.title);
    let score = overlap * 10 + (yearHit ? 2 : 0) + (hindiHit ? 1 : 0);
    if (kind === "series") score += seasonHit ? 4 : -3;
    return { h, overlap, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.overlap < 0.34) {
    d.push("hmz:match:none");
    return [];
  }
  d.push(top.overlap >= 0.66 ? "hmz:match:strict" : "hmz:match:loose");
  const postUrl = top.h.url;
  const lang = /hindi|dubbed|dual/i.test(top.h.title) ? "Hindi" : "";
  let post = "";
  try {
    const r = await httpGet(postUrl, { ...HMZ_HEADERS, Referer: base });
    if (r.status < 200 || r.status >= 400) return [];
    post = r.text;
  } catch {
    return [];
  }
  d.push(`hmz:post:"${top.h.title.slice(0, 40)}"`);
  const finals: string[] = [];
  let firstLinkHtml = "";
  if (kind === "movie") {
    const btns: string[] = [];
    for (const a of anchorsWithClass(post, /class="[^"]*maxbutton/i)) {
      const abs = absUrl(a.href, postUrl);
      if (abs) btns.push(abs);
      if (btns.length >= 2) break;
    }
    d.push(`hmz:btns:${btns.length}`);
    const linkPages: string[] = [];
    await Promise.all(
      btns.map(async (b) => {
        try {
          const r = await httpGet(b, { ...HMZ_HEADERS, Referer: postUrl });
          if (r.status < 200 || r.status >= 400) return;
          for (const m of r.text.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
            if (!/get links/i.test(strip(m[2]))) continue;
            const abs = absUrl(m[1], b);
            if (abs) {
              linkPages.push(abs);
              break;
            }
          }
        } catch {}
      })
    );
    d.push(`hmz:linkpages:${linkPages.length}`);
    await Promise.all(
      linkPages.slice(0, 2).map(async (lp) => {
        try {
          const r = await httpGet(lp, { ...HMZ_HEADERS, Referer: postUrl });
          if (r.status < 200 || r.status >= 400) return;
          let H = r.text;
          if (!firstLinkHtml) firstLinkHtml = H;
          let btns = [...anchorsWithClass(H, /class="[^"]*\bbtn\b/i)];
          if (!btns.length) {
            /* stub page? follow one meta-refresh / JS-location hop */
            const meta = /<meta[^>]*http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i.exec(H)?.[1]
              || /url=([^"'>\s]+)[^>]*http-equiv=["']?refresh/i.exec(H)?.[1];
            const js = /(?:location\.(?:href|replace)|window\.location\s*=)\s*\(?\s*["']([^"']+)["']/i.exec(H)?.[1];
            const hop = absUrl(meta || js || "", lp);
            if (hop && hop !== lp) {
              try {
                const r2 = await httpGet(hop, { ...HMZ_HEADERS, Referer: lp });
                if (r2.status >= 200 && r2.status < 400) {
                  H = r2.text;
                  if (H.length > firstLinkHtml.length) firstLinkHtml = H;
                  note(`hmz:follow:${hostOf(hop)}`);
                  btns = [...anchorsWithClass(H, /class="[^"]*\bbtn\b/i)];
                }
              } catch {}
            }
          }
          for (const a of btns) {
            if (/^https?:/i.test(a.href)) finals.push(a.href);
            if (finals.length >= 4) break;
          }
        } catch {}
      })
    );
  } else {
    const sm = new RegExp(`<h3\\b[^>]*>[^<]*Season\\s*0*${season}\\b[^<]*</h3>\\s*<p\\b[^>]*>\\s*<a\\b[^>]*href="([^"]+)"`, "i").exec(post);
    const listAbs = sm ? absUrl(sm[1], postUrl) : null;
    if (!listAbs) {
      d.push("hmz:ep:nolist");
      return [];
    }
    try {
      const r = await httpGet(listAbs, { ...HMZ_HEADERS, Referer: postUrl });
      if (r.status < 200 || r.status >= 400) return [];
      const em = new RegExp(`<h3\\b[^>]*>\\s*<a\\b[^>]*href="([^"]+)"[^>]*>[^<]*Episode\\s*0*${episode}\\b`, "i").exec(r.text);
      const epAbs = em ? absUrl(em[1], listAbs) : null;
      if (!epAbs) {
        d.push("hmz:ep:noep");
        return [];
      }
      const r2 = await httpGet(epAbs, { ...HMZ_HEADERS, Referer: postUrl });
      if (r2.status < 200 || r2.status >= 400) return [];
      for (const a of anchorsWithClass(r2.text, /class="[^"]*\bbtn\b/i)) {
        if (/^https?:/i.test(a.href)) finals.push(a.href);
        if (finals.length >= 3) break;
      }
      d.push(`hmz:ep:btns:${finals.length}`);
    } catch {
      return [];
    }
  }
  d.push(`hmz:finals:${finals.length}`);
  if (!finals.length && firstLinkHtml) {
    const H = firstLinkHtml;
    const marks = [
      /class="[^"]*btn/i.test(H) ? "BTN" : "",
      H.includes("hubcloud") ? "HUB" : "",
      H.includes("gdflix") ? "GDF" : "",
      H.includes("hubdrive") ? "HDR" : "",
      /Just a moment|__cf_chl|cf-clearance/i.test(H) ? "CF" : "",
    ]
      .filter((x) => x)
      .join(",");
    const hrefs = (H.match(/href="/gi) || []).length;
    note(`hmz:m:${marks || "none"}/hrefs${hrefs}/${H.length}`);
    const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(H)?.[1] || "";
    if (pageTitle) note(`hmz:t:${strip(pageTitle).slice(0, 50)}`);
    const firstJs = /<script[^>]*src="([^"]+)"/i.exec(H)?.[1] || "";
    if (firstJs) note(`hmz:js:${firstJs.slice(0, 60)}`);
    const ki = H.indexOf('href="http');
    if (ki >= 0) {
      note(`hmz:snip:${H.slice(Math.max(0, ki - 80), ki + 140).replace(/\s+/g, " ").slice(0, 220)}`);
    }
  }
  const jobs = finals.slice(0, 4).map(async (f): Promise<NuvioStream[]> => {
    try {
      const rows = await resolveFinal(f, postUrl, "HMZ", note);
      return rows.map((r) => ({ ...r, lang }));
    } catch {
      return [];
    }
  });
  return (await Promise.all(jobs)).flat();
}

/* ── aggregate ── */

export async function resolveNuvio(args: NuvioArgs): Promise<NuvioResult> {
  const { title, year = "", tmdbId, kind, season, episode } = args;
  const d: string[] = [`nv: "${title.slice(0, 60)}" ${kind}`];
  const notes: string[] = [];
  const note = (s: string) => {
    if (notes.length < 18) notes.push(s);
  };
  const cacheKey = `nv:${kind}:${tmdbId}:${season}:${episode}`;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_TTL) return cached.data;
  const diag = () => `${d.join(" | ")}${notes.length ? ` | final: ${notes.join("; ")}` : ""}`;

  const [xd, hmz] = await Promise.all([
    resolveXD(args, d, note).catch((e): NuvioStream[] => {
      note(`xd:err:${(e instanceof Error ? e.message : "?").slice(0, 30)}`);
      return [];
    }),
    resolveHMZ(args, d, note).catch((e): NuvioStream[] => {
      note(`hmz:err:${(e instanceof Error ? e.message : "?").slice(0, 30)}`);
      return [];
    }),
  ]);
  const seen = new Set<string>();
  const streams = [...xd, ...hmz]
    .filter((r) => r.url && !seen.has(r.url) && (seen.add(r.url), true))
    .slice(0, 8);
  d.push(`streams: ${streams.length}`);

  const data: NuvioResult = {
    title: `${title}${year ? ` (${year})` : ""}`.slice(0, 140),
    streams,
    captions: [],
    noSource: streams.length === 0,
    diag: diag(),
  };
  if (!data.noSource) resultCache.set(cacheKey, { at: Date.now(), data });
  return data;
}
