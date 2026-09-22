import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { createRequire } from "module";
import { resolveMoviesMod, bypassMoviesModUrl } from "./moviesmod";

const requireHelper = (() => {
  if (typeof require === "function") {
    return require;
  }
  const fileUrl =
    typeof import.meta !== "undefined" && (import.meta as any)?.url
      ? (import.meta as any).url
      : `file://${process.cwd()}/server.js`;
  return createRequire(fileUrl);
})();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type VegaStorageType =
  | "cloudflare_r2"
  | "aws"
  | "cf_worker"
  | "fastdl"
  | "pixeldrain"
  | "gofile"
  | "direct"
  | "ddl";

export type VegaStreamRow = {
  name: string;
  description: string;
  url: string;
  quality?: string;
  size?: string;
  provider?: string;
  subtitles?: { lang: string; name: string; url: string }[];
  headers?: Record<string, string>;
  blog?: string;
  linkType?: "direct" | "ddl" | "bypassed";
  storageType?: VegaStorageType;
  season?: number;
  episode?: number;
  isBypassed?: boolean;
  originalUrl?: string;
};

export type AvailableEpisode = {
  season: number;
  episode: number;
  title?: string;
};

export type VegaProvidersResult = {
  rows: VegaStreamRow[];
  streams: VegaStreamRow[];
  availableEpisodes?: AvailableEpisode[];
  currentEpisode?: { season: number; episode: number };
  laneError?: string;
  diag?: {
    total: number;
    providersUsed: string[];
    bypassedCount?: number;
  };
};

const providerContext = {
  axios,
  cheerio,
  commonHeaders: {
    "User-Agent": UA,
  },
  Aes: {},
};

function timeoutPromise<T>(p: Promise<T>, ms = 8500, fallback: T = null as unknown as T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, ms);
    p.then((res) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(res);
      }
    }).catch(() => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    });
  });
}

function normalizeTitle(t: string): string {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectStorageType(url: string, serverName?: string): VegaStorageType {
  const u = (url || "").toLowerCase();
  const s = (serverName || "").toLowerCase();

  if (
    u.includes("r2.dev") ||
    u.includes("cloudflarestorage") ||
    s.includes("cf storage") ||
    s.includes("r2")
  ) {
    return "cloudflare_r2";
  }

  if (
    u.includes("hakunaymatata.com") ||
    u.includes("cloudfront.net") ||
    u.includes("s3.amazonaws.com") ||
    s.includes("aws") ||
    s.includes("moviebox")
  ) {
    return "aws";
  }

  if ((u.includes(".dev") && !u.includes("r2.dev")) || s.includes("cf worker") || s.includes("worker")) {
    return "cf_worker";
  }

  if (u.includes("pixeldrain") || s.includes("pixeldrain")) {
    return "pixeldrain";
  }

  if (u.includes("fastdl") || u.includes("fsl.") || u.includes("hubcdn") || s.includes("fastdl") || s.includes("hubcdn")) {
    return "fastdl";
  }

  if (u.includes("gofile.io") || s.includes("gofile")) {
    return "gofile";
  }

  if (u.includes(".mp4") || u.includes(".mkv")) {
    return "direct";
  }

  return "ddl";
}

/**
 * Smart season and episode matching for TV series posts.
 * Prevents returning Season 4 when Season 1 is requested (e.g. for Reacher).
 */
export function findBestSeriesPost(posts: any[], cleanTitle: string, season: number): any {
  if (!posts || posts.length === 0) return null;
  const sNum = Number(season) || 1;
  const titleTokens = cleanTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2 && !["and", "the", "dual", "audio", "season", "episode"].includes(t));

  const titleMatched = posts.filter((p) => {
    const pt = (p.title || "").toLowerCase();
    if (titleTokens.length === 0) return true;
    return titleTokens.some((t) => pt.includes(t));
  });
  const pool = titleMatched.length > 0 ? titleMatched : posts;

  const sRegex1 = new RegExp(`\\bseason\\s*0*${sNum}\\b`, "i");
  const sRegex2 = new RegExp(`\\bs0*${sNum}\\b`, "i");
  const sRegex3 = new RegExp(`\\bs0*${sNum}e\\d`, "i");
  const rangeRegex = /\bseason\s*0*(\d+)\s*[-–to]+\s*0*(\d+)\b/i;
  const rangeRegex2 = /\bs0*(\d+)\s*[-–to]+\s*s?0*(\d+)\b/i;

  // 1. Post explicitly naming Season X (e.g. Reacher (Season 1))
  for (const p of pool) {
    const pt = (p.title || "").toLowerCase();
    const otherM = pt.match(/\bseason\s*0*(\d+)\b/i) || pt.match(/\bs0*(\d+)\b/i);
    if (otherM && parseInt(otherM[1], 10) === sNum) return p;
    if ((sRegex1.test(pt) || sRegex2.test(pt) || sRegex3.test(pt)) && !otherM) return p;
  }

  // 2. Post covering a range containing Season X (e.g. Reacher (Season 1 - 3))
  for (const p of pool) {
    const pt = (p.title || "").toLowerCase();
    const m1 = pt.match(rangeRegex);
    if (m1) {
      const minS = parseInt(m1[1], 10);
      const maxS = parseInt(m1[2], 10);
      if (sNum >= minS && sNum <= maxS) return p;
    }
    const m2 = pt.match(rangeRegex2);
    if (m2) {
      const minS = parseInt(m2[1], 10);
      const maxS = parseInt(m2[2], 10);
      if (sNum >= minS && sNum <= maxS) return p;
    }
  }

  // 3. Complete / All Seasons post
  for (const p of pool) {
    const pt = (p.title || "").toLowerCase();
    if (/complete|all seasons|all episodes/i.test(pt)) {
      const otherM = pt.match(/\bseason\s*0*(\d+)\b/i) || pt.match(/\bs0*(\d+)\b/i);
      if (!otherM || parseInt(otherM[1], 10) === sNum) return p;
    }
  }

  // 4. Any post that does NOT explicitly match a different season
  for (const p of pool) {
    const pt = (p.title || "").toLowerCase();
    const otherM = pt.match(/\bseason\s*0*(\d+)\b/i) || pt.match(/\bs0*(\d+)\b/i);
    if (otherM && parseInt(otherM[1], 10) !== sNum) continue;
    return p;
  }

  return pool[0];
}

