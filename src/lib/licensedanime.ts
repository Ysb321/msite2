/* Licensed anime lane (Server 18) — official rightsholder channels only.
 *
 * WHY THIS LANE EXISTS
 * The other anime option on the site (MegaPlay, "Anime 1") frames a
 * third-party aggregator. This lane instead resolves episodes on the
 * YouTube channels the licensors themselves operate, where the copyright
 * holder is the uploader:
 *   - Muse Asia  (MUSE Communication Singapore, UCGbshtvS9t-8CW11W7TooQg)
 *     SEA/India simulcast licensee; official subs, full episodes, free.
 *   - Ani-One Asia (MediaLink Entertainment HK, UC0wNSTMWIL3qaorLx0jie6A)
 *     Asia licensee; English + regional subs, some dubs.
 *   - Gundam Channel INTL (Sunrise/Bandai Namco's own channel) — the
 *     Gundam library, official subs/dubs.
 * Nothing here is scraped off a file locker: we resolve a TMDB title to a
 * video id ON those channels and embed YouTube's own player, so playback
 * counts for the licensor and the ads/revenue reach them.
 *
 * RESOLUTION
 * TMDB carries no YouTube ids, so we search the channels by title +
 * episode. Two strategies, in order:
 *   1. YouTube Data API v3 (`YOUTUBE_API_KEY` set) — search.list scoped
 *      to each channelId. Quota-cheap for our volume, stable shape.
 *   2. HTML fallback — the channel search page
 *      (youtube.com/channel/{id}/search?query=) and its embedded
 *      ytInitialData blob. No key needed; used when no key is configured.
 * Candidates are then scored on title similarity + episode-number match,
 * and anything below the floor is dropped (better an empty state than the
 * wrong episode).
 *
 * REGION NOTE: Muse Asia / Ani-One licences are territorial (SEA + India
 * for most Muse titles). A video that exists may still be unplayable
 * outside the licensed region — YouTube's player surfaces that itself.
 */

export type LicensedKind = "sub" | "dub" | "unknown";

export type LicensedSource = {
  key: string;
  videoId: string;
  title: string;
  channel: string;
  /** watch url (attribution / "open on YouTube") */
  url: string;
  /** privacy-enhanced embed url */
  embed: string;
  length?: string;
  published?: string;
  episode?: number;
  audio: LicensedKind;
  score: number;
};

export type LicensedResult = {
  title: string;
  sources: LicensedSource[];
  noSource?: boolean;
  laneError?: string;
  diag?: string;
};

type Channel = { id: string; name: string; note?: string };

/** Official licensor channels. Extend via LICENSED_ANIME_CHANNELS
 *  ("Name:UCxxxx,Name2:UCyyyy") — ONLY add channels operated by the
 *  rightsholder or their appointed licensee. */
const BUILTIN_CHANNELS: Channel[] = [
  { id: "UCGbshtvS9t-8CW11W7TooQg", name: "Muse Asia", note: "SEA/India licensee" },
  { id: "UC0wNSTMWIL3qaorLx0jie6A", name: "Ani-One Asia", note: "MediaLink licensee" },
  { id: "UCkdIq9j7cQQxHZfXpu9ZO4Q", name: "Gundam Channel INTL", note: "Sunrise/Bandai Namco" },
];

export function channels(): Channel[] {
  const extra = (process.env.LICENSED_ANIME_CHANNELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.lastIndexOf(":");
      if (i < 1) return null;
      const name = pair.slice(0, i).trim();
      const id = pair.slice(i + 1).trim();
      return /^UC[\w-]{20,}$/.test(id) ? { id, name } : null;
    })
    .filter(Boolean) as Channel[];
  const seen = new Set<string>();
  return [...BUILTIN_CHANNELS, ...extra].filter((c) => !seen.has(c.id) && seen.add(c.id));
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const TIMEOUT_MS = 9000;

