import { TMDB_KEY } from "./tmdb";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type YoMoviesResolveResult = {
  ok: boolean;
  title?: string;
  year?: string;
  postUrl?: string;
  embedUrl?: string;
  m3u8Url?: string;
  posterUrl?: string;
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

  if (isTv && season !== undefined && episode !== undefined) {
    const sStr = String(season);
    const eStr = String(episode);
    const sPadded = season < 10 ? "0" + season : sStr;
    const ePadded = episode < 10 ? "0" + episode : eStr;

    if (
      lowerUrl.includes(`season-${sStr}-episode-${eStr}`) ||
      lowerUrl.includes(`season-${sPadded}-episode-${ePadded}`) ||
      lowerUrl.includes(`s${sStr}e${eStr}`) ||
      lowerUrl.includes(`s${sPadded}e${ePadded}`)
    ) {
      score += 25;
    } else if (lowerUrl.includes(`season-${sStr}`) || lowerUrl.includes(`s${sStr}`)) {
      score += 5;
    }
  }

  return score;
}

function hasSeasonMismatch(url: string, targetSeason: number, isTv: boolean): boolean {
  if (!isTv) return false;
  const lower = url.toLowerCase();

  // Pattern 1: season-X
  const m1 = lower.match(/season-(\d+)/);
  if (m1) {
    const s = parseInt(m1[1], 10);
    if (s !== targetSeason) return true;
  }

  // Pattern 2: sX or s0X (e.g., s4, s04, s4e1, s04e01)
  const m2 = lower.match(/(?:^|[^a-z0-9])s(\d+)(?:e\d+|[^a-z0-9]|$)/);
  if (m2) {
    const s = parseInt(m2[1], 10);
    if (s !== targetSeason) return true;
  }

  return false;
}

function hasEpisodeMismatch(url: string, targetEpisode: number, isTv: boolean): boolean {
  if (!isTv) return false;
  const lower = url.toLowerCase();

  // Pattern 1: episode-X
  const m1 = lower.match(/episode-(\d+)/);
  if (m1) {
    const ep = parseInt(m1[1], 10);
    if (ep !== targetEpisode) return true;
  }

  // Pattern 2: eX or e0X (e.g., s4e8, s04e08, reacher-e8)
  const m2 = lower.match(/(?:s\d+e|[^a-z0-9]e)(\d+)(?:[^a-z0-9]|$)/);
  if (m2) {
    const ep = parseInt(m2[1], 10);
    if (ep !== targetEpisode) return true;
  }

  return false;
}

export async function resolveYoMoviesStream(
  type: "movie" | "tv",
  id: string,
  season = 1,
  episode = 1
): Promise<YoMoviesResolveResult> {
  const meta = await getTmdbMeta(type, id);
  if (!meta || !meta.title) {
    return { ok: false, error: "Title details could not be loaded from TMDB." };
  }

  const { title, year } = meta;
  const isTv = type === "tv";
  const queries: string[] = [];

  if (isTv) {
    queries.push(`${title} season ${season} episode ${episode}`);
    queries.push(`${title} S${season}E${episode}`);
    queries.push(`${title} season ${season}`);
    queries.push(title);
  } else {
    if (year) queries.push(`${title} ${year}`);
    queries.push(title);
  }

  for (const q of queries) {
    try {
      const searchUrl = `https://yomovies.church/?s=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      const matches = Array.from(
        html.matchAll(/href=["'](https:\/\/yomovies\.church\/[a-zA-Z0-9\-_]+\/)["']/gi)
      ).map((m) => m[1]);

      const candidateUrls = Array.from(new Set(matches)).filter(
        (u) =>
          !u.includes("/wp-") &&
          !u.includes("/genre/") &&
          !u.includes("/category/") &&
          !u.includes("/country/") &&
          !u.includes("/director/") &&
          !u.includes("/release-year/") &&
          !u.includes("/series/")
      );

      if (candidateUrls.length > 0) {
        const filteredUrls = candidateUrls.filter(
          (u) => !hasSeasonMismatch(u, season, isTv) && !hasEpisodeMismatch(u, episode, isTv)
        );

        if (filteredUrls.length > 0) {
          const scoredPosts = filteredUrls
            .map((u) => ({
              url: u,
              score: scorePostUrl(u, title, year, season, episode, isTv),
            }))
            .sort((a, b) => b.score - a.score);

        const minScore = isTv ? 15 : 10;
        const validPosts = scoredPosts.filter((p) => p.score >= minScore).slice(0, 3);
        const finalCandidates = validPosts.map((p) => p.url);

        for (const targetPost of finalCandidates) {
          const postRes = await fetch(targetPost, {
            headers: { "User-Agent": UA },
            signal: AbortSignal.timeout(7000),
          });
          if (!postRes.ok) continue;
          const postHtml = await postRes.text();

          const iframeMatches = Array.from(
            postHtml.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)
          ).map((m) => m[1]);

          const speedo = iframeMatches.find(
            (m) =>
              m.includes("speedostream") ||
              m.includes("embed") ||
              m.includes("stream") ||
              m.includes("play")
          );

          if (speedo) {
            let finalEmbed = speedo;
            if (finalEmbed.startsWith("//")) {
              finalEmbed = "https:" + finalEmbed;
            }

            let m3u8Url: string | undefined;
            let posterUrl: string | undefined;

            try {
              const speedoRes = await fetch(finalEmbed, {
                headers: { "User-Agent": UA, Referer: "https://yomovies.church/" },
                signal: AbortSignal.timeout(6000),
              });
              if (speedoRes.ok) {
                const speedoHtml = await speedoRes.text();
                const m3u8Match = speedoHtml.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i);
                const imgMatch = speedoHtml.match(/image:\s*["']([^"']+)["']/i);
                if (m3u8Match && m3u8Match[1]) {
                  m3u8Url = m3u8Match[1];
                }
                if (imgMatch && imgMatch[1]) {
                  posterUrl = imgMatch[1];
                }
              }
            } catch {
              // Ignore extraction errors and fallback to embedUrl
            }

            return {
              ok: true,
              title,
              year,
              postUrl: targetPost,
              embedUrl: finalEmbed,
              m3u8Url,
              posterUrl,
            };
          }
        }
      }
    }
    } catch {
      // Continue next query fallback
    }
  }

  return {
    ok: false,
    title,
    year,
    error: `No streaming source found on YoMovies for "${title}".`,
  };
}
