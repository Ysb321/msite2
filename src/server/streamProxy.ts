import type { Request, Response } from "express";
import { Readable } from "stream";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Helper to set comprehensive, dynamic CORS headers on all responses
 */
function setDynamicCorsHeaders(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Range, User-Agent, Referer, Accept, Content-Type, Origin, X-Requested-With, Authorization, X-Playback-Session-Id"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, Date, ETag, Content-Disposition"
  );
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * Rewrites relative and absolute segment URLs in HLS .m3u8 manifests so that
 * all media segment requests pass back through this CORS-enabled proxy.
 */
function rewriteM3u8Playlist(manifestText: string, baseUrl: string): string {
  const lines = manifestText.split("\n");
  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Handle URI attributes inside HLS tags like #EXT-X-KEY:...,URI="..." or #EXT-X-MAP:URI="..."
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/URI=["']([^"']+)["']/g, (_match, uri) => {
        try {
          const absoluteUri = new URL(uri, baseUrl).href;
          const b64 = Buffer.from(absoluteUri).toString("base64");
          const proxyUri = `/api/stream/proxy/segment.ts?b64=${encodeURIComponent(b64)}`;
          return `URI="${proxyUri}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
    }

    // Line is a segment or sub-manifest URL
    try {
      const absoluteUri = new URL(trimmed, baseUrl).href;
      const b64 = Buffer.from(absoluteUri).toString("base64");
      const ext = absoluteUri.includes(".m3u8") ? "playlist.m3u8" : "segment.ts";
      return `/api/stream/proxy/${ext}?b64=${encodeURIComponent(b64)}`;
    } catch {
      return line;
    }
  });

  return rewrittenLines.join("\n");
}

/**
 * Dedicated Proxy Route Handler for External Video Sources and Media Segments
 */
export async function handleStreamProxy(req: Request, res: Response) {
  try {
    // 1. Dynamic CORS Preflight (OPTIONS)
    setDynamicCorsHeaders(res);
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    // 2. Extract Target URL from Query or Path Parameters
    let targetUrl = "";
    if (req.query.b64) {
      try {
        targetUrl = Buffer.from(String(req.query.b64), "base64").toString("utf-8");
      } catch {}
    } else if (req.query.url) {
      targetUrl = String(req.query.url);
    }

    if (!targetUrl || !targetUrl.startsWith("http")) {
      return res.status(400).json({ error: "Invalid or missing target media URL" });
    }

    const isHead = req.method === "HEAD";

    // 3. Build Domain-Aware Upstream Request Headers
    const reqHeaders: Record<string, string> = {
      "User-Agent": UA,
    };

    if (req.headers.range) {
      reqHeaders["Range"] = req.headers.range;
    } else if (isHead) {
      // Fetch minimal range on HEAD to bypass Cloudflare S3/R2 403 on HEAD
      reqHeaders["Range"] = "bytes=0-1";
    }

    if (req.headers.referer && !req.headers.referer.includes("localhost") && !req.headers.referer.includes("run.app")) {
      reqHeaders["Referer"] = req.headers.referer as string;
    } else if (targetUrl.includes("workers.dev") || targetUrl.includes("hcloud") || targetUrl.includes("hubcloud")) {
      reqHeaders["Referer"] = "https://hshare.lol/";
    } else if (targetUrl.includes("googleusercontent.com") || targetUrl.includes("photos.google.com")) {
      reqHeaders["Referer"] = "https://photos.google.com/";
    } else if (targetUrl.includes("fslv2") || targetUrl.includes("fsl")) {
      reqHeaders["Referer"] = "https://fslv2.one/";
    } else if (targetUrl.includes("pixeldrain") || targetUrl.includes("pixelserver")) {
      reqHeaders["Referer"] = "https://pixeldrain.com/";
    } else if (targetUrl.includes("hicine")) {
      reqHeaders["Referer"] = "https://www.hicine.sbs/";
    } else if (targetUrl.includes("hindfile")) {
      reqHeaders["Referer"] = "https://hindfile.info/";
    }

    // 4. Perform Upstream Request
    const upstreamRes = await fetch(targetUrl, {
      method: "GET",
      headers: reqHeaders,
    });

    // Handle HTTP status
    const status = isHead && upstreamRes.status === 206 ? 200 : upstreamRes.status;
    res.status(status);

    // Ensure CORS headers are attached to active response
    setDynamicCorsHeaders(res);

    // Forward safe standard response headers
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

    res.setHeader("accept-ranges", "bytes");

    // 5. Determine Content Type
    let contentType = (res.getHeader("content-type") as string) || "";
    const isM3u8 = targetUrl.includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("m3u8");

    if (
      !contentType ||
      contentType.includes("octet-stream") ||
      contentType.includes("matroska") ||
      contentType.includes("mkv") ||
      contentType.includes("text/html") ||
      targetUrl.includes(".mkv") ||
      targetUrl.includes(".mpd") ||
      isM3u8
    ) {
      if (isM3u8) {
        contentType = "application/vnd.apple.mpegurl";
      } else if (targetUrl.includes(".mpd")) {
        contentType = "application/dash+xml";
      } else if (targetUrl.includes(".m4s") || targetUrl.includes(".mp4")) {
        contentType = "video/mp4";
      } else if (targetUrl.includes(".ts")) {
        contentType = "video/mp2t";
      } else if (targetUrl.includes(".webm")) {
        contentType = "video/webm";
      } else {
        contentType = "video/mp4";
      }
      res.setHeader("content-type", contentType);
    }

    // 6. Handle HEAD Request Completion
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

    // 7. Handle HLS Manifest Rewriting for Media Segments
    if (isM3u8) {
      const manifestText = await upstreamRes.text();
      const rewrittenManifest = rewriteM3u8Playlist(manifestText, targetUrl);
      res.setHeader("content-length", Buffer.byteLength(rewrittenManifest, "utf-8"));
      return res.send(rewrittenManifest);
    }

    // 8. Stream Video Body for MP4, MKV, TS Segments
    if (!upstreamRes.body) {
      return res.end();
    }

    const nodeStream = Readable.fromWeb(upstreamRes.body as any);
    nodeStream.on("error", () => {
      nodeStream.destroy();
    });
    req.on("close", () => {
      nodeStream.destroy();
    });
    nodeStream.pipe(res);
  } catch (err: any) {
    if (!res.headersSent) {
      setDynamicCorsHeaders(res);
      res.status(502).json({ error: "Media proxy error: " + err?.message });
    }
  }
}