async function get(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/json,*/*",
        ...headers,
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/* ── title / episode matching ─────────────────────────────────────────── */

const STOP = new Set(["the", "a", "an", "of", "no", "wa", "to", "wo", "season", "part", "tv", "anime"]);

const norm = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => norm(s).split(" ").filter((w) => w && !STOP.has(w));

/** token-overlap similarity of the TMDB title against a video title (0..1) */
function similarity(want: string, got: string) {
  const a = tokens(want);
  const b = new Set(tokens(got));
  if (!a.length) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.length;
}

const EP_PATTERNS: RegExp[] = [
  /\bepisode\s*0*(\d{1,4})\b/i,
  /\bep\.?\s*0*(\d{1,4})\b/i,
  /\be\s*0*(\d{1,3})\b(?!\w)/i,
  /[-–—]\s*0*(\d{1,4})\s*(?:\[|\(|$|\|)/,
  /#\s*0*(\d{1,4})\b/,
];

/** episode number advertised in a video title, if any */
export function episodeOf(title: string): number | undefined {
  for (const re of EP_PATTERNS) {
    const m = title.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 2000) return n;
    }
  }
  return undefined;
}

function audioOf(title: string): LicensedKind {
  if (/\b(english\s*dub|dub(bed)?)\b/i.test(title) && !/\bsub/i.test(title)) return "dub";
  if (/\bsub(title|bed|s)?\b/i.test(title)) return "sub";
  return "unknown";
}

/** trailers/PVs/clips/news are not the episode */
const isNoise = (title: string) =>
  /\b(trailer|pv\b|teaser|preview|promo|opening|ending|op\b|ed\b|theme song|announcement|recap|highlight|clip|shorts|behind the scenes|interview|reaction|compilation|full season|marathon)\b/i.test(
    title
  );

/* ── candidate discovery ──────────────────────────────────────────────── */

type Raw = { videoId: string; title: string; length?: string; published?: string };

/** strategy 1: official Data API (needs YOUTUBE_API_KEY) */
async function viaDataApi(ch: Channel, q: string, key: string): Promise<Raw[]> {
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25` +
    `&channelId=${encodeURIComponent(ch.id)}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  const res = await get(url, { accept: "application/json" });
  if (!res.ok) throw new Error(`data api ${res.status}`);
  const json: any = await res.json();
  return (json?.items ?? [])
    .map((it: any) => ({
      videoId: it?.id?.videoId,
      title: it?.snippet?.title ?? "",
      published: it?.snippet?.publishedAt,
    }))
    .filter((r: Raw) => !!r.videoId && !!r.title);
}

/** collect every {videoId,title} pair out of a ytInitialData blob */
function walkRenderers(node: unknown, out: Raw[], depth = 0) {
  if (!node || typeof node !== "object" || depth > 12 || out.length > 400) return;
  if (Array.isArray(node)) {
    for (const v of node) walkRenderers(v, out, depth + 1);
    return;
  }
  const rec = node as Record<string, any>;
  const vr = rec.videoRenderer ?? rec.compactVideoRenderer ?? rec.gridVideoRenderer;
  if (vr?.videoId) {
    const title =
      vr.title?.runs?.map((r: any) => r.text).join("") ??
      vr.title?.simpleText ??
      vr.headline?.simpleText ??
      "";
    if (title)
      out.push({
        videoId: String(vr.videoId),
        title: String(title),
        length: vr.lengthText?.simpleText,
        published: vr.publishedTimeText?.simpleText,
      });
  }
  for (const v of Object.values(rec)) walkRenderers(v, out, depth + 1);
}

function parseInitialData(html: string): Raw[] {
  const out: Raw[] = [];
  const m =
    html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ||
    html.match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/) ||
    html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);
  if (m) {
    try {
      walkRenderers(JSON.parse(m[1]), out);
    } catch {
      /* fall through to the regex sweep */
    }
  }
  if (!out.length) {
    /* last-ditch: pair ids with the nearest title text */
    const re = /"videoId":"([\w-]{11})"[\s\S]{0,400}?"text":"((?:[^"\\]|\\.){3,160})"/g;
    let g: RegExpExecArray | null;
    while ((g = re.exec(html)) && out.length < 120) {
      let t = g[2];
      try {
        t = JSON.parse(`"${t}"`);
      } catch {}
      out.push({ videoId: g[1], title: t });
    }
  }
  const seen = new Set<string>();
  return out.filter((r) => !seen.has(r.videoId) && seen.add(r.videoId));
}

