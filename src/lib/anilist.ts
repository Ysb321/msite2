/** AniList id lookup for the MegaPlay anime server ("Anime 1").
 * TMDB carries no AniList ids, so we search by title on AniList's public
 * GraphQL API (no key, CORS-open) - synonym-aware, handles romaji/English
 * names. Results cached per name for the session. */
const cache = new Map<string, number | null>();

export async function findAniListId(name: string): Promise<number | null> {
  const key = name.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  const query = `query ($s: String) { Page(perPage: 1) { media(search: $s, type: ANIME) { id } } }`;
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { s: name } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const id = json?.data?.Page?.media?.[0]?.id ?? null;
    cache.set(key, id);
    return id;
  } catch {
    return null;
  }
}
