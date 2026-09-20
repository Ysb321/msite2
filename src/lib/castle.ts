/** CastleTV (api.hlowb.com) Hindi-first resolver.
 *
 *  Castle is an India-first streaming app (channel `IndiaA`) whose backend
 *  is a plain HTTPS API: a security key (plain JSON), then AES-128-CBC
 *  encrypted search / details / video calls. Flow ported from the
 *  TMDB-Embed-API `castletv` provider (Inside4ndroid/TMDB-Embed-API,
 *  MIT) and verified against the live API 2026-09-09 (security key +
 *  search + details decrypt; the getVideo2 playback step is a verbatim
 *  port and returns stage diagnostics so it can be debugged live).
 *  Playback follows the Hindmovie + meowtv consensus: videoUrl ONLY
 *  (videos[] is OST-ordered), permissionDenied fallbacks skipped,
 *  resolutions [3,2,1].
 *
 *  Why Castle: per-language video tracks with Hindi dubs for Hollywood
 *  titles and Hindi originals for Bollywood (search rows carry
 *  `languages: ["OST","Hindi"]`, `firstLanguage: "Hindi"`), up to 1080p
 *  (4K where the catalog has it), plus subtitle tracks. Pure fetch +
 *  WebCrypto - no cookies, no sessions, edge-safe.
 */

const CASTLE_BASE = "https://api.hlowb.com";
const PKG = "com.external.castle";
const CHANNEL = "IndiaA";
const CLIENT = "1";
const LANG = "en-US";
const APK_SIGN = "ED0955EB04E67A1D9F3305B95454FED485261475";

const API_HEADERS: Record<string, string> = {
  "User-Agent": "okhttp/4.9.3",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "Keep-Alive",
  Referer: CASTLE_BASE,
};

export type CastleStream = {
  url: string;
  quality: string;
  size?: number;
  platform: string;
  lang: string;
};

export type CastleCaption = { lang: string; name: string; url: string };

export type CastleResult = {
  title: string;
  streams: CastleStream[];
  captions: CastleCaption[];
  noSource: boolean;
  diag: string;
};

const b64ToBytes = (s: string) => {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** AES-128-CBC decrypt: key = base64(securityKey) + "T!BgJB", first 16
 *  bytes; IV = key. Verified against live ciphertext (node + edge). */
export async function castleDecrypt(cipherB64: string, secKeyB64: string): Promise<string> {
  try {
    const rawKey = b64ToBytes(secKeyB64);
    const suffix = new TextEncoder().encode("T!BgJB");
    const keyBytes = new Uint8Array(16);
    keyBytes.set(rawKey.subarray(0, Math.min(16, rawKey.length)), 0);
    if (rawKey.length < 16) keyBytes.set(suffix.subarray(0, 16 - rawKey.length), rawKey.length);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: keyBytes },
      key,
      b64ToBytes(cipherB64)
    );
    return new TextDecoder().decode(pt);
  } catch (err) {
    throw new Error(`castle: decrypt failed - ${err instanceof Error ? err.message : "unknown"}`);
  }
}

