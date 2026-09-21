import { TMDB_KEY } from "./tmdb";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type MovieNestResolveResult = {
  ok: boolean;
  title?: string;
  year?: string;
  postUrl?: string;
  embedUrl?: string;
  error?: string;
};

async function getTmdbMeta(type: "movie" | "tv", id: string) {
  try {
    const url =
      type === "movie"
        ? `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}`
        : `https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_KEY}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || data.name || data.original_title || data.original_name || "",
      year: (data.release_date || data.first_air_date || "").slice(0, 4),
    };
  } catch {
    return null;
  }
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function scorePostUrl(
  url: string,
  title: string,
  year?: string,
  season?: number,
  episode?: number,
  isTv?: boolean
): number {
  let score = 0;
  const lowerUrl = url.toLowerCase();

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let matchedWords = 0;
  for (const w of words) {
    if (lowerUrl.includes(w)) matchedWords++;
  }

  if (words.length > 0) {
    score += Math.round((matchedWords / words.length) * 15);
  }

  const titleSlug = slugify(title);
  if (titleSlug && lowerUrl.includes(titleSlug)) {
    score += 15;
  }

  if (year && lowerUrl.includes(year)) {
    score += 10;
  }

  if (isTv && season !== undefined) {
    const sStr = String(season);
    const sPadded = season < 10 ? "0" + season : sStr;

    // MovieNestBD patterns for seasons:
    // reacher-s2, reacher-s3, reacher-2, lanterns-s1, etc.
    if (
      lowerUrl.includes(`-s${sStr}`) ||
      lowerUrl.includes(`-s${sPadded}`) ||
      lowerUrl.includes(`-season-${sStr}`) ||
      lowerUrl.includes(`-season-${sPadded}`) ||
      lowerUrl.includes(`-${sStr}`)
    ) {
      score += 25;
    }
  }

  return score;
}

function hasSeasonMismatch(url: string, targetSeason: number, isTv: boolean): boolean {
  if (!isTv) return false;
  const lower = url.toLowerCase();

  // Pattern 1: sX or season-X or s0X
  const m1 = lower.match(/s(\d+)/) || lower.match(/season-(\d+)/);
  if (m1) {
    const sVal = parseInt(m1[1], 10);
    if (sVal !== targetSeason) return true;
  }

  // Pattern 2: ending in -X (e.g. /reacher-2 for season 2)
  const m2 = lower.match(/-(\d+)$/);
  if (m2) {
    const sVal = parseInt(m2[1], 10);
    if (sVal !== targetSeason && sVal < 15) {
      return true;
    }
  }

  return false;
}

export async function resolveMovieNestStream(
  type: "movie" | "tv",
  id: string,
  season: number = 1,
  episode: number = 1
): Promise<MovieNestResolveResult> {
  const meta = await getTmdbMeta(type, id);
  if (!meta) {
    return { ok: false, error: "Failed to fetch TMDB metadata" };
  }

  const { title, year } = meta;
  if (!title) {
    return { ok: false, error: "Empty title from TMDB metadata" };
  }

  try {
    // 1. Search MovieNestBD
    const query = type === "tv" ? `${title} season ${season}` : title;
    const searchUrl = `https://movienestbd.best/search?q=${encodeURIComponent(query)}`;
    
    console.log(`[MovieNestBD] Searching: ${searchUrl}`);
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { ok: false, error: `Search HTTP ${res.status}` };
    }

    const html = await res.text();

    const matches = [...html.matchAll(/href=["\x27](\/[a-zA-Z0-9\-_]+)["\x27]/gi)].map((m) => m[1]);
    const cleanMatches = [...new Set(matches)].filter(
      (l) =>
        !["/favicon", "/dashboard", "/login", "/logout", "/register", "/movies", "/series", "/adult", "/updates", "/search"].includes(l) &&
        !l.includes("/genre/") &&
        !l.includes("/language/") &&
        !l.includes("/category/")
    );

    console.log(`[MovieNestBD] Candidates found:`, cleanMatches);

    let candidates = cleanMatches.map((slug) => {
      const fullUrl = `https://movienestbd.best${slug}`;
      const score = scorePostUrl(slug, title, year, season, episode, type === "tv");
      const isMismatch = hasSeasonMismatch(slug, season, type === "tv");
      return { slug, fullUrl, score, isMismatch };
    });

    if (type === "tv") {
      candidates = candidates.filter((c) => !c.isMismatch);
    }

    candidates.sort((a, b) => b.score - a.score);

    console.log(`[MovieNestBD] Scored candidates:`, candidates);

    if (candidates.length === 0) {
      if (type === "tv") {
        console.log(`[MovieNestBD] No matches with season query, retrying search with title only...`);
        const fallbackSearchUrl = `https://movienestbd.best/search?q=${encodeURIComponent(title)}`;
        const fbRes = await fetch(fallbackSearchUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
        if (fbRes.ok) {
          const fbHtml = await fbRes.text();
          const fbMatches = [...fbHtml.matchAll(/href=["\x27](\/[a-zA-Z0-9\-_]+)["\x27]/gi)].map((m) => m[1]);
          const fbCleanMatches = [...new Set(fbMatches)].filter(
            (l) =>
              !["/favicon", "/dashboard", "/login", "/logout", "/register", "/movies", "/series", "/adult", "/updates", "/search"].includes(l) &&
              !l.includes("/genre/") &&
              !l.includes("/language/") &&
              !l.includes("/category/")
          );
          let fbCandidates = fbCleanMatches.map((slug) => {
            const fullUrl = `https://movienestbd.best${slug}`;
            const score = scorePostUrl(slug, title, year, season, episode, true);
            const isMismatch = hasSeasonMismatch(slug, season, true);
            return { slug, fullUrl, score, isMismatch };
          }).filter((c) => !c.isMismatch);

          fbCandidates.sort((a, b) => b.score - a.score);
          if (fbCandidates.length > 0) {
            candidates = fbCandidates;
          }
        }
      }
    }

    if (candidates.length === 0) {
      return { ok: false, error: `No matching title found on MovieNestBD` };
    }

    const bestPost = candidates[0];
    console.log(`[MovieNestBD] Best matched page: ${bestPost.fullUrl} (Score: ${bestPost.score})`);

    const pageRes = await fetch(bestPost.fullUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });

    if (!pageRes.ok) {
      return { ok: false, error: `Failed to fetch post page: HTTP ${pageRes.status}` };
    }

    const postHtml = await pageRes.text();

    const rawEpisodesMatch = postHtml.match(/rawEpisodes\s*=\s*(\[[\s\S]*?\])\s*;/i);
    const rawLinksMatch = postHtml.match(/rawLinks\s*=\s*(\[[\s\S]*?\])\s*;/i);
    const isSeriesMatch = postHtml.match(/isSeries\s*=\s*(true|false)/i);

    const isSeries = isSeriesMatch ? isSeriesMatch[1].trim() === "true" : false;

    let rawEpisodes: { name: string; link: string }[] = [];
    let rawLinks: { name: string; link: string; quality?: string; language?: string }[] = [];

    if (rawEpisodesMatch) {
      try {
        const cleanJson = rawEpisodesMatch[1]
          .replace(/\\r/g, "")
          .replace(/\\n/g, "")
          .replace(/\\t/g, "")
          .replace(/\\/g, "");
        rawEpisodes = JSON.parse(cleanJson);
      } catch (err) {
        const items = [...rawEpisodesMatch[1].matchAll(/name:\s*["\x27]([^"\x27]+)["\x27],\s*link:\s*["\x27]([^"\x27]+)["\x27]/gi)];
        rawEpisodes = items.map((it) => ({
          name: it[1],
          link: it[2].replace(/\\/g, ""),
        }));
      }
    }

    if (rawLinksMatch) {
      try {
        const cleanJson = rawLinksMatch[1]
          .replace(/\\r/g, "")
          .replace(/\\n/g, "")
          .replace(/\\t/g, "")
          .replace(/\\/g, "");
        rawLinks = JSON.parse(cleanJson);
      } catch (err) {
        const items = [...rawLinksMatch[1].matchAll(/link:\s*["\x27]([^"\x27]+)["\x27]/gi)];
        rawLinks = items.map((it) => ({
          name: "",
          link: it[1].replace(/\\/g, ""),
        }));
      }
    }

    console.log(`[MovieNestBD] Parsed Series: ${isSeries}, Episodes count: ${rawEpisodes.length}, Links count: ${rawLinks.length}`);

    let streamLink = "";

    if (type === "tv") {
      let matchedEp = rawEpisodes.find((ep) => {
        const epNumMatch = ep.name.match(/(\d+)/);
        return epNumMatch && parseInt(epNumMatch[1], 10) === episode;
      });

      if (matchedEp) {
        streamLink = matchedEp.link;
        console.log(`[MovieNestBD] Found episode E${episode} in rawEpisodes: ${streamLink}`);
      } else {
        let matchedLink = rawLinks.find((link) => {
          const nameTrim = (link.name || "").trim();
          const epNumMatch = nameTrim.match(/(\d+)/);
          return epNumMatch && parseInt(epNumMatch[1], 10) === episode;
        });

        if (matchedLink) {
          streamLink = matchedLink.link;
          console.log(`[MovieNestBD] Found episode E${episode} in rawLinks: ${streamLink}`);
        }
      }

      if (!streamLink && rawLinks.length > 0) {
        const hdLink = rawLinks.find((l) => (l.quality || "").toUpperCase().includes("1080P")) ||
                       rawLinks.find((l) => (l.quality || "").toUpperCase().includes("720P")) ||
                       rawLinks[0];
        streamLink = hdLink.link;
        console.log(`[MovieNestBD] Fallback to whole-season/first video link from rawLinks: ${streamLink}`);
      }
    } else {
      if (rawLinks.length > 0) {
        const hdLink = rawLinks.find((l) => (l.quality || "").toUpperCase().includes("1080P")) ||
                       rawLinks.find((l) => (l.quality || "").toUpperCase().includes("720P")) ||
                       rawLinks[0];
        streamLink = hdLink.link;
        console.log(`[MovieNestBD] Selected movie link: ${streamLink}`);
      } else if (rawEpisodes.length > 0) {
        streamLink = rawEpisodes[0].link;
        console.log(`[MovieNestBD] Selected movie link from rawEpisodes: ${streamLink}`);
      }
    }

    if (!streamLink) {
      return { ok: false, error: "No streamable links found for this content" };
    }

    let finalEmbedUrl = streamLink;
    const match = streamLink.match(/\/([a-zA-Z0-9]{24})(?:$|\/)/);
    if (match) {
      finalEmbedUrl = `https://embed.jiofiles.pics/${match[1]}`;
    }

    console.log(`[MovieNestBD] Resolved Embed URL: ${finalEmbedUrl}`);

    return {
      ok: true,
      title: title,
      year: year,
      postUrl: bestPost.fullUrl,
      embedUrl: finalEmbedUrl,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Internal error resolving MovieNestBD stream" };
  }
}