/**
 * Universal Bypass logic adapted from vega-providers (Zenda-Cross) & moviesmod resolver.
 * Bypasses intermediate landing URLs, shorteners, HubDrive, HubCloud, and ModPro SID
 * to return direct Cloudflare R2, Cloudflare Worker, AWS S3/CloudFront, and Pixeldrain streams.
 */
export async function bypassVegaLink(
  rawUrl: string,
  providerHint?: string,
  season = 1,
  episode = 1
): Promise<VegaStreamRow[]> {
  if (!rawUrl) return [];

  // Check if it is already a direct playable/storage stream
  const detected = detectStorageType(rawUrl, providerHint);
  if (
    detected === "cloudflare_r2" ||
    detected === "aws" ||
    detected === "cf_worker" ||
    detected === "pixeldrain" ||
    rawUrl.endsWith(".mp4")
  ) {
    return [
      {
        name: `Direct Stream [${detected.toUpperCase()}]`,
        description: `High-Speed Direct Link (${detected})`,
        url: rawUrl,
        storageType: detected,
        linkType: "direct",
        isBypassed: true,
        originalUrl: rawUrl,
      },
    ];
  }

  // 1. Check if it is a MoviesMod link (or providerHint is MoviesMod)
  const isMm =
    (providerHint && /moviesmod|mod/i.test(providerHint)) ||
    /modpro\.blog|cinematickit|dramadrip|unblocked|driveseed|driveleech/i.test(rawUrl);

  if (isMm) {
    try {
      const mmStreams = await timeoutPromise(bypassMoviesModUrl(rawUrl, episode), 15000, []);
      if (Array.isArray(mmStreams) && mmStreams.length > 0) {
        return mmStreams.map((s) => {
          const sType = detectStorageType(s.url);
          return {
            name: `MoviesMod [Auto-Bypassed] • ${s.quality} Stream`,
            description: `High-Speed Direct Stream (${sType})`,
            url: s.url,
            quality: s.quality,
            size: s.size ? `${(s.size / (1024 * 1024 * 1024)).toFixed(2)} GB` : undefined,
            provider: "MoviesMod",
            blog: "MoviesMod",
            storageType: sType,
            linkType: "direct",
            isBypassed: true,
            originalUrl: rawUrl,
          };
        });
      }
    } catch (err: any) {
      console.warn("[BYPASS MoviesMod]", err?.message);
    }
  }

  // 2. HdHub4u & HubCloud / Greenmotors stream bypass
  try {
    const hdStream = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/hdhub4u/stream.js"));
    const streams = await timeoutPromise(
      hdStream.getStream({
        link: rawUrl,
        type: "series",
        signal: new AbortController().signal,
        providerContext,
        isDownload: false,
      }),
      15000,
      []
    );

    if (Array.isArray(streams) && streams.length > 0) {
      return streams.map((s: any) => {
        const sType = detectStorageType(s.link, s.server);
        const isDirect =
          sType === "cloudflare_r2" ||
          sType === "aws" ||
          sType === "cf_worker" ||
          sType === "pixeldrain" ||
          s.link.endsWith(".mp4");

        return {
          name: `${s.server || "Direct Stream"} [${sType.toUpperCase()}]`,
          description: `Direct Bypass Stream (${sType})`,
          url: s.link,
          quality: s.quality || "1080p",
          storageType: sType,
          linkType: isDirect ? "direct" : "ddl",
          isBypassed: true,
          originalUrl: rawUrl,
          headers: s.headers,
        };
      });
    }
  } catch (err: any) {
    console.warn(`[BYPASS] Extraction failed for ${rawUrl}:`, err?.message);
  }

  return [];
}

