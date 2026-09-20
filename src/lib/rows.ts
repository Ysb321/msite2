import type { Media } from "./tmdb";

/* Static genre maps (avoid extra API round-trips on the critical path) */
export const MOVIE_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};
export const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery",
  10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
  10767: "Talk", 10768: "War & Politics", 37: "Western",
};

export const genreNames = (m: Media, map: Record<number, string> = MOVIE_GENRES) =>
  (m.genre_ids ?? m.genres?.map((g) => g.id) ?? [])
    .map((id) => map[id])
    .filter(Boolean)
    .slice(0, 3);

/* Row catalogue — one declarative source for the home page. Each row maps to
 * one or two TMDB requests; multi-request rows interleave results client-side
 * so a single cache entry powers the whole row. */
export type RowDef = {
  key: string;
  title: string;
  variant?: "backdrop" | "poster";
  top10?: boolean;
  /** "Explore all" target shown next to the row title (netflix-style) */
  href?: string;
  /** sources: [path, params] pairs — results are interleaved */
  sources: [string, Record<string, string | number>][];
  /** transform (e.g. dedupe / filter) */
  pick?: (items: Media[]) => Media[];
};

export const HOME_ROWS: RowDef[] = [
  /* India-first home: Indian content dominates, a few global rows at the end */
  {
    key: "trending-india",
    title: "Trending in India",
    href: "/movies",
    sources: [
      ["discover/movie", { region: "IN", sort_by: "popularity.desc", "vote_count.gte": 30 }],
      ["discover/tv", { region: "IN", sort_by: "popularity.desc", "vote_count.gte": 20, with_origin_country: "IN" }],
    ],
  },
  {
    key: "top10-india",
    title: "Top 10 in India Today",
    top10: true,
    href: "/movies",
    sources: [["discover/movie", { region: "IN", sort_by: "popularity.desc", "vote_count.gte": 80 }]],
  },
  {
    key: "bollywood",
    title: "Bollywood Movies",
    href: "/movies",
    sources: [["discover/movie", { with_original_language: "hi", "vote_count.gte": 30, sort_by: "popularity.desc" }]],
  },
  {
    key: "south-indian",
    title: "South Indian Cinema",
    href: "/movies",
    sources: [
      ["discover/movie", { with_original_language: "ta", "vote_count.gte": 20, sort_by: "popularity.desc" }],
      ["discover/movie", { with_original_language: "te", "vote_count.gte": 20, sort_by: "popularity.desc" }],
      ["discover/movie", { with_original_language: "ml", "vote_count.gte": 15, sort_by: "popularity.desc" }],
    ],
  },
  {
    key: "indian-tv",
    title: "Indian TV Shows",
    href: "/tv",
    sources: [["discover/tv", { with_origin_country: "IN", "vote_count.gte": 10, sort_by: "popularity.desc" }]],
  },
  {
    key: "dubbed-hits",
    title: "Blockbusters Dubbed in Hindi",
    href: "/movies",
    sources: [["discover/movie", { region: "IN", with_original_language: "en", "vote_count.gte": 400, sort_by: "popularity.desc" }]],
  },
  {
    key: "anime",
    title: "Anime",
    variant: "poster",
    href: "/anime",
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: 16, "vote_count.gte": 20, sort_by: "popularity.desc" }]],
  },
  {
    key: "korean-tv",
    title: "Korean TV Shows",
    href: "/tv",
    sources: [["discover/tv", { with_origin_country: "KR", "vote_count.gte": 30, sort_by: "popularity.desc" }]],
  },
  {
    key: "hollywood",
    title: "Hollywood Movies",
    href: "/movies",
    sources: [
      ["discover/movie", { with_original_language: "en", with_origin_country: "US", "vote_count.gte": 400, sort_by: "popularity.desc" }],
    ],
  },
  {
    key: "marvel",
    title: "Marvel Collection",
    href: "/movies",
    sources: [["discover/movie", { with_companies: "420|38679", sort_by: "popularity.desc" }]],
  },
  {
    key: "trending-movies",
    title: "Trending Worldwide",
    href: "/movies",
    sources: [["trending/movie/week", { page: 1 }]],
  },
];

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/* Kids home (under-13): only Animation / Family / Kids content */
export const KIDS_ROWS: RowDef[] = [
  {
    key: "kids-movies",
    title: "Movies for Kids",
    href: "/movies",
    sources: [["discover/movie", { with_genres: "16|10751", "vote_count.gte": 200, sort_by: "popularity.desc" }]],
  },
  {
    key: "kids-top10",
    title: "Top 10 for Kids",
    top10: true,
    href: "/movies",
    sources: [["discover/movie", { with_genres: "16|10751", "vote_count.gte": 300, sort_by: "popularity.desc" }]],
  },
  {
    key: "kids-cartoons",
    title: "Cartoons & Series",
    href: "/tv",
    sources: [["discover/tv", { with_genres: "10762|10751", "vote_count.gte": 20, sort_by: "popularity.desc" }]],
  },
  {
    key: "kids-family-tv",
    title: "Family Series",
    href: "/tv",
    sources: [["discover/tv", { with_genres: 10751, "vote_count.gte": 30, sort_by: "popularity.desc" }]],
  },
  {
    key: "kids-animated-classics",
    title: "Animated Classics",
    sources: [["discover/movie", { with_genres: 16, "vote_count.gte": 1000, "vote_average.gte": 7, sort_by: "popularity.desc" }]],
  },
];