/** strategy 2: the channel's own search page (no key required) */
async function viaChannelSearch(ch: Channel, q: string): Promise<Raw[]> {
  const url = `https://www.youtube.com/channel/${ch.id}/search?query=${encodeURIComponent(q)}`;
  const res = await get(url);
  if (!res.ok) throw new Error(`channel search ${res.status}`);
  return parseInitialData(await res.text());
}

/* ── public resolver ──────────────────────────────────────────────────── */

export type ResolveArgs = {
  title: string;
  /** original_title / original_name — catches romaji-only uploads */
  altTitle?: string;
  kind: "movie" | "series";
  season: number;
  episode: number;
  /** preferred audio; sub is the norm on these channels */
  audio?: LicensedKind;
};

const MIN_SCORE = 0.45;

export async function resolveLicensedAnime(args: ResolveArgs): Promise<LicensedResult> {
  const { title, altTitle, kind, season, episode } = args;
  const key = process.env.YOUTUBE_API_KEY || "";
  const chans = channels();
  const diag: string[] = [key ? "mode=dataapi" : "mode=html"];

  /* Query set: channel search is fuzzy, so a couple of shapes beat one
   * over-specified string. Season > 1 is worth naming (licensors title
   * uploads "... Season 2 Episode 3"). */
  const base = [title, altTitle].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];
  const queries: string[] = [];
  for (const b of base) {
    if (kind === "series") {
      if (season > 1) queries.push(`${b} Season ${season} Episode ${episode}`);
      queries.push(`${b} Episode ${episode}`);
      queries.push(b);
    } else {
      queries.push(`${b} Movie`);
      queries.push(b);
    }
  }

  const found: LicensedSource[] = [];
  const errors: string[] = [];

  await Promise.all(
    chans.map(async (ch) => {
      const raws: Raw[] = [];
      for (const q of queries.slice(0, 3)) {
        try {
          const got = key ? await viaDataApi(ch, q, key) : await viaChannelSearch(ch, q);
          raws.push(...got);
          if (got.length) break; /* first productive query wins */
        } catch (e) {
          errors.push(`${ch.name}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
      diag.push(`${ch.name}=${raws.length}`);

      const seen = new Set<string>();
      for (const r of raws) {
        if (seen.has(r.videoId)) continue;
        seen.add(r.videoId);
        if (isNoise(r.title)) continue;

        const sim = Math.max(similarity(title, r.title), altTitle ? similarity(altTitle, r.title) : 0);
        if (sim < MIN_SCORE) continue;

        const ep = episodeOf(r.title);
        if (kind === "series") {
          /* an episode-numbered upload must match the requested episode;
           * unnumbered uploads stay as weak fallbacks */
          if (ep !== undefined && ep !== episode) continue;
        } else if (ep !== undefined && ep > 1) continue;

        const audio = audioOf(r.title);
        let score = sim;
        if (ep === episode) score += 0.45;
        if (args.audio && audio === args.audio) score += 0.12;
        if (/\bfull episode\b/i.test(r.title)) score += 0.05;

        found.push({
          key: `${ch.id}:${r.videoId}`,
          videoId: r.videoId,
          title: r.title,
          channel: ch.name,
          url: `https://www.youtube.com/watch?v=${r.videoId}`,
          embed: `https://www.youtube-nocookie.com/embed/${r.videoId}`,
          length: r.length,
          published: r.published,
          episode: ep,
          audio,
          score,
        });
      }
    })
  );

  found.sort((a, b) => b.score - a.score);
  const sources = found.slice(0, 12);

  if (!sources.length) {
    return {
      title,
      sources: [],
      noSource: true,
      laneError: errors.length && errors.length >= chans.length ? errors[0].slice(0, 160) : undefined,
      diag: [...diag, ...errors.slice(0, 3)].join(" | ").slice(0, 400),
    };
  }
  return { title, sources, diag: diag.join(" | ").slice(0, 400) };
}
