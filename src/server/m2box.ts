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

    // 0. Direct explicit slug if provided
    const explicitSlug = String(req.query.slug || "").trim();
    if (explicitSlug) {
      tried.add(explicitSlug);
      const d = await fetchJson(
        `${SITE}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(explicitSlug)}`,
        m2boxHeaders(explicitSlug),
        12000
      );
      if (d?.code === 0 && d?.data?.subject?.subjectId) {
        slug = explicitSlug;
        detail = d;
        subject = d.data.subject;
      }
    }

    // 1. Direct fast keyword search on M2Box SSR searchResult
    if (!slug) {
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

    const dubs: any[] = Array.isArray(detail?.data?.subject?.dubs) ? detail.data.subject.dubs : [];
    const sourceName = String(detail?.data?.resource?.source || "");

    const fetchTargets = [
      {
        subjectId: subject.subjectId,
        detailPath: slug,
        lanName: dubs.find((d) => String(d.subjectId) === String(subject.subjectId))?.lanName || (subject.corner ? `${subject.corner} dub` : "Original Audio"),
        lanCode: dubs.find((d) => String(d.subjectId) === String(subject.subjectId))?.lanCode || (subject.corner?.toLowerCase() === "hindi" ? "hi" : "en"),
      },
      ...dubs
        .filter((d) => String(d?.subjectId) !== String(subject.subjectId) && d?.subjectId && d?.detailPath)
        .map((d) => ({
          subjectId: d.subjectId,
          detailPath: d.detailPath,
          lanName: d.lanName || "",
          lanCode: d.lanCode || "",
        })),
    ];

    const playResults = await Promise.allSettled(
      fetchTargets.map((t) =>
        fetchJson(
          `${SITE}/wefeed-h5api-bff/subject/play?subjectId=${t.subjectId}&se=${playSe}&ep=${playEp}&detailPath=${encodeURIComponent(t.detailPath)}`,
          m2boxHeaders(t.detailPath),
          15000
        ).then((p) => ({ p, t }))
      )
    );

    const allRows: { name: string; description: string; url: string }[] = [];
    for (const r of playResults) {
      if (r.status === "fulfilled" && r.value?.p?.code === 0 && r.value?.p?.data?.hasResource !== false) {
        const pData = r.value.p.data;
        const target = r.value.t;
        const rRows = toRows(
          pData?.streams || [],
          pData?.hls || [],
          sourceName,
          target.lanName,
          target.lanCode,
          { subjectId: target.subjectId, detailPath: target.detailPath, se: playSe, ep: playEp }
        );
        allRows.push(...rRows);
      }
    }

    const rows = allRows;

    if (!rows.length) {
      const body = {
        streams: [],
        captions: [],
        noSource: true,
        title: subject.title || title,
        diag: `${diag.join(" ")} play:${playResults.length ? "empty" : "fail"}`,
      };
      cache.set(cacheKey, { at: Date.now(), body });
      return res.json(body);
    }

    // Sort Hindi first, then resolution descending, then Direct links first
    rows.sort((a, b) => {
      const aHi = /hindi/i.test(a.description) ? 0 : 1;
      const bHi = /hindi/i.test(b.description) ? 0 : 1;
      if (aHi !== bHi) return aHi - bHi;

      const aRes = parseInt(a.name, 10) || parseInt((a.description.match(/(\d{3,4})p/) || [])[1] || "0", 10);
      const bRes = parseInt(b.name, 10) || parseInt((b.description.match(/(\d{3,4})p/) || [])[1] || "0", 10);
      if (aRes !== bRes) return bRes - aRes;

      const aProxy = a.name.includes("Proxy") ? 0 : 1;
      const bProxy = b.name.includes("Proxy") ? 0 : 1;
      return aProxy - bProxy;
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

function robustDecode(str: string): string {
  let prev = str;
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(prev);
      if (decoded === prev) break;
      prev = decoded;
    } catch (e) {
      break;
    }
  }
  return prev;
}

function extractTargetUrl(req: Request): string {
  try {
    // Try to parse from the raw request URL to avoid Express query string splitting issues
    const originalUrl = req.originalUrl || req.url || "";

    // 1. Check for b64 parameter first
    const b64Idx = originalUrl.indexOf("b64=");
    if (b64Idx !== -1) {
      let b64val = originalUrl.slice(b64Idx + 4).split("&")[0];
      try {
        b64val = decodeURIComponent(b64val).replace(/ /g, "+");
        const decoded = Buffer.from(b64val, "base64").toString("utf8");
        if (decoded.startsWith("http")) {
          return decoded;
        }
      } catch (e) {}
    }

    // Fallback b64 query
    const queryB64 = req?.query?.b64;
    if (queryB64 && typeof queryB64 === "string") {
      try {
        const cleanB64 = String(queryB64).replace(/ /g, "+");
        const decoded = Buffer.from(cleanB64, "base64").toString("utf8");
        if (decoded.startsWith("http")) {
          return decoded;
        }
      } catch (e) {}
    }

    // 2. Check for traditional url parameter
    const idx = originalUrl.indexOf("url=");
    if (idx !== -1) {
      let target = originalUrl.slice(idx + 4);
      
      // Decode first so we can cleanly strip parameters
      target = robustDecode(target);

      // Remove proxy-specific parameters that are appended to the proxy URL
      target = target
        .replace(/[&?]download=[^&]*/g, "")
        .replace(/[&?]filename=[^&]*/g, "");

      if (target.startsWith("http")) {
        return target;
      }
    }

    // Fallback: Reconstruct from req.query.url and other query parameters
    let fallback = String(req?.query?.url || "");
    if (fallback) {
      fallback = robustDecode(fallback);
      try {
        const urlObj = new URL(fallback);
        const q = req?.query || {};
        for (const [key, val] of Object.entries(q)) {
          if (key === "url" || key === "download" || key === "filename" || key === "b64") {
            continue;
          }
          if (typeof val === "string" && !urlObj.searchParams.has(key)) {
            urlObj.searchParams.set(key, val);
          }
        }
        fallback = urlObj.toString();
      } catch (e) {
        const q = req?.query || {};
        for (const [key, val] of Object.entries(q)) {
          if (key === "url" || key === "download" || key === "filename" || key === "b64") {
            continue;
          }
          if (typeof val === "string" && !fallback.includes(`${key}=`)) {
            const sep = fallback.includes("?") ? "&" : "?";
            fallback += `${sep}${key}=${val}`;
          }
        }
      }
    }

    return fallback;
  } catch (err) {
    return "";
  }
}

function setM2BoxCorsHeaders(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Range, DNT, User-Agent, X-Requested-With, If-Modified-Since, Cache-Control, Content-Type, Origin, Accept, Authorization"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, Date, ETag, Content-Disposition"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

export async function handleM2BoxProxy(req: Request, res: Response) {
  // 1. Always set CORS headers immediately
  setM2BoxCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    let targetUrl = extractTargetUrl(req);

    const sub = String(req.query.sub || "");
    const path = String(req.query.path || "");
    const se = String(req.query.se || "0");
    const ep = String(req.query.ep || "0");
    const targetRes = String(req.query.res || "");

    // If targetUrl is missing or invalid, but sub & path are present, resolve on demand
    if ((!targetUrl || !targetUrl.startsWith("http")) && sub && path) {
      try {
        const onDemandPlay = await fetchJson(
          `${SITE}/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(sub)}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(path)}`,
          m2boxHeaders(path),
          12000
        );
        if (onDemandPlay?.code === 0 && Array.isArray(onDemandPlay?.data?.streams) && onDemandPlay.data.streams.length > 0) {
          const matched =
            onDemandPlay.data.streams.find((st: any) => String(st.resolutions) === targetRes) ||
            onDemandPlay.data.streams[0];
          if (matched?.url && matched.url.startsWith("http")) {
            targetUrl = matched.url;
          }
        }
      } catch (e) {}
    }

    if (!targetUrl || !targetUrl.startsWith("http")) {
      setM2BoxCorsHeaders(res);
      return res.status(400).json({ error: "Invalid stream url" });
    }

    const isHead = req.method === "HEAD";
    const rangeHeader = req.headers.range;
    const ifRangeHeader = req.headers["if-range"];
    const ifNoneMatchHeader = req.headers["if-none-match"];
    const ifModifiedSinceHeader = req.headers["if-modified-since"];

    const upstreamHeaders: Record<string, string> = {
      "User-Agent": UA,
      "Referer": "https://movieboxonline.net/",
      "Accept": "*/*",
    };

    if (rangeHeader) {
      upstreamHeaders["Range"] = rangeHeader as string;
    } else if (isHead) {
      // Use bytes=0-1 for HEAD to bypass S3/CDN 403 on HEAD methods
      upstreamHeaders["Range"] = "bytes=0-1";
    }

    if (ifRangeHeader) upstreamHeaders["If-Range"] = ifRangeHeader as string;
    if (ifNoneMatchHeader) upstreamHeaders["If-None-Match"] = ifNoneMatchHeader as string;
    if (ifModifiedSinceHeader) upstreamHeaders["If-Modified-Since"] = ifModifiedSinceHeader as string;

    let streamUrl = targetUrl;
    // Always use GET upstream even for HEAD to prevent upstream 403/405 errors
    let upstreamRes = await fetch(streamUrl, {
      method: "GET",
      headers: upstreamHeaders,
    });

    // If upstream rejected the token/stream (403, 404, 410, etc.) and we have metadata, fetch a fresh signed URL
    if (!upstreamRes.ok && upstreamRes.status >= 400 && sub && path) {
      try {
        const freshPlay = await fetchJson(
          `${SITE}/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(sub)}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(path)}`,
          m2boxHeaders(path),
          10000
        );
        if (freshPlay?.code === 0 && Array.isArray(freshPlay?.data?.streams) && freshPlay.data.streams.length > 0) {
          const matchingStream =
            freshPlay.data.streams.find((st: any) => String(st.resolutions) === targetRes) ||
            freshPlay.data.streams[0];
          if (matchingStream?.url && matchingStream.url.startsWith("http")) {
            streamUrl = matchingStream.url;
            upstreamRes = await fetch(streamUrl, {
              method: "GET",
              headers: upstreamHeaders,
            });
          }
        }
      } catch (refreshErr) {
        console.warn("[M2Box Proxy Token Refresh Error]:", refreshErr);
      }
    }

    const status = isHead && upstreamRes.status === 206 ? 200 : upstreamRes.status;
    res.status(status);
    setM2BoxCorsHeaders(res);

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

    // Ensure we always have Accept-Ranges
    res.setHeader("accept-ranges", "bytes");

    // Fix Content-Type if missing or octet-stream
    let contentType = (res.getHeader("content-type") as string) || "";
    if (!contentType || contentType.includes("octet-stream") || contentType.includes("text/html")) {
      if (streamUrl.includes(".m3u8")) {
        contentType = "application/vnd.apple.mpegurl";
      } else if (streamUrl.includes(".webm")) {
        contentType = "video/webm";
      } else {
        contentType = "video/mp4";
      }
      res.setHeader("content-type", contentType);
    }

    const downloadParam = req.query.download === "1";
    const filenameParam = String(req.query.filename || "");
    if (downloadParam || filenameParam) {
      const fn = filenameParam || "video.mp4";
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fn)}"`);
    } else {
      res.setHeader("Content-Disposition", "inline");
    }

    if (isHead) {
      const cr = upstreamRes.headers.get("content-range");
      if (cr) {
        const match = cr.match(/\/(\d+)/);
        if (match && match[1]) {
          res.setHeader("content-length", match[1]);
        }
      }
      return res.end();
    }

    if (!upstreamRes.body) {
      return res.end();
    }

    try {
      const nodeStream = Readable.fromWeb(upstreamRes.body as any);

      nodeStream.on("error", (err) => {
        console.error("[M2Box Stream Proxy Error]:", err?.message);
        if (!res.headersSent) {
          setM2BoxCorsHeaders(res);
          res.status(502).json({ error: "Stream error: " + err?.message });
        } else {
          res.destroy();
        }
      });

      req.on("close", () => {
        nodeStream.destroy();
      });

      nodeStream.pipe(res);
    } catch (pipeErr: any) {
      console.error("[M2Box Pipe Exception]:", pipeErr?.message);
      if (!res.headersSent) {
        setM2BoxCorsHeaders(res);
        res.status(500).json({ error: "Stream piping failed: " + pipeErr?.message });
      } else {
        res.destroy();
      }
    }
  } catch (err: any) {
    console.error("[M2Box Proxy Fatal Error]:", err?.message);
    if (!res.headersSent) {
      setM2BoxCorsHeaders(res);
      res.status(500).json({ error: "Proxy error: " + (err?.message || "Internal error") });
    } else {
      res.destroy();
    }
  }
}
