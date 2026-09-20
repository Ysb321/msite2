import type { Request, Response } from "express";
import { Readable } from "stream";
import {
  SITE,
  UA,
  ensureIndex,
  fetchJson,
  m2boxHeaders,
  matchSlugs,
  searchSlugs,
  toRows,
  verifySubject,
  words,
} from "../lib/m2boxCore";

const cache = new Map<string, { at: number; body: any }>();
const CACHE_TTL = 3 * 60 * 1000;

export async function handleM2BoxStream(req: Request, res: Response) {
  const { kind, id } = req.params;
  const type = kind === "movie" ? "movie" : "series";

  const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
  const off = parts[0] === "tmdb" ? 1 : 0;
  const tmdbId = parts[off] || "";
  const seRaw = parts[off + 1] || "0";
  const epRaw = parts[off + 2] || "0";
  let season = Math.max(0, parseInt(seRaw, 10) || 0);
  let episode = Math.max(0, parseInt(epRaw, 10) || 0);
  if (type === "series" && !episode) {
    episode = 1;
    if (!season) season = 1;
  }

  const title = String(req.query.title || "").trim();
  const origTitle = String(req.query.ot || "").trim();
  const year = String(req.query.year || "").slice(0, 4);
  const diag: string[] = [];

  if (!/^(tt\d+|\d+)$/.test(tmdbId)) {
    return res.status(400).json({ streams: [], captions: [], laneError: "Invalid TMDB/IMDb ID" });
  }

  const cacheKey = `${type}:${tmdbId}:${season}:${episode}:${words(title)}:${year}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return res.json(hit.body);
  }

  try {
    if (!title) {
      return res.json({
        streams: [],
        captions: [],
        laneError: "M2Box needs a title to search — try another server.",
      });
    }

    let slug = "";
    let detail: any = null;
    let subject: any = null;
    let transportFail = false;
    const tried = new Set<string>();

    // 1. Direct fast keyword search on M2Box SSR searchResult
    const searched = await searchSlugs(title, diag);
    if (searched.length) {
      diag.push(`search:${searched[0].slice(0, 24)}`);
      for (const cand of searched) {
        if (tried.has(cand)) continue;
        tried.add(cand);
        const d = await fetchJson(
          `${SITE}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(cand)}`,
          m2boxHeaders(cand),
          12000
        );
        if (d === null) {
          transportFail = true;
          diag.push(`fetch-fail:${cand.slice(0, 16)}`);
          break;
        }
        const s = d?.data?.subject;
        if (d?.code !== 0 || !s?.subjectId) {
          diag.push(`stale:${cand.slice(0, 16)}`);
          continue;
        }
        if (!verifySubject(s, title, origTitle, year)) {
          diag.push(`skip:${cand.slice(0, 16)}`);
          continue;
        }
        slug = cand;
        detail = d;
        subject = s;
        break;
      }
    }

    // 2. Second attempt: search with original title if different
    if (!slug && origTitle && origTitle.toLowerCase() !== title.toLowerCase()) {
      const searchedOrig = await searchSlugs(origTitle, diag);
      for (const cand of searchedOrig) {
        if (tried.has(cand)) continue;
        tried.add(cand);
        const d = await fetchJson(
          `${SITE}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(cand)}`,
          m2boxHeaders(cand),
          12000
        );
        if (d === null) continue;
        const s = d?.data?.subject;
        if (d?.code !== 0 || !s?.subjectId) continue;
        if (!verifySubject(s, title, origTitle, year)) continue;
        slug = cand;
        detail = d;
        subject = s;
        break;
      }
    }

    // 3. Third attempt: match cached sitemap/trending catalog
    if (!slug) {
      await ensureIndex(diag, false);
      const candidates = matchSlugs(title, origTitle).filter((c) => !tried.has(c));
      for (const cand of candidates) {
        tried.add(cand);
        const d = await fetchJson(
          `${SITE}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(cand)}`,
          m2boxHeaders(cand),
          12000
        );
        if (d === null) {
          transportFail = true;
          break;
        }
        const s = d?.data?.subject;
        if (d?.code !== 0 || !s?.subjectId) continue;
        if (!verifySubject(s, title, origTitle, year)) continue;
        slug = cand;
        detail = d;
        subject = s;
        break;
      }
    }

    if (!slug || !subject) {
      if (transportFail) {
        return res.json({
          streams: [],
          captions: [],
          laneError: "M2Box upstream is temporarily unreachable — please retry in a moment.",
          diag: diag.join(" "),
        });
      }
      const body = {
        streams: [],
        captions: [],
        noSource: true,
        title,
        diag: `${diag.join(" ")} verify:fail`,
      };
      cache.set(cacheKey, { at: Date.now(), body });
      return res.json(body);
    }

    // Resolve season & episode
    let playSe = 0;
    let playEp = 0;
    if (type === "series") {
      const seasons: any[] = detail?.data?.resource?.seasons || [];
      const real =
        seasons.find((x) => x?.se === season) ||
        seasons.find((x) => x?.se === 1) ||
        seasons[0];
      playSe = real?.se ?? season;
      const maxEp = Number(real?.maxEp || 0);
      playEp = maxEp ? Math.min(Math.max(episode, 1), maxEp) : Math.max(episode, 1);
    }

    const play = await fetchJson(
      `${SITE}/wefeed-h5api-bff/subject/play?subjectId=${subject.subjectId}&se=${playSe}&ep=${playEp}&detailPath=${encodeURIComponent(slug)}`,
      m2boxHeaders(slug),
      15000
    );

    const data = play?.data;
    const rows =
      play?.code === 0 && data?.hasResource !== false
        ? toRows(data?.streams || [], data?.hls || [], String(detail?.data?.resource?.source || ""))
        : [];

    if (!rows.length) {
      const body = {
        streams: [],
        captions: [],
        noSource: true,
        title: subject.title || title,
        diag: `${diag.join(" ")} play:${play?.code === 0 ? "empty" : "fail"}`,
      };
      cache.set(cacheKey, { at: Date.now(), body });
      return res.json(body);
    }

    // Sort Hindi first, then resolution descending
    rows.sort((a, b) => {
      const aHi = /hindi/i.test(a.description) ? 0 : 1;
      const bHi = /hindi/i.test(b.description) ? 0 : 1;
      if (aHi !== bHi) return aHi - bHi;
      return (
        (parseInt(b.name, 10) || 0) - (parseInt(a.name, 10) || 0) ||
        (parseInt((b.description.match(/(\d{3,4})p/) || [])[1] || "0", 10) -
          parseInt((a.description.match(/(\d{3,4})p/) || [])[1] || "0", 10))
      );
    });

    const body = {
      streams: rows,
      captions: [],
      title: subject.title || title,
      diag: diag.join(" "),
    };
    cache.set(cacheKey, { at: Date.now(), body });
    return res.json(body);
  } catch (err: any) {
    return res.json({
      streams: [],
      captions: [],
      laneError: "M2Box is unreachable right now — tap Retry to search again.",
      diag: `${diag.join(" ")} error:${err?.message || ""}`,
    });
  }
}

export async function handleM2BoxProxy(req: Request, res: Response) {
  const targetUrl = String(req.query.url || "");
  if (!targetUrl || !targetUrl.startsWith("http")) {
    return res.status(400).send("Invalid stream url");
  }

  try {
    const rangeHeader = req.headers.range;
    const upstreamHeaders: Record<string, string> = {
      "User-Agent": UA,
      "Referer": "https://m2box.org/",
      "Accept": "*/*",
    };
    if (rangeHeader) {
      upstreamHeaders["Range"] = rangeHeader;
    }

    const upstreamRes = await fetch(targetUrl, {
      headers: upstreamHeaders,
    });

    res.status(upstreamRes.status);

    const forwardHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "last-modified",
      "etag",
      "cache-control",
    ];

    for (const h of forwardHeaders) {
      const val = upstreamRes.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "video/mp4");
    }

    const downloadParam = req.query.download === "1";
    const filenameParam = String(req.query.filename || "");
    if (downloadParam || filenameParam) {
      const fn = filenameParam || "video.mp4";
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fn)}"`);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

    if (req.method === "HEAD") {
      return res.end();
    }

    if (!upstreamRes.body) {
      return res.end();
    }

    const nodeStream = Readable.fromWeb(upstreamRes.body as any);
    req.on("close", () => {
      nodeStream.destroy();
    });
    nodeStream.pipe(res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(502).send("Proxy error: " + err?.message);
    }
  }
}