/* TV section (/tv) */
export const TV_ROWS: RowDef[] = [
  {
    key: "tv-popular",
    title: "Popular TV Shows",
    sources: [["discover/tv", { "vote_count.gte": 50, sort_by: "popularity.desc" }]],
  },
  {
    key: "tv-top10",
    title: "Top 10 TV Shows in India",
    top10: true,
    sources: [["discover/tv", { region: "IN", "vote_count.gte": 50, sort_by: "popularity.desc" }]],
  },
  {
    key: "tv-toprated",
    title: "Top Rated TV Shows",
    sources: [["discover/tv", { "vote_count.gte": 2000, sort_by: "vote_average.desc" }]],
  },
  {
    key: "tv-indian",
    title: "Indian TV Shows",
    sources: [["discover/tv", { with_origin_country: "IN", "vote_count.gte": 10, sort_by: "popularity.desc" }]],
  },
  {
    key: "tv-korean",
    title: "Korean TV Shows",
    sources: [["discover/tv", { with_origin_country: "KR", "vote_count.gte": 30, sort_by: "popularity.desc" }]],
  },
  {
    key: "tv-new",
    title: "New Seasons & Premieres",
    sources: [["discover/tv", { "vote_count.gte": 5, "first_air_date.gte": daysAgoIso(120), sort_by: "popularity.desc" }]],
  },
  {
    key: "tv-crime",
    title: "Crime & Drama",
    sources: [["discover/tv", { with_genres: "80,18", "vote_count.gte": 200, sort_by: "popularity.desc" }]],
  },
  {
    key: "tv-scifi",
    title: "Sci-Fi & Fantasy",
    sources: [["discover/tv", { with_genres: 10765, "vote_count.gte": 100, sort_by: "popularity.desc" }]],
  },
];