export async function resolveVegaProvidersEngine(opts: {
  title: string;
  year?: number | string;
  kind?: string;
  season?: number;
  episode?: number;
  id?: string;
}): Promise<VegaProvidersResult> {
  const { title, year, kind = "movie", season = 1, episode = 1 } = opts;
  if (!title) {
    return { rows: [], streams: [], laneError: "Title is required for Vega providers search" };
  }

  const cleanTitle = title.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  const rows: VegaStreamRow[] = [];
  const providersUsed: string[] = [];
  const availableEpisodesMap = new Map<string, AvailableEpisode>();

  const isSeries = kind === "series" || kind === "tv";

  // 1. MovieBoxWeb - Direct playable AWS CloudFront/S3 MP4 video streams with subtitle tracks
  const resolveMovieBoxWeb = async (): Promise<VegaStreamRow[]> => {
    try {
      const mbPosts = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/movieBoxWeb/posts.js"));
      const mbMeta = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/movieBoxWeb/meta.js"));
      const mbStream = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/movieBoxWeb/stream.js"));
      const mbEp = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/movieBoxWeb/episodes.js"));

      const posts = await mbPosts.getSearchPosts({
        searchQuery: cleanTitle,
        page: 1,
        providerValue: "movieBoxWeb",
        providerContext,
        signal: new AbortController().signal,
      });

      if (!posts || posts.length === 0) return [];

      const normSearch = normalizeTitle(cleanTitle);
      const matchedPost =
        posts.find((p: any) => {
          const normPost = normalizeTitle(p.title);
          return normPost.includes(normSearch) || normSearch.includes(normPost);
        }) || posts[0];

      if (!matchedPost || !matchedPost.link) return [];

      const meta = await mbMeta.getMeta({
        link: matchedPost.link,
        providerContext,
      });

      if (!meta || !meta.linkList) return [];

      const resRows: VegaStreamRow[] = [];

      if (isSeries) {
        // Find top groups with episodesLink (e.g. Original Audio, Hindi)
        const seriesGroups = meta.linkList.filter((g: any) => g.episodesLink).slice(0, 2);
        for (const linkGroup of seriesGroups) {
          try {
            const eps = await mbEp.getEpisodes({
              url: linkGroup.episodesLink,
              providerContext,
            });

            if (Array.isArray(eps) && eps.length > 0) {
              // Register all available episodes for UI
              eps.forEach((e: any) => {
                let sNum = season;
                let eNum = episode;
                try {
                  const parsed = JSON.parse(e.link);
                  if (parsed.season) sNum = parsed.season;
                  if (parsed.episode) eNum = parsed.episode;
                } catch {
                  const m = (e.title || "").match(/S(\d+)\s*E(\d+)/i);
                  if (m) {
                    sNum = parseInt(m[1], 10);
                    eNum = parseInt(m[2], 10);
                  }
                }
                const key = `s${sNum}e${eNum}`;
                if (!availableEpisodesMap.has(key)) {
                  availableEpisodesMap.set(key, {
                    season: sNum,
                    episode: eNum,
                    title: e.title || `S${sNum} E${eNum}`,
                  });
                }
              });

              // Find the targeted episode
              const targetEp = eps.find((e: any) => {
                try {
                  const parsed = JSON.parse(e.link);
                  return parsed.season === season && parsed.episode === episode;
                } catch {
                  return (
                    e.title &&
                    (e.title.includes(`S0${season} E0${episode}`) ||
                      e.title.includes(`S${season} E${episode}`) ||
                      e.title.includes(`S${season}E${episode}`))
                  );
                }
              }) || eps[0];

              if (targetEp && targetEp.link) {
                const streams = await mbStream.getStream({
                  link: targetEp.link,
                  type: "series",
                  season,
                  episode,
                  providerContext,
                  signal: new AbortController().signal,
                });

                if (streams && streams.length > 0) {
                  for (const s of streams) {
                    if (s.link && s.link.startsWith("http")) {
                      const subs = (s.subtitles || []).map((sub: any) => ({
                        lang: sub.language || "en",
                        name: sub.title || "Subtitle",
                        url: sub.uri,
                      }));

                      resRows.push({
                        name: `AWS CloudFront Direct • ${s.quality || "1080p"} MP4 (${s.server || "Original Audio"})`,
                        description: `${matchedPost.title} • S${season}E${episode} • AWS S3/CloudFront High-Speed Stream`,
                        url: s.link,
                        quality: s.quality || "1080p",
                        provider: "MovieBoxWeb",
                        subtitles: subs,
                        headers: s.headers || {
                          Referer: "https://officialmoviebox.com",
                          Origin: "https://officialmoviebox.com",
                        },
                        blog: "MovieBox Web",
                        linkType: "direct",
                        storageType: "aws",
                        season,
                        episode,
                      });
                    }
                  }
                }
              }
            }
          } catch (err: any) {
            console.warn("[MovieBoxWeb] episodes error:", err?.message);
          }
        }
      } else {
        // Movie handling
        const linksToFetch: { link: string; groupTitle: string }[] = [];
        for (const linkGroup of meta.linkList.slice(0, 3)) {
          if (!linkGroup.directLinks || linkGroup.directLinks.length === 0) continue;
          for (const dl of linkGroup.directLinks.slice(0, 2)) {
            if (dl.link) {
              linksToFetch.push({
                link: dl.link,
                groupTitle: linkGroup.title || "Direct Stream",
              });
            }
          }
        }

        await Promise.all(
          linksToFetch.slice(0, 4).map(async ({ link: dlLink, groupTitle }) => {
            try {
              const streams = await mbStream.getStream({
                link: dlLink,
                type: "movie",
                season,
                episode,
                providerContext,
                signal: new AbortController().signal,
              });

              if (streams && streams.length > 0) {
                for (const s of streams) {
                  if (s.link && s.link.startsWith("http")) {
                    const subs = (s.subtitles || []).map((sub: any) => ({
                      lang: sub.language || "en",
                      name: sub.title || "Subtitle",
                      url: sub.uri,
                    }));

                    resRows.push({
                      name: `AWS CloudFront Direct • ${s.quality || "1080p"} MP4 (${groupTitle})`,
                      description: `${matchedPost.title} • AWS S3/CloudFront High-Speed Stream`,
                      url: s.link,
                      quality: s.quality || "1080p",
                      provider: "MovieBoxWeb",
                      subtitles: subs,
                      headers: s.headers || {
                        Referer: "https://officialmoviebox.com",
                        Origin: "https://officialmoviebox.com",
                      },
                      blog: "MovieBox Web",
                      linkType: "direct",
                      storageType: "aws",
                    });
                  }
                }
              }
            } catch {}
          })
        );
      }

      if (resRows.length > 0) providersUsed.push("MovieBoxWeb");
      return resRows;
    } catch {
      return [];
    }
  };

  // 2. VegaMovies (Dual Audio & Multi-Quality DDL Links with Episodes)
  const resolveVega = async (): Promise<VegaStreamRow[]> => {
    try {
      const vegaPosts = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/vega/posts.js"));
      const vegaMeta = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/vega/meta.js"));
      const vegaEp = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/vega/episodes.js"));

      const posts = await vegaPosts.getSearchPosts({
        searchQuery: cleanTitle,
        page: 1,
        providerValue: "vega",
        providerContext,
        signal: new AbortController().signal,
      });

      if (!posts || posts.length === 0) return [];

      const matchedPost = isSeries ? findBestSeriesPost(posts, cleanTitle, season) || posts[0] : posts[0];
      const meta = await vegaMeta.getMeta({
        link: matchedPost.link,
        providerContext,
      });

      if (!meta || !meta.linkList) return [];

      const resRows: VegaStreamRow[] = [];
      const sNum = Number(season) || 1;

      for (const item of meta.linkList) {
        if (isSeries) {
          if (item.episodesLink) {
            const itemTitle = (item.title || "").toLowerCase();
            const otherSeasonM = itemTitle.match(/\bseason\s*0*(\d+)\b/i) || itemTitle.match(/\bs0*(\d+)\b/i);
            if (otherSeasonM && parseInt(otherSeasonM[1], 10) !== sNum) {
              // Belongs exclusively to a different season
              continue;
            }

            const seasonPattern = `season ${sNum}`;
            const sPattern = `s0${sNum}`;
            const sPatternShort = `s${sNum}`;
            const matchesSeason =
              itemTitle.includes(seasonPattern) ||
              itemTitle.includes(sPattern) ||
              itemTitle.includes(sPatternShort) ||
              (itemTitle.includes("complete") && !otherSeasonM) ||
              meta.linkList.length <= 3;

            if (matchesSeason) {
              try {
                const eps = await vegaEp.getEpisodes({
                  url: item.episodesLink,
                  providerContext,
                });

                if (Array.isArray(eps)) {
                  eps.forEach((e: any, idx: number) => {
                    const epNum = idx + 1;
                    const key = `s${season}e${epNum}`;
                    if (!availableEpisodesMap.has(key)) {
                      availableEpisodesMap.set(key, {
                        season,
                        episode: epNum,
                        title: e.title || `Episode ${epNum}`,
                      });
                    }
                  });

                  const targetEp =
                    eps.find(
                      (e: any) =>
                        e.title &&
                        (e.title.toLowerCase().includes(`episode ${episode}`) ||
                          e.title.toLowerCase().includes(`ep ${episode}`) ||
                          e.title.toLowerCase().includes(`e0${episode}`) ||
                          e.title.toLowerCase().includes(`e${episode}`))
                    ) || eps[episode - 1] || eps[0];

                  if (targetEp && targetEp.link) {
                    resRows.push({
                      name: `VegaMovies • ${item.title || "Dual-Audio"} [S${season}E${episode}]`,
                      description: `${meta.title || matchedPost.title} • ${targetEp.title || `Episode ${episode}`}`,
                      url: targetEp.link,
                      quality: item.quality || "720p",
                      provider: "Vega",
                      blog: "VegaMovies",
                      linkType: "ddl",
                      storageType: detectStorageType(targetEp.link),
                      season,
                      episode,
                    });
                  }
                }
              } catch {}
            }
          }
        } else {
          if (item.directLinks && item.directLinks.length > 0) {
            for (const dl of item.directLinks) {
              if (dl.link) {
                resRows.push({
                  name: `VegaMovies • ${item.title || "Dual-Audio"} [${item.quality || "HD"}]`,
                  description: `${meta.title || matchedPost.title}`,
                  url: dl.link,
                  quality: item.quality || "1080p",
                  provider: "Vega",
                  blog: "VegaMovies",
                  linkType: "ddl",
                  storageType: detectStorageType(dl.link),
                });
              }
            }
          } else if (item.episodesLink) {
            resRows.push({
              name: `VegaMovies • ${item.title || "Dual-Audio"}`,
              description: `${meta.title || matchedPost.title}`,
              url: item.episodesLink,
              quality: item.quality || "720p",
              provider: "Vega",
              blog: "VegaMovies",
              linkType: "ddl",
              storageType: detectStorageType(item.episodesLink),
            });
          }
        }
      }

      if (resRows.length > 0) providersUsed.push("Vega");
      return resRows;
    } catch {
      return [];
    }
  };

  // 3. HdHub4u (HubCloud, Greenmotors, & Direct R2 Storage Links)
  const resolveHdHub = async (): Promise<VegaStreamRow[]> => {
    try {
      const hdhubPosts = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/hdhub4u/posts.js"));
      const hdhubMeta = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/hdhub4u/meta.js"));

      const posts = await hdhubPosts.getSearchPosts({
        searchQuery: cleanTitle,
        page: 1,
        providerValue: "hdhub4u",
        providerContext,
        signal: new AbortController().signal,
      });

      if (!posts || posts.length === 0) return [];

      const matchedPost = isSeries ? findBestSeriesPost(posts, cleanTitle, season) || posts[0] : posts[0];
      const meta = await hdhubMeta.getMeta({
        link: matchedPost.link,
        providerContext,
      });

      if (!meta || !meta.linkList) return [];

      const resRows: VegaStreamRow[] = [];
      const sNum = Number(season) || 1;

      for (const item of meta.linkList) {
        if (item.directLinks && item.directLinks.length > 0) {
          if (isSeries) {
            const itemTitle = (item.title || "").toLowerCase();
            const otherSeasonM = itemTitle.match(/\bseason\s*0*(\d+)\b/i) || itemTitle.match(/\bs0*(\d+)\b/i);
            if (otherSeasonM && parseInt(otherSeasonM[1], 10) !== sNum && !itemTitle.includes(`${sNum}-`)) {
              continue;
            }

            item.directLinks.forEach((dl: any, idx: number) => {
              const dlTitle = (dl.title || "").toLowerCase();
              const epMatch = dlTitle.match(/episode\s*(\d+)/i) || dlTitle.match(/ep\s*(\d+)/i);
              const epNum = epMatch ? parseInt(epMatch[1], 10) : idx + 1;
              const key = `s${season}e${epNum}`;
              if (!availableEpisodesMap.has(key)) {
                availableEpisodesMap.set(key, {
                  season,
                  episode: epNum,
                  title: dl.title || `Episode ${epNum}`,
                });
              }
            });

            const targetDl = item.directLinks.find((dl: any) => {
              const dlTitle = (dl.title || "").toLowerCase();
              return (
                dlTitle.includes(`episode ${episode}`) ||
                dlTitle.includes(`episode 0${episode}`) ||
                dlTitle.includes(`ep ${episode}`) ||
                dlTitle.includes(`ep 0${episode}`)
              );
            }) || item.directLinks[episode - 1];

            if (targetDl && targetDl.link) {
              resRows.push({
                name: `HdHub4u • ${item.title || "Direct Episode"} [S${season}E${episode}]`,
                description: `${meta.title || matchedPost.title} • ${targetDl.title || `Episode ${episode}`}`,
                url: targetDl.link,
                quality: item.quality || "720p",
                provider: "HdHub4u",
                blog: "HdHub4u",
                linkType: "ddl",
                storageType: detectStorageType(targetDl.link),
                season,
                episode,
              });
            }
          } else {
            for (const dl of item.directLinks.slice(0, 3)) {
              if (dl.link) {
                resRows.push({
                  name: `HdHub4u • ${item.title || "Hindi Dubbed"}`,
                  description: `${meta.title || matchedPost.title}`,
                  url: dl.link,
                  quality: item.quality || "720p",
                  provider: "HdHub4u",
                  blog: "HdHub4u",
                  linkType: "ddl",
                  storageType: detectStorageType(dl.link),
                });
              }
            }
          }
        }
      }

      // HdHub4u link automation: automatically bypass top episode link to extract Cloudflare R2 / Worker
      const topTarget = resRows.find((r) => r.url && (r.url.includes("greenmotors") || r.url.includes("hubcloud")));
      if (topTarget) {
        try {
          const directStreams = await timeoutPromise(
            bypassVegaLink(topTarget.url, "HdHub4u", season, episode),
            12000,
            []
          );
          if (directStreams && directStreams.length > 0) {
            for (const ds of directStreams) {
              resRows.unshift({
                ...ds,
                name: `HdHub4u [Auto-Bypassed] • ${ds.name}`,
                description: `${topTarget.description} • High-Speed Direct Stream`,
                season: isSeries ? season : undefined,
                episode: isSeries ? episode : undefined,
                isBypassed: true,
                linkType: "direct",
              });
            }
          }
        } catch {}
      }

      if (resRows.length > 0) providersUsed.push("HdHub4u");
      return resRows;
    } catch {
      return [];
    }
  };

  // 4. MoviesMod (`mod`) (Auto-Bypassed Instant Streams & DDL Links)
  const resolveMod = async (): Promise<VegaStreamRow[]> => {
    try {
      const resRows: VegaStreamRow[] = [];

      // 1. AUTOMATION: Direct MoviesMod instant stream resolver
      try {
        const mmInstant = await timeoutPromise(
          resolveMoviesMod({
            title: cleanTitle,
            year: String(year || ""),
            kind: isSeries ? "series" : "movie",
            season,
            episode,
          }),
          10000,
          null
        );

        if (mmInstant && Array.isArray(mmInstant.streams) && mmInstant.streams.length > 0) {
          for (const s of mmInstant.streams) {
            const sType = detectStorageType(s.url);
            resRows.push({
              name: `MoviesMod [Auto-Bypassed] • ${s.quality} Instant Stream`,
              description: `${mmInstant.title || title} [S${season}E${episode}] • Hindi Dual-Audio Instant Stream`,
              url: s.url,
              quality: s.quality,
              size: s.size ? `${(s.size / (1024 * 1024 * 1024)).toFixed(2)} GB` : undefined,
              provider: "MoviesMod",
              blog: "MoviesMod",
              linkType: "direct",
              storageType: sType,
              isBypassed: true,
              season: isSeries ? season : undefined,
              episode: isSeries ? episode : undefined,
            });
          }
        }
      } catch (err: any) {
        console.warn("[MoviesMod Instant Resolver]", err?.message);
      }

      // 2. Query Vega Provider Mod posts with smart season filter
      const modPosts = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/mod/posts.js"));
      const modMeta = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/mod/meta.js"));

      const posts = await modPosts.getSearchPosts({
        searchQuery: cleanTitle,
        page: 1,
        providerValue: "mod",
        providerContext,
        signal: new AbortController().signal,
      });

      if (posts && posts.length > 0) {
        const matchedPost = isSeries ? findBestSeriesPost(posts, cleanTitle, season) || posts[0] : posts[0];
        const meta = await modMeta.getMeta({
          link: matchedPost.link,
          providerContext,
        });

        if (meta && meta.linkList) {
          const sNum = Number(season) || 1;
          for (const item of meta.linkList) {
            if (isSeries) {
              const itemTitle = (item.title || "").toLowerCase();
              const otherSeasonM = itemTitle.match(/\bseason\s*0*(\d+)\b/i) || itemTitle.match(/\bs0*(\d+)\b/i);
              if (otherSeasonM && parseInt(otherSeasonM[1], 10) !== sNum) {
                // Skip posts for other seasons
                continue;
              }
            }

            if (item.directLinks && item.directLinks.length > 0) {
              for (const dl of item.directLinks.slice(0, 2)) {
                if (dl.link) {
                  resRows.push({
                    name: `MoviesMod • ${item.title || "Dual-Audio"}`,
                    description: `${meta.title || matchedPost.title}`,
                    url: dl.link,
                    quality: item.quality || "1080p",
                    provider: "MoviesMod",
                    blog: "MoviesMod",
                    linkType: "ddl",
                    storageType: detectStorageType(dl.link),
                    season: isSeries ? season : undefined,
                    episode: isSeries ? episode : undefined,
                  });
                }
              }
            } else if (item.episodesLink) {
              resRows.push({
                name: `MoviesMod • ${item.title || "Dual-Audio"}`,
                description: `${meta.title || matchedPost.title}`,
                url: item.episodesLink,
                quality: item.quality || "720p",
                provider: "MoviesMod",
                blog: "MoviesMod",
                linkType: "ddl",
                storageType: detectStorageType(item.episodesLink),
                season: isSeries ? season : undefined,
                episode: isSeries ? episode : undefined,
              });
            }
          }
        }
      }

      if (resRows.length > 0) providersUsed.push("MoviesMod");
      return resRows;
    } catch {
      return [];
    }
  };

  // 5. World4uFree & LuxMovies
  const resolveWorld4u = async (): Promise<VegaStreamRow[]> => {
    try {
      const wPosts = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/world4u/posts.js"));
      const wMeta = requireHelper(path.join(process.cwd(), "vega_providers_repo/dist/world4u/meta.js"));

      const posts = await wPosts.getSearchPosts({
        searchQuery: cleanTitle,
        page: 1,
        providerValue: "world4u",
        providerContext,
        signal: new AbortController().signal,
      });

      if (!posts || posts.length === 0) return [];
      const matchedPost = posts[0];
      const meta = await wMeta.getMeta({
        link: matchedPost.link,
        providerContext,
      });

      if (!meta || !meta.linkList) return [];
      const resRows: VegaStreamRow[] = [];

      for (const item of meta.linkList.slice(0, 3)) {
        if (item.directLinks && item.directLinks.length > 0) {
          for (const dl of item.directLinks.slice(0, 2)) {
            if (dl.link) {
              resRows.push({
                name: `World4uFree • ${item.title || matchedPost.title}`,
                description: `${meta.title || matchedPost.title}`,
                url: dl.link,
                quality: item.quality || "720p",
                provider: "World4uFree",
                blog: "World4uFree",
                linkType: "ddl",
                storageType: detectStorageType(dl.link),
                season: isSeries ? season : undefined,
                episode: isSeries ? episode : undefined,
              });
            }
          }
        }
      }

      if (resRows.length > 0) providersUsed.push("World4uFree");
      return resRows;
    } catch {
      return [];
    }
  };

  // Execute providers concurrently with 8.5s timeout
  const [mbRes, vegaRes, hdhubRes, modRes, w4uRes] = await Promise.allSettled([
    timeoutPromise(resolveMovieBoxWeb(), 8500, []),
    timeoutPromise(resolveVega(), 8500, []),
    timeoutPromise(resolveHdHub(), 8500, []),
    timeoutPromise(resolveMod(), 8500, []),
    timeoutPromise(resolveWorld4u(), 8500, []),
  ]);

  if (mbRes.status === "fulfilled" && mbRes.value) rows.push(...mbRes.value);
  if (vegaRes.status === "fulfilled" && vegaRes.value) rows.push(...vegaRes.value);
  if (hdhubRes.status === "fulfilled" && hdhubRes.value) rows.push(...hdhubRes.value);
  if (modRes.status === "fulfilled" && modRes.value) rows.push(...modRes.value);
  if (w4uRes.status === "fulfilled" && w4uRes.value) rows.push(...w4uRes.value);

  // Auto-bypass the top DDL links server-side to extract Cloudflare R2 and AWS links
  let bypassedCount = 0;
  const ddlCandidates = rows
    .filter(
      (r) =>
        r.linkType === "ddl" &&
        r.url &&
        (r.url.includes("greenmotors") ||
          r.url.includes("hubcloud") ||
          r.url.includes("hubdrive") ||
          r.url.includes("modpro.blog"))
    )
    .slice(0, 3);

  if (ddlCandidates.length > 0) {
    const bypassedResults = await Promise.all(
      ddlCandidates.map(async (candidate) => {
        try {
          const directStreams = await timeoutPromise(
            bypassVegaLink(candidate.url, candidate.provider, season, episode),
            8000,
            []
          );
          return directStreams.map((ds) => ({
            ...ds,
            name: `${ds.name} (from ${candidate.provider || "Vega"})`,
            description: `${candidate.description} • Bypassed Direct Stream`,
            season: candidate.season,
            episode: candidate.episode,
          }));
        } catch {
          return [];
        }
      })
    );

    const flattenedBypassed = bypassedResults.flat();
    if (flattenedBypassed.length > 0) {
      bypassedCount = flattenedBypassed.length;
      rows.unshift(...flattenedBypassed);
    }
  }

  const availableEpisodes = Array.from(availableEpisodesMap.values()).sort(
    (a, b) => (a.season === b.season ? a.episode - b.episode : a.season - b.season)
  );

  return {
    rows,
    streams: rows,
    availableEpisodes: availableEpisodes.length > 0 ? availableEpisodes : undefined,
    currentEpisode: isSeries ? { season, episode } : undefined,
    diag: {
      total: rows.length,
      providersUsed: Array.from(new Set(providersUsed)),
      bypassedCount,
    },
  };
}
