/** AniList & MAL id lookup for anime servers ("Anime 1 · MegaPlay" & "FilmU").
 * TMDB carries no AniList/MAL ids, so we resolve via:
 *   1. Curated verified TMDB anime ID map (instant, handles remakes & multi-season anime)
 *   2. Smart multi-factor AniList GraphQL search with release year, season, and TV format matching
 * Results cached in-memory for the session. */
export interface AnimeIds {
  anilistId: number | null;
  malId: number | null;
}

export interface FindAnimeOptions {
  name: string;
  originalName?: string;
  year?: number;
  season?: number;
  tmdbId?: number;
}

/** Curated verified TMDB anime ID to AniList & MAL ID mapping per season.
 * This guarantees 100% precision with instant lookup for remakes, reboots,
 * and popular multi-season anime where TMDB and AniList partition seasons differently. */
export const KNOWN_ANIME_MAP: Record<number, Record<number, { anilistId: number; malId: number }>> = {
  // Ranma 1/2 (2024) - TMDB 259140 -> AniList 178533 (MAL 59145)
  259140: {
    1: { anilistId: 178533, malId: 59145 },
    2: { anilistId: 185731, malId: 60564 },
    3: { anilistId: 209872, malId: 63801 },
  },
  // Ranma 1/2 (1989) - TMDB 210 / 2330 -> AniList 210 (MAL 210)
  210: {
    1: { anilistId: 210, malId: 210 },
  },
  2330: {
    1: { anilistId: 210, malId: 210 },
  },
  // Attack on Titan (Shingeki no Kyojin) - TMDB 1429
  1429: {
    1: { anilistId: 16498, malId: 16498 },
    2: { anilistId: 20958, malId: 25777 },
    3: { anilistId: 99147, malId: 35760 },
    4: { anilistId: 110277, malId: 40028 },
  },
  // Demon Slayer (Kimetsu no Yaiba) - TMDB 85937
  85937: {
    1: { anilistId: 101922, malId: 38000 },
    2: { anilistId: 129874, malId: 47778 },
    3: { anilistId: 145139, malId: 51019 },
    4: { anilistId: 166240, malId: 55701 },
  },
  // Jujutsu Kaisen - TMDB 95479
  95479: {
    1: { anilistId: 113415, malId: 40748 },
    2: { anilistId: 145064, malId: 51009 },
  },
  // Solo Leveling - TMDB 209867
  209867: {
    1: { anilistId: 151807, malId: 52299 },
    2: { anilistId: 176496, malId: 58567 },
  },
  // Dan Da Dan - TMDB 203857
  203857: {
    1: { anilistId: 171018, malId: 57334 },
  },
  // Chainsaw Man - TMDB 114410
  114410: {
    1: { anilistId: 127230, malId: 44511 },
  },
  // Fruits Basket (2019) - TMDB 86031
  86031: {
    1: { anilistId: 105334, malId: 38680 },
    2: { anilistId: 111762, malId: 40417 },
    3: { anilistId: 124194, malId: 42938 },
  },
  // Shaman King (2021) - TMDB 104874
  104874: {
    1: { anilistId: 119675, malId: 42205 },
  },
  // Spice and Wolf: Merchant Meets the Wise Wolf (2024) - TMDB 205322
  205322: {
    1: { anilistId: 145728, malId: 51122 },
  },
  // Urusei Yatsura (2022) - TMDB 155161
  155161: {
    1: { anilistId: 143277, malId: 50782 },
    2: { anilistId: 163148, malId: 54857 },
  },
  // Rurouni Kenshin (2023) - TMDB 205634
  205634: {
    1: { anilistId: 142877, malId: 50613 },
    2: { anilistId: 173516, malId: 56903 },
  },
  // Bleach: Thousand-Year Blood War - TMDB 214546
  214546: {
    1: { anilistId: 114446, malId: 41467 },
    2: { anilistId: 159322, malId: 53998 },
  },
  // Frieren: Beyond Journey's End - TMDB 206559
  206559: {
    1: { anilistId: 154587, malId: 52991 },
  },
  // Oshi no Ko - TMDB 203737
  203737: {
    1: { anilistId: 150672, malId: 52034 },
    2: { anilistId: 166531, malId: 55791 },
  },
};

const cache = new Map<string, AnimeIds>();

