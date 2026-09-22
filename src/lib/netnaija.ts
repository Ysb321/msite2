import { TMDB_KEY } from "./tmdb";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type NetNaijaResolveResult = {
  ok: boolean;
  title?: string;
  year?: string;
  detailPath?: string;
  subjectId?: string;
  embedUrl?: string;
  error?: string;
};

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

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

const FALLBACK_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjM3MDM1MjY0NDY3MDQ1MTkxNjgsImF0cCI6MywiZXh0IjoiMTc5MDA3MTk5NSIsImV4cCI6MTc5Nzg0Nzk5NSwiaWF0IjoxNzkwMDcxNjk1fQ.xliWqZ1ZornvXzTlO3z3g4VBMCVhQHTK0ZNGmZitwKU";

export async function getAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  try {
    // Initial request to netnaija to acquire a session token
    const url = "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/play?subjectId=175960665474090024&se=0&ep=0&detailPath=olympus-has-fallen-a9E4RbUTZc";
    console.log("[NetNaija] Initializing auth token...");
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "X-Client-Info": JSON.stringify({ timezone: "Africa/Lagos" }),
        "Origin": "https://netnaija.film",
        "Referer": "https://netnaija.film/"
      },
      signal: AbortSignal.timeout(5000),
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/token=([^;]+)/);
      if (match && match[1]) {
        cachedToken = match[1];
        tokenExpiresAt = Date.now() + 25 * 60 * 1000;
        console.log("[NetNaija] Auth token retrieved and cached successfully.");
        return cachedToken;
      }
    }
  } catch (err: any) {
    console.warn("[NetNaija] Token fetch timeout/warning (using fallback token):", err.message);
  }

  cachedToken = FALLBACK_TOKEN;
  tokenExpiresAt = Date.now() + 10 * 60 * 1000;
  return FALLBACK_TOKEN;
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isHindiContent(title: string): boolean {
  return /hindi|dubbed|dual|multi/i.test(title);
}

function scoreSearchItem(
  item: { title: string; releaseDate?: string; detailPath: string; subjectType: number },
  targetTitle: string,
  targetYear?: string,
  type?: "movie" | "tv"
): number {
  let score = 0;
  const itemTitle = item.title.toLowerCase();
  const lowerTarget = targetTitle.toLowerCase();

  // Word level matching
  const words = lowerTarget
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let matchedWords = 0;
  for (const w of words) {
    if (itemTitle.includes(w)) matchedWords++;
  }

  if (words.length > 0) {
    score += Math.round((matchedWords / words.length) * 40);
  }

  // Exact slug matching
  const targetSlug = slugify(targetTitle);
  const itemSlug = item.detailPath.toLowerCase();
  if (itemSlug.includes(targetSlug)) {
    score += 30;
  }

  // Year matching
  if (targetYear && item.releaseDate) {
    const itemYear = item.releaseDate.slice(0, 4);
    if (itemYear === targetYear) {
      score += 30;
    } else if (Math.abs(parseInt(itemYear, 10) - parseInt(targetYear, 10)) <= 1) {
      score += 15;
    }
  }

  // Hindi preference
  if (isHindiContent(item.title)) {
    score += 20;
  }

  // Series exact matching (Penalize if type is TV but item is not series (subjectType 2))
  if (type === "tv") {
    if (item.subjectType === 2) {
      score += 20;
    } else {
      score -= 50;
    }
  }

  return score;
}

export async function resolveNetNaijaStream(
  type: "movie" | "tv",
  id: string,
  season: number = 1,
  episode: number = 1
): Promise<NetNaijaResolveResult> {
  const meta = await getTmdbMeta(type, id);
  if (!meta) {
    return { ok: false, error: "Failed to fetch TMDB metadata" };
  }

  const { title, year } = meta;
  if (!title) {
    return { ok: false, error: "Empty title from TMDB metadata" };
  }

  try {
    const token = await getAuthToken();
    if (!token) {
      return { ok: false, error: "Failed to authenticate with NetNaija services" };
    }

    const searchUrl = "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/search";
    console.log(`[NetNaija] Searching: ${title} (${year})`);

    const res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Origin": "https://netnaija.film",
        "Referer": "https://netnaija.film/"
      },
      body: JSON.stringify({
        keyword: title,
        page: 1,
        perPage: 12
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { ok: false, error: `Search service returned HTTP ${res.status}` };
    }

    const json = await res.json();
    const items = json.data?.items || [];
    console.log(`[NetNaija] Found ${items.length} candidate results from search.`);

    if (items.length === 0) {
      return { ok: false, error: "Title not found on NetNaija library" };
    }

    // Score search results
    const scored = items.map((item: any) => {
      const score = scoreSearchItem(
        { title: item.title, releaseDate: item.releaseDate, detailPath: item.detailPath, subjectType: item.subjectType },
        title,
        year,
        type
      );
      return { item, score };
    });

    // Sort by score descending
    scored.sort((a: any, b: any) => b.score - a.score);
    const bestMatch = scored[0];

    console.log(`[NetNaija] Best matched title: "${bestMatch.item.title}" with score ${bestMatch.score}`);

    // Require a minimum match score to avoid false positives on completely unrelated titles
    if (bestMatch.score < 25) {
      return { ok: false, error: "No confident matches found on NetNaija" };
    }

    const { detailPath, subjectId } = bestMatch.item;

    // Generate responsive direct player link
    const embedUrl = `https://netnaija.film/movieDetail/${detailPath}?se=${season}&ep=${episode}&s=${season}&e=${episode}&season=${season}&episode=${episode}`;

    return {
      ok: true,
      title: bestMatch.item.title,
      year: bestMatch.item.releaseDate ? bestMatch.item.releaseDate.slice(0, 4) : year,
      detailPath,
      subjectId,
      embedUrl
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Internal error resolving NetNaija stream" };
  }
}