/** JSON.parse that survives 64-bit Castle ids (id: 5747736935414784). */
export function castleParse(text: string): any {
  return JSON.parse(text.replace(/([:{[,]\s*)(\d{16,})/g, '$1"$2"'));
}

async function castleFetch(path: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${CASTLE_BASE}${path}`, {
    ...init,
    headers: { ...API_HEADERS, ...((init?.headers as Record<string, string>) || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`castle http ${res.status} on ${path.split("?")[0]}`);
  return res;
}

/** search/details/video bodies are either raw cipher text or
 *  {"data": "<cipher>"} - accept both. */
async function extractCipher(res: Response): Promise<string> {
  const text = (await res.text()).trim();
  if (!text) throw new Error("castle: empty response body");
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.data === "string" && parsed.data.trim()) return parsed.data.trim();
  } catch {
    /* raw cipher text */
  }
  return text;
}

async function getSecurityKey(): Promise<string> {
  const res = await castleFetch(
    `/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}`,
    10000
  );
  const j = (await res.json()) as { code?: number; data?: string };
  if (j.code !== 200 || !j.data) throw new Error("castle: security key rejected");
  return j.data;
}

async function searchCastle(secKey: string, keyword: string, size: number): Promise<any[]> {
  const q = new URLSearchParams({
    channel: CHANNEL, clientType: CLIENT, keyword, lang: LANG,
    mode: "1", packageName: PKG, page: "1", size: String(size),
  });
  const res = await castleFetch(`/film-api/v1.1.0/movie/searchByKeyword?${q}`, 12000);
  const body = castleParse(await castleDecrypt(await extractCipher(res), secKey));
  const data = body && typeof body.data === "object" ? body.data : body;
  return Array.isArray(data?.rows) ? data.rows : [];
}

async function getCastleDetails(secKey: string, movieId: string): Promise<any> {
  const q = new URLSearchParams({
    channel: CHANNEL, clientType: CLIENT, lang: LANG, movieId, packageName: PKG,
  });
  const res = await castleFetch(`/film-api/v1.9.9/movie?${q}`, 12000);
  const body = castleParse(await castleDecrypt(await extractCipher(res), secKey));
  return body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body;
}

async function getVideo(
  secKey: string, movieId: string, episodeId: string,
  languageId: string | null, resolution: number
): Promise<any> {
  const payload: Record<string, string> = {
    mode: "1", appMarket: "GuanWang", clientType: CLIENT, woolUser: "false",
    apkSignKey: APK_SIGN, androidVersion: "13", movieId, episodeId,
    isNewUser: "true", resolution: String(resolution), packageName: PKG,
  };
  if (languageId) payload.languageId = languageId;
  const q = new URLSearchParams({
    clientType: CLIENT, packageName: PKG, channel: CHANNEL, lang: LANG,
  });
  const res = await castleFetch(`/film-api/v2.0.1/movie/getVideo2?${q}`, 15000, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = castleParse(await castleDecrypt(await extractCipher(res), secKey));
  return body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body;
}

const RES_LABEL: Record<number, string> = { 1: "480p", 2: "720p", 3: "1080p", 4: "4K" };
const KNOWN_HEIGHTS = new Set([240, 360, 480, 540, 576, 720, 1080, 1440, 2160]);

function streamQuality(url: string, description: unknown, resNum: number, fallback: string): string {
  if (description) {
    const d = String(description).trim();
    const m = /(?:SD|HD|FHD|UHD|4K)?\s*(\d{3,4})\s*p?/i.exec(d);
    if (m && KNOWN_HEIGHTS.has(Number(m[1]))) return `${m[1]}p`;
    if (/4k|uhd/i.test(d)) return "4K";
  }
  if (RES_LABEL[resNum]) return RES_LABEL[resNum];
  if (url) {
    const toks = url.match(/[^/a-z](?:(\d{3,4})\s*p?)[^/a-z]/gi);
    if (toks) {
      for (const t of toks) {
        const m = /(\d{3,4})/.exec(t);
        if (m && KNOWN_HEIGHTS.has(Number(m[1]))) return `${m[1]}p`;
      }
    }
  }
  return fallback;
}

const QUALITY_RANK: Record<string, number> = { "4K": 0, "1080p": 1, "720p": 2, "480p": 3, "360p": 4 };

const isHindiTrack = (t: any) =>
  /hindi/i.test(`${t?.languageName || ""} ${t?.abbreviate || ""} ${t?.title || ""}`);

function captionLang(s: any): string {
  const raw = `${s?.abbreviate || ""} ${s?.title || ""}`;
  if (/hindi/i.test(raw)) return "hi";
  if (/english/i.test(raw)) return "en";
  return (s?.abbreviate || s?.title || "en").toLowerCase().slice(0, 8);
}

export async function resolveCastle(opts: {
  title: string;
  year?: string;
  kind: "movie" | "series";
  season?: number;
  episode?: number;
}): Promise<CastleResult> {
  const { title, year, kind } = opts;
  const season = opts.season || 1;
  const episode = opts.episode || 1;
  const diag: string[] = [];
  const t0 = Date.now();
  const empty = (why: string): CastleResult => {
    diag.push(why);
    return { title: "", streams: [], captions: [], noSource: true, diag: diag.join(" | ") };
  };

  const secKey = await getSecurityKey();
  diag.push(`key ok ${Date.now() - t0}ms`);

  const keyword = year ? `${title} ${year}` : title;
  const rows = await searchCastle(secKey, keyword, 20);
  if (!rows.length) return empty(`search "${keyword}": 0 rows`);
  const titleLc = title.toLowerCase();
  const match =
    rows.find((r) => {
      const name = String(r?.title || r?.name || "").toLowerCase();
      return name && (name.includes(titleLc) || titleLc.includes(name));
    }) || (rows.length === 1 ? rows[0] : null);
  if (!match) return empty(`search "${keyword}": ${rows.length} rows, no title match`);
  const castleId = String(match.id ?? match.redirectId ?? match.redirectIdStr ?? "");
  if (!castleId) return empty("search match has no id");
  diag.push(`match "${String(match.title || match.name)}" langs=${((match.languages as string[]) || []).join(",")}`);

  let details = await getCastleDetails(secKey, castleId);
  let activeId = castleId;

  /* series: per-season details live under a separate movieId */
  if (kind === "series") {
    const seasons = Array.isArray(details?.seasons) ? details.seasons : [];
    const entry =
      seasons.find((x: any) => Number(x?.seasonNumber ?? x?.number ?? x?.season) === season) ||
      seasons[season - 1];
    const sid = entry ? String(entry.movieId ?? entry.id ?? "") : "";
    if (sid && sid !== castleId) {
      details = await getCastleDetails(secKey, sid);
      activeId = sid;
      diag.push(`season redirect S${season}`);
    }
  }

  const episodes = Array.isArray(details?.episodes) ? details.episodes : [];
  if (!episodes.length) return empty("details: no episodes");
  const epEntry =
    kind === "series"
      ? episodes.find((x: any) => Number(x?.number) === episode) || episodes[episode - 1] || episodes[0]
      : episodes[0];
  const episodeId = String(epEntry?.id ?? "");
  if (!episodeId) return empty("episode has no id");

  const allTracks = Array.isArray(epEntry.tracks) ? epEntry.tracks : [];
  const hasIndividual = allTracks.some((t: any) => t?.existIndividualVideo === true);
  const langNames = allTracks.map((t: any) => t?.languageName || t?.abbreviate).filter(Boolean).join(", ");
  const hindi = allTracks.filter(isHindiTrack);
  const rest = allTracks.filter((t: any) => !isHindiTrack(t));
  /* Hindi-first: the Hindi track plus one fallback (OST/English); shared
   * mode when no track has its own encode (Hindmovie semantics). */
  const chosen = hasIndividual
    ? hindi.length ? [hindi[0], ...rest.slice(0, 1)] : rest.slice(0, 2)
    : [];
  diag.push(`eps=${episodes.length} indiv=${hasIndividual} tracks=${langNames || "none"}`);

  const streams: CastleStream[] = [];
  const captions: CastleCaption[] = [];
  const seen = new Set<string>();
  const seenCap = new Set<string>();
  let denied = 0;
  const resolutions = [3, 2, 1];

  const absorb = (data: any, langLabel: string, res: number) => {
    if (!data) return;
    /* permissionDenied = silent fallback to another language's file */
    if (data.permissionDenied === true) {
      denied++;
      return;
    }
    for (const s of (data.subtitles || []) as any[]) {
      if (typeof s?.url !== "string" || !s.url) continue;
      const url = s.url.replace(/ /g, "%20");
      if (seenCap.has(url)) continue;
      seenCap.add(url);
      captions.push({ lang: captionLang(s), name: s.title || s.abbreviate || "Subtitle", url });
    }
    /* videoUrl ONLY: the videos[] catalog is OST-ordered and serves the
     * wrong language for dubbed requests (Hindmovie + meowtv consensus -
     * neither touches videos[]). */
    const url = data.videoUrl;
    if (typeof url !== "string" || !url || seen.has(url)) return;
    seen.add(url);
    streams.push({
      url,
      quality: streamQuality(url, data.resolutionDescription, 0, RES_LABEL[res] || `${res}p`),
      size: typeof data.size === "number" ? data.size : undefined,
      platform: langLabel ? `Castle [${langLabel}]` : "Castle",
      lang: langLabel || "",
    });
  };

  if (chosen.length) {
    const jobs = chosen.map((track: any) => {
      const langLabel = String(track?.languageName || track?.abbreviate || "");
      const languageId = String(track?.languageId ?? "");
      if (!languageId) return Promise.resolve([]);
      return Promise.allSettled(
        resolutions.map((res) =>
          getVideo(secKey, activeId, episodeId, languageId, res).then((data) => ({ data, res }))
        )
      ).then((rs) => rs.flatMap((r) =>
        r.status === "fulfilled" ? [{ data: r.value.data, res: r.value.res, langLabel }] : []
      ));
    });
    for (const batch of await Promise.all(jobs)) {
      for (const { data, res, langLabel } of batch) absorb(data, langLabel, res);
    }
    diag.push(`by-lang: ${streams.length} streams`);
  }

  /* fallback: shared (language-agnostic) encodes */
  if (!streams.length) {
    const rs = await Promise.allSettled(
      [3, 2, 1].map((res) => getVideo(secKey, activeId, episodeId, null, res).then((data) => ({ data, res })))
    );
    for (const r of rs) {
      if (r.status === "fulfilled")
        absorb(r.value.data, hasIndividual ? "" : langNames, r.value.res);
    }
    diag.push(`shared: ${streams.length} streams`);
  }
  if (denied) diag.push(`${denied} permissionDenied skipped`);

  streams.sort((a, b) => (QUALITY_RANK[a.quality] ?? 99) - (QUALITY_RANK[b.quality] ?? 99));
  const label = kind === "series"
    ? `${String(match.title || match.name || title)} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    : String(match.title || match.name || title);
  if (!streams.length) return empty("getVideo2: no playable urls");
  diag.push(`total ${Date.now() - t0}ms`);
  return { title: label, streams, captions, noSource: false, diag: diag.join(" | ") };
}