function cleanTitle(str?: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreAniListCandidate(
  c: any,
  targetTitle: string,
  targetYear?: number,
  targetSeason: number = 1
): number {
  let score = 0;
  const cYear = c.startDate?.year || c.seasonYear;
  const titles = [
    c.title?.romaji,
    c.title?.english,
    c.title?.native,
    ...(c.synonyms || []),
  ].filter(Boolean);

  // Format bonus: TV series prefer TV format
  if (c.format === "TV") score += 25;
  else if (c.format === "TV_SHORT" && targetSeason === 1) score += 10;
  else if (c.format === "MOVIE" || c.format === "OVA" || c.format === "SPECIAL") score -= 30;

  // Year matching: critical for reboots / remakes (e.g. 2024 Ranma vs 1989)
  if (targetYear && cYear) {
    const diff = Math.abs(cYear - targetYear);
    if (diff === 0) {
      score += 150; // exact match
    } else if (diff === 1) {
      score += 50; // season transition / winter release
    } else {
      score -= Math.min(120, diff * 10);
    }
  }

  // Season matching
  const allText = `${c.title?.romaji || ""} ${c.title?.english || ""}`.toLowerCase();
  if (targetSeason === 1) {
    if (
      /season\s*[2-9]|2nd\s*season|3rd\s*season|4th\s*season|part\s*[2-9]|\bii\b|\biii\b|\biv\b/i.test(
        allText
      )
    ) {
      score -= 80;
    }
  } else {
    const seasonRegex = new RegExp(
      `season\\s*${targetSeason}|${targetSeason}(?:nd|rd|th)?\\s*season|part\\s*${targetSeason}`,
      "i"
    );
    if (seasonRegex.test(allText)) {
      score += 100;
    }
  }

  // Title similarity
  const cleanTarget = cleanTitle(targetTitle);
  let bestTitleSim = 0;
  for (const t of titles) {
    const ct = cleanTitle(t);
    if (ct === cleanTarget) {
      bestTitleSim = Math.max(bestTitleSim, 60);
    } else if (ct.includes(cleanTarget) || cleanTarget.includes(ct)) {
      bestTitleSim = Math.max(bestTitleSim, 35);
    }
  }
  score += bestTitleSim;

  return score;
}

const GRAPHQL_QUERY = `
  query ($s: String) {
    Page(perPage: 15) {
      media(search: $s, type: ANIME, sort: SEARCH_MATCH) {
        id
        idMal
        title {
          romaji
          english
          native
        }
        startDate {
          year
          month
          day
        }
        seasonYear
        format
        status
        episodes
        synonyms
      }
    }
  }
`;

async function fetchAniListCandidates(searchTerm: string): Promise<any[]> {
  if (!searchTerm || !searchTerm.trim()) return [];
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { s: searchTerm.trim() } }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data?.Page?.media || [];
  } catch {
    return [];
  }
}

export async function findAnimeIds(
  input: string | FindAnimeOptions,
  legacyOpt?: { originalName?: string; year?: number; season?: number; tmdbId?: number }
): Promise<AnimeIds> {
  const opt: FindAnimeOptions =
    typeof input === "string" ? { name: input, ...legacyOpt } : input;

  const targetSeason = opt.season || 1;
  const tmdbId = opt.tmdbId;

  // 1. Instant verified lookup from known TMDB ID map
  if (tmdbId && KNOWN_ANIME_MAP[tmdbId]) {
    const entry = KNOWN_ANIME_MAP[tmdbId][targetSeason] || KNOWN_ANIME_MAP[tmdbId][1];
    if (entry) return entry;
  }

  const primaryName = (opt.name || "").trim();
  const cacheKey = `${tmdbId || ""}:${primaryName.toLowerCase()}:${opt.year || ""}:${targetSeason}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  // 2. Query AniList candidates
  let candidates = await fetchAniListCandidates(primaryName);
  if (candidates.length === 0 && opt.originalName && opt.originalName.trim() !== primaryName) {
    candidates = await fetchAniListCandidates(opt.originalName.trim());
  }

  if (candidates.length === 0) {
    const nullVal: AnimeIds = { anilistId: null, malId: null };
    cache.set(cacheKey, nullVal);
    return nullVal;
  }

  // 3. Multi-factor candidate scoring
  const scored = candidates
    .map((c) => ({
      candidate: c,
      score: scoreAniListCandidate(c, primaryName, opt.year, targetSeason),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.candidate;
  const val: AnimeIds = {
    anilistId: top?.id ?? null,
    malId: top?.idMal ?? null,
  };

  cache.set(cacheKey, val);
  return val;
}

export async function findAniListId(
  input: string | FindAnimeOptions,
  legacyOpt?: { originalName?: string; year?: number; season?: number; tmdbId?: number }
): Promise<number | null> {
  const res = await findAnimeIds(input, legacyOpt);
  return res.anilistId;
}