/* Movies section (/movies) */
export const MOVIE_ROWS: RowDef[] = [
  {
    key: "mov-popular",
    title: "Popular Movies",
    sources: [["discover/movie", { "vote_count.gte": 100, sort_by: "popularity.desc" }]],
  },
  {
    key: "mov-top10",
    title: "Top 10 Movies in India",
    top10: true,
    sources: [["discover/movie", { region: "IN", "vote_count.gte": 100, sort_by: "popularity.desc" }]],
  },
  {
    key: "mov-toprated",
    title: "Top Rated Movies",
    sources: [["discover/movie", { "vote_count.gte": 2000, sort_by: "vote_average.desc" }]],
  },
  {
    key: "mov-bollywood",
    title: "Bollywood Movies",
    sources: [["discover/movie", { with_original_language: "hi", "vote_count.gte": 30, sort_by: "popularity.desc" }]],
  },
  {
    key: "mov-south",
    title: "South Indian Cinema",
    sources: [
      ["discover/movie", { with_original_language: "ta", "vote_count.gte": 20, sort_by: "popularity.desc" }],
      ["discover/movie", { with_original_language: "te", "vote_count.gte": 20, sort_by: "popularity.desc" }],
      ["discover/movie", { with_original_language: "ml", "vote_count.gte": 15, sort_by: "popularity.desc" }],
    ],
  },
  {
    key: "mov-new",
    title: "New Releases",
    sources: [["discover/movie", { "vote_count.gte": 20, "primary_release_date.gte": daysAgoIso(90), sort_by: "popularity.desc" }]],
  },
  {
    key: "mov-hollywood",
    title: "Hollywood Blockbusters",
    sources: [["discover/movie", { with_original_language: "en", with_origin_country: "US", "vote_count.gte": 400, sort_by: "popularity.desc" }]],
  },
  {
    key: "mov-action",
    title: "Action & Adventure",
    sources: [["discover/movie", { with_genres: "28,12", "vote_count.gte": 200, sort_by: "popularity.desc" }]],
  },
];

/* Anime section (/anime) — Japanese animation (genre 16 + JP origin) */

export const ANIME_ROWS: RowDef[] = [
  {
    key: "anime-popular",
    title: "Popular Anime",
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: 16, "vote_count.gte": 50, sort_by: "popularity.desc" }]],
  },
  {
    key: "anime-top10",
    title: "Top 10 Anime Today",
    top10: true,
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: 16, "vote_count.gte": 20, sort_by: "popularity.desc" }]],
  },
  {
    key: "anime-toprated",
    title: "Top Rated Anime",
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: 16, "vote_count.gte": 500, sort_by: "vote_average.desc" }]],
  },
  {
    key: "anime-simulcast",
    title: "New Seasons & Simulcasts",
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: 16, "vote_count.gte": 5, "first_air_date.gte": daysAgoIso(120), sort_by: "popularity.desc" }]],
  },
  {
    key: "anime-action",
    title: "Action Anime",
    variant: "poster",
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: "16,10759", "vote_count.gte": 30, sort_by: "popularity.desc" }]],
  },
  {
    key: "anime-movies",
    title: "Anime Movies",
    variant: "poster",
    sources: [["discover/movie", { with_original_language: "ja", with_genres: 16, "vote_count.gte": 100, sort_by: "popularity.desc" }]],
  },
];

/** round-robin merge of N result lists, deduped by id */
export function interleave(lists: Media[][]): Media[] {
  const seen = new Set<number>();
  const out: Media[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++)
    for (const l of lists) {
      const item = l[i];
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  return out;
}

/* Kids anime (/anime in kids mode): JP AND (Kids or Family) tagged only */
export const KIDS_ANIME_ROWS: RowDef[] = [
  {
    key: "kids-anime-tv",
    title: "Anime for Kids",
    href: "/anime",
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: "16,10762", "vote_count.gte": 5, sort_by: "popularity.desc" }]],
  },
  {
    key: "kids-anime-family",
    title: "Family Anime",
    href: "/anime",
    sources: [["discover/tv", { with_origin_country: "JP", with_genres: "16,10751", "vote_count.gte": 5, sort_by: "popularity.desc" }]],
  },
  {
    key: "kids-anime-movies",
    title: "Anime Movies for Kids",
    variant: "poster",
    sources: [["discover/movie", { with_original_language: "ja", with_genres: "16,10751", "vote_count.gte": 30, sort_by: "popularity.desc" }]],
  },
];
