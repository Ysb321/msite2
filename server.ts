import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { getTmdbMeta } from "./src/lib/tmdb";
import { handleM2BoxStream, handleM2BoxProxy } from "./src/server/m2box";
import { handleStreamProxy } from "./src/server/streamProxy";
import { resolveCastle } from "./src/lib/castle";
import { resolveMoviesMod } from "./src/lib/moviesmod";
import { resolveNuvio } from "./src/lib/nuvio";
import { resolveLicensedAnime } from "./src/lib/licensedanime";
import { resolveHindMovie } from "./src/lib/hindmovie";
import { resolveHiCine } from "./src/lib/hicine";
import { resolveYoMoviesStream } from "./src/lib/yomovies";
import { resolveMovieNestStream } from "./src/lib/movienest";
import { resolveNetNaijaStream } from "./src/lib/netnaija";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Universal Dedicated Stream Proxy for MKV, MP4, HLS, TS Segments, and Cloud Streams
  app.all("/api/stream/proxy", handleStreamProxy);
  app.all("/api/stream/proxy/video.mp4", handleStreamProxy);
  app.all("/api/stream/proxy/segment.ts", handleStreamProxy);
  app.all("/api/stream/proxy/playlist.m3u8", handleStreamProxy);
  app.all("/api/stream/proxy/manifest.mpd", handleStreamProxy);
  app.all("/api/stream/proxy/*", handleStreamProxy);

  // Server 26 - M2Box
  app.get("/api/m2box/stream/:kind/:id", handleM2BoxStream);
  app.all("/api/m2box/proxy", handleM2BoxProxy);
  app.all("/api/m2box/proxy/stream.mp4", handleM2BoxProxy);

  // Server 9 & 29 - WebStreamr / WebStreamrMBG (Stremio Addon proxy via RisPNG/fmhywebstremio local runner)
  app.get("/api/webstreamr/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const cleanId = decodeURIComponent(id || "");
      const configObj = {
        multi: "on",
        showErrors: "off",
        includeExternalUrls: "on"
      };
      const cfgSegment = encodeURIComponent(JSON.stringify(configObj));
      const targetUrl = `http://127.0.0.1:31546/${cfgSegment}/stream/${kind}/${cleanId}.json`;
      
      const upstream = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (!upstream.ok) {
        throw new Error(`Upstream returned ${upstream.status}`);
      }
      const text = await upstream.text();
      res.setHeader("Content-Type", "application/json");
      res.send(text);
    } catch (err: any) {
      res.json({ streams: [], laneError: "FMHY WebStreamr error", diag: err?.message });
    }
  });

  app.get("/api/webstreamr/resolve", async (req, res) => {
    try {
      const url = String(req.query.url || "").trim();
      if (!url) {
        return res.json({ ok: false, error: "Missing URL parameter" });
      }

      if (url.includes("/extract") || url.includes("baby-beamup.club")) {
        const response = await fetch(url, {
          method: "GET",
          redirect: "follow",
        });
        const finalUrl = response.url;
        return res.json({
          ok: true,
          kind: "file",
          url: finalUrl,
          links: [finalUrl],
        });
      }

      return res.json({
        ok: true,
        kind: "file",
        url: url,
        links: [url],
      });
    } catch (e: any) {
      res.json({ ok: false, error: e?.message || "Resolution failed" });
    }
  });

  // M3U8 & Segment Proxy for YoMovies / SpeedoStream HLS streams
  app.options("/api/yomovies/proxy", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    return res.status(204).end();
  });

  app.get("/api/yomovies/proxy", async (req, res) => {
    try {
      const targetUrl = String(req.query.url || "").trim();
      if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
        return res.status(400).send("Invalid target URL");
      }

      const UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
      const upstreamRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": UA,
          Referer: "https://speedostream1.com/",
        },
      });

      if (!upstreamRes.ok) {
        return res.status(upstreamRes.status).send(`Upstream error: ${upstreamRes.statusText}`);
      }

      const contentType = upstreamRes.headers.get("content-type") || "";
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");

      // If playlist (.m3u8), rewrite URIs to route through this proxy using relative path
      if (
        contentType.includes("mpegurl") ||
        contentType.includes("m3u8") ||
        targetUrl.includes(".m3u8")
      ) {
        const text = await upstreamRes.text();
        const proxyBase = "/api/yomovies/proxy";

        const lines = text.split(/\r?\n/);
        const rewritten = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return "";

          if (trimmed.startsWith("#")) {
            if (trimmed.includes("URI=")) {
              return trimmed.replace(/URI=["']([^"']+)["']/g, (_, p1) => {
                const absUrl = new URL(p1, targetUrl).href;
                return `URI="${proxyBase}?url=${encodeURIComponent(absUrl)}"`;
              });
            }
            return trimmed;
          }

          const absUrl = new URL(trimmed, targetUrl).href;
          return `${proxyBase}?url=${encodeURIComponent(absUrl)}`;
        });

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        return res.send(rewritten.join("\n"));
      }

      // For binary streams (.ts segments, key files, images)
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      const arrayBuffer = await upstreamRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      return res.status(500).send("Proxy error: " + err?.message);
    }
  });

  app.get("/api/proxy/html", async (req, res) => {
    try {
      const targetUrl = String(req.query.url || "").trim();
      if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
        return res.status(400).send("Invalid target URL");
      }

      const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
      let upstreamRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }).catch(() => null);

      if (!upstreamRes || !upstreamRes.ok || upstreamRes.status === 403) {
        if (targetUrl.includes("prmovies.")) {
          const mirrors = ["prmovies.church", "prmovies.energy", "prmovies.site", "prmovies.org"];
          for (const mirror of mirrors) {
            const fallbackUrl = targetUrl.replace(/prmovies\.[a-z]+/i, mirror);
            if (fallbackUrl === targetUrl) continue;
            const fbRes = await fetch(fallbackUrl, {
              headers: {
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            }).catch(() => null);
            if (fbRes && fbRes.ok) {
              upstreamRes = fbRes;
              break;
            }
          }
        }
      }

      if (!upstreamRes || !upstreamRes.ok) {
        return res.status(upstreamRes?.status || 500).send(`Upstream error: ${upstreamRes?.statusText || "Fetch failed"}`);
      }

      let html = await upstreamRes.text();
      let finalUrl = upstreamRes.url || targetUrl;

      // If upstream redirected to prmovies.com, keep finalUrl pointing to targetUrl
      if (finalUrl.includes("prmovies.com")) {
        finalUrl = targetUrl;
      }

      // Replace prmovies.com references in html with requested domain
      try {
        const requestedHost = new URL(targetUrl).hostname;
        html = html.replace(/prmovies\.com/gi, requestedHost);
      } catch {}

      // Strip X-Frame-Options and Content-Security-Policy meta tags
      html = html.replace(/<meta\s+http-equiv=["']?(X-Frame-Options|Content-Security-Policy)["']?\s+content=["'][^"']+["']\s*\/?>/gi, "");

      // Neutralize frame-busting scripts
      html = html.replace(/(top|window\.top)\.location(\s*=\s*|\.href\s*=\s*)/gi, "void=");

      // Rewrite explicit prmovies / yomovies domain links and relative site links in HTML
      html = html.replace(/(href|action)=["']((?:https?:\/\/(?:www\.)?(?:prmovies|yomovies)\.[a-z]+|\/)[^"']*)["']/gi, (match, attr, path) => {
        if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?)(\?.*)?$/i.test(path) || path.includes('/wp-content/') || path.includes('/wp-includes/')) {
          return match;
        }
        try {
          const absUrl = new URL(path, finalUrl).href;
          return `${attr}="/api/proxy/html?url=${encodeURIComponent(absUrl)}"`;
        } catch {
          return match;
        }
      });

      const interceptScript = `<script>
(function() {
  function getAbs(u) {
    try { return new URL(u, document.baseURI || window.location.href).href; }
    catch(e) { return u; }
  }

  window.open = function(url) {
    if (url) {
      window.location.href = "/api/proxy/html?url=" + encodeURIComponent(getAbs(url));
    }
    return null;
  };

  document.addEventListener("click", function(e) {
    var a = e.target.closest("a");
    if (a && a.href) {
      var attr = a.getAttribute("href") || "";
      if (!attr || attr.startsWith("javascript:") || attr.startsWith("#")) return;
      var abs = getAbs(attr);
      if (abs.startsWith("http://") || abs.startsWith("https://")) {
        e.preventDefault();
        window.location.href = "/api/proxy/html?url=" + encodeURIComponent(abs);
      }
    }
  }, true);

  document.addEventListener("submit", function(e) {
    var form = e.target;
    if (form) {
      var act = form.getAttribute("action") || "";
      var absAct = getAbs(act);
      var method = (form.getAttribute("method") || "get").toLowerCase();
      if (method === "get") {
        e.preventDefault();
        var formData = new FormData(form);
        var params = new URLSearchParams(formData);
        var searchUrl = absAct + (absAct.includes("?") ? "&" : "?") + params.toString();
        window.location.href = "/api/proxy/html?url=" + encodeURIComponent(searchUrl);
      }
    }
  }, true);
})();
</script>`;

      // Inject base tag & client interception script in head
      const injectedHeader = `<base href="${finalUrl}">${interceptScript}`;
      if (/<head>/i.test(html)) {
        html = html.replace(/<head>/i, `<head>${injectedHeader}`);
      } else {
        html = `${injectedHeader}${html}`;
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    } catch (err: any) {
      return res.status(500).send("Proxy error: " + err?.message);
    }
  });

  /* ------------------------------------------------------------------
   * Scraper-backed resolution for the PRMovies / YoMovies servers.
   *
   * The old approach framed prmovies.church / yomovies.church directly.
   * That is dead: those domains rotate constantly (prmovies.church ->
   * .energy -> .mba -> pr-movies.co ...) and every one of them sends
   * X-Frame-Options / CSP frame-ancestors, so the iframe shows
   * "refused to connect" even when the domain IS alive.
   *
   * Instead we use @movie-web/providers (the movie-web scraper library),
   * which resolves a TMDB id to an actual playable stream from a pool of
   * ~12 maintained source scrapers. "PRMovies" now maps to the library's
   * Indian/regional-content scrapers (hindiscraper etc.) and "YoMovies"
   * to the general pool, so both servers return a real HLS/MP4 stream
   * the app's existing native player can play.
   * ------------------------------------------------------------------ */

  let mwProviders: any = null;
  async function getMovieWebProviders() {
    if (mwProviders) return mwProviders;
    const mod: any = await import("@movie-web/providers");
    mwProviders = mod.makeProviders({
      fetcher: mod.makeStandardFetcher(fetch),
      target: mod.targets.NATIVE,
      consistentIpForRequests: true,
    });
    return mwProviders;
  }

  type ScrapeMedia = {
    type: "movie" | "show";
    title: string;
    releaseYear: number;
    tmdbId: string;
    imdbId?: string;
    season?: { number: number; tmdbId?: string };
    episode?: { number: number; tmdbId?: string };
  };

  /** Build the @movie-web/providers media descriptor from TMDB metadata. */
  async function buildScrapeMedia(
    type: "movie" | "tv",
    id: string,
    titleHint: string,
    season: number,
    episode: number,
    imdbHint?: string,
    yearHint?: number
  ): Promise<ScrapeMedia | null> {
    let title = titleHint;
    let year = yearHint || 0;
    let imdbId = imdbHint || "";
    try {
      const meta: any = await getTmdbMeta(type, id);
      if (meta) {
        title = title || (meta.title || meta.name || "").trim();
        if (!year) {
          const dateStr = meta.release_date || meta.first_air_date || "";
          year = dateStr ? new Date(dateStr).getFullYear() : 0;
        }
        imdbId = imdbId || meta.external_ids?.imdb_id || "";
      }
    } catch {}
    if (!title) return null;
    // Several scrapers (primewire, ee3...) require an IMDb id.
    if (type === "movie") {
      return {
        type: "movie",
        title,
        releaseYear: year || 0,
        tmdbId: String(id),
        ...(imdbId ? { imdbId } : {}),
      };
    }
    return {
      type: "show",
      title,
      releaseYear: year || 0,
      tmdbId: String(id),
      ...(imdbId ? { imdbId } : {}),
      season: { number: season || 1 },
      episode: { number: episode || 1 },
    };
  }

  /** Pick the best playable URL out of a @movie-web/providers stream object. */
  function pickStreamUrl(stream: any): { url: string; headers?: Record<string, string> } | null {
    if (!stream) return null;
    if (stream.type === "hls" && stream.playlist) {
      return { url: stream.playlist, headers: stream.headers || stream.preferredHeaders };
    }
    if (stream.type === "file" && stream.qualities) {
      // highest quality first
      const order = ["4k", "2160", "1080", "720", "480", "360", "unknown"];
      for (const q of order) {
        const f = stream.qualities[q];
        if (f && f.url) return { url: f.url, headers: stream.headers || stream.preferredHeaders };
      }
      const first: any = Object.values(stream.qualities)[0];
      if (first && first.url) return { url: first.url, headers: stream.headers || stream.preferredHeaders };
    }
    return null;
  }

  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  /** Try one source (and its embeds). Returns a stream or throws with a reason. */
  async function trySource(
    providers: any,
    sourceId: string,
    media: ScrapeMedia,
    log: string[]
  ): Promise<{ url: string; sourceId: string; headers?: Record<string, string> } | null> {
    const out: any = await withTimeout(
      providers.runSourceScraper({ id: sourceId, media }),
      20000,
      sourceId
    );

    for (const st of out?.stream || []) {
      const picked = pickStreamUrl(st);
      if (picked) {
        log.push(`${sourceId}: OK (direct ${st.type})`);
        return { ...picked, sourceId };
      }
    }

    const embeds: any[] = out?.embeds || [];
    if (!embeds.length) {
      log.push(`${sourceId}: no streams, no embeds`);
      return null;
    }

    for (const em of embeds.slice(0, 6)) {
      try {
        const eout: any = await withTimeout(
          providers.runEmbedScraper({ id: em.embedId, url: em.url }),
          15000,
          em.embedId
        );
        for (const st of eout?.stream || []) {
          const picked = pickStreamUrl(st);
          if (picked) {
            log.push(`${sourceId}/${em.embedId}: OK (${st.type})`);
            return { ...picked, sourceId: `${sourceId}/${em.embedId}` };
          }
        }
        log.push(`${sourceId}/${em.embedId}: no playable stream`);
      } catch (e: any) {
        log.push(`${sourceId}/${em.embedId}: ${e?.message || "failed"}`);
      }
    }
    return null;
  }

  /** Run the scraper pool and return the first playable stream.
   *  `preferred` source ids are tried first, then the rest by library rank.
   *  Sources are run in small parallel batches so one slow/dead scraper
   *  doesn't stall the whole resolve. Per-source reasons are collected so
   *  failures are diagnosable instead of silent. */
  async function scrapeStream(
    media: ScrapeMedia,
    preferred: string[]
  ): Promise<{
    result: { url: string; sourceId: string; headers?: Record<string, string> } | null;
    log: string[];
  }> {
    const providers = await getMovieWebProviders();
    const all: any[] = providers.listSources();
    const ids: string[] = all
      .filter((s) => s.mediaTypes?.includes(media.type))
      .map((s) => s.id);
    const ordered = [
      ...preferred.filter((p) => ids.includes(p)),
      ...ids.filter((i) => !preferred.includes(i)),
    ];

    const log: string[] = [];
    if (!ordered.length) {
      log.push(`no sources support media type "${media.type}"`);
      return { result: null, log };
    }

    const BATCH = 3;
    for (let i = 0; i < ordered.length; i += BATCH) {
      const batch = ordered.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map((sid) => trySource(providers, sid, media, log))
      );
      for (let k = 0; k < settled.length; k++) {
        const s = settled[k];
        if (s.status === "fulfilled" && s.value) return { result: s.value, log };
        if (s.status === "rejected") {
          log.push(`${batch[k]}: ${s.reason?.message || "failed"}`);
        }
      }
    }
    return { result: null, log };
  }

  /** Route a resolved stream through the app's own stream proxy so that
   *  CORS / hotlink-referer restrictions don't block playback. */
  function proxiedStreamUrl(url: string, headers?: Record<string, string>) {
    const isHls = /\.m3u8(\?|#|$)/i.test(url);
    const base = isHls ? "/api/stream/proxy/playlist.m3u8" : "/api/stream/proxy";
    let out = `${base}?url=${encodeURIComponent(url)}`;
    if (headers && Object.keys(headers).length) {
      out += `&headers=${encodeURIComponent(JSON.stringify(headers))}`;
    }
    return out;
  }

  /** Shared handler for the two scraper-backed servers. */
  async function handleScraperServer(
    req: any,
    res: any,
    opts: { siteName: string; preferred: string[] }
  ) {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();
      const season = parseInt(String(req.query.s || req.query.season || "0"), 10) || 0;
      const episode = parseInt(String(req.query.e || req.query.episode || "0"), 10) || 0;
      const titleHint = String(req.query.title || "").trim();
      const imdbHint = String(req.query.imdb || "").trim();
      const yearHint = parseInt(String(req.query.year || "0"), 10) || 0;

      const media = await buildScrapeMedia(
        type,
        id,
        titleHint,
        season,
        episode,
        imdbHint,
        yearHint
      );
      if (!media) {
        return res.status(404).json({ error: "Could not determine title for this item." });
      }

      const { result: found, log } = await scrapeStream(media, opts.preferred);
      if (!found) {
        console.warn(
          `[${opts.siteName}] no stream for "${media.title}" (${media.type}):\n  ` +
            log.join("\n  ")
        );
        return res.status(404).json({
          error: `${opts.siteName}: no playable stream found for "${media.title}".`,
          tried: log,
        });
      }

      console.log(`[${opts.siteName}] "${media.title}" -> ${found.sourceId}`);
      return res.json({
        url: proxiedStreamUrl(found.url, found.headers),
        rawUrl: found.url,
        source: found.sourceId,
        title: media.title,
      });
    } catch (err: any) {
      return res.status(500).json({ error: "Scrape error: " + err?.message });
    }
  }

  /* Diagnostics: check whether THIS server can reach the scraper hosts and
   * TMDB. Open /api/scrapers/health in a browser to see what's blocked.
   * Use this first when a server returns "no playable stream found". */
  app.get("/api/scrapers/health", async (_req, res) => {
    const hosts = [
      "https://api.themoviedb.org/3/configuration",
      "https://8stream.xyz/",
      "https://soaper.live/",
      "https://api.whvx.net/",
      "https://2embed.cc/",
      "https://www.google.com/",
    ];
    const results = await Promise.all(
      hosts.map(async (u) => {
        const started = Date.now();
        try {
          const r = await fetch(u, {
            signal: AbortSignal.timeout(8000),
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            },
          });
          return { url: u, ok: true, status: r.status, ms: Date.now() - started };
        } catch (e: any) {
          return {
            url: u,
            ok: false,
            error: e?.message || String(e),
            ms: Date.now() - started,
          };
        }
      })
    );
    let sources: string[] = [];
    try {
      const providers = await getMovieWebProviders();
      sources = providers.listSources().map((s: any) => s.id);
    } catch (e: any) {
      sources = [`error: ${e?.message}`];
    }
    const reachable = results.filter((r) => r.ok).length;
    res.json({
      summary:
        reachable === 0
          ? "This server has NO outbound internet access to streaming hosts - scraping cannot work here."
          : `${reachable}/${results.length} hosts reachable.`,
      hosts: results,
      scraperSources: sources,
    });
  });

  // PRMovies server -> Indian / regional-leaning scrapers first
  app.get("/api/prmovies/resolve", (req, res) =>
    handleScraperServer(req, res, {
      siteName: "PRMovies",
      preferred: ["hindiscraper", "8stream", "streambox", "soapertv", "2embed"],
    })
  );

  // YoMovies server -> general pool, ranked by the library's own ranking
  app.get("/api/yomovies/resolve", (req, res) =>
    handleScraperServer(req, res, {
      siteName: "YoMovies",
      preferred: ["8stream", "soapertv", "streambox", "whvxMirrors", "m4ufree"],
    })
  );
  // MovieNestBD dynamic embed handler
  app.get("/api/movienest/embed", async (req, res) => {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();
      const season = Math.max(1, parseInt(String(req.query.s || req.query.season || "1"), 10));
      const episode = Math.max(1, parseInt(String(req.query.e || req.query.episode || "1"), 10));

      if (!id) {
        return res.status(400).send("Missing content ID");
      }

      const resolved = await resolveMovieNestStream(type, id, season, episode);

      if (resolved.ok && resolved.embedUrl) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>${resolved.title || "MovieNestBD Player"}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <iframe src="${resolved.embedUrl}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media"></iframe>
</body>
</html>`);
      } else {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MovieNestBD — Stream Not Available</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #0b0d14; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; text-align: center; }
    .box { max-width: 420px; padding: 2rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 1rem; }
    h2 { margin: 0 0 0.5rem 0; color: #f87171; font-size: 1.25rem; }
    p { color: #9ca3af; font-size: 0.875rem; line-height: 1.4; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Stream Not Found on MovieNestBD</h2>
    <p>${resolved.error || "No active stream available for this title."} Please try switching to another server above.</p>
  </div>
</body>
</html>`);
      }
    } catch (err: any) {
      res.status(500).send("Player resolution failed: " + err?.message);
    }
  });

  // NetNaija dynamic embed handler
  app.get("/api/netnaija/embed", async (req, res) => {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();
      const season = Math.max(1, parseInt(String(req.query.s || req.query.season || "1"), 10));
      const episode = Math.max(1, parseInt(String(req.query.e || req.query.episode || "1"), 10));

      if (!id) {
        return res.status(400).send("Missing content ID");
      }

      const resolved = await resolveNetNaijaStream(type, id, season, episode);

      if (resolved.ok && resolved.embedUrl) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="referrer" content="no-referrer">
  <title>${resolved.title || "NetNaija Player"}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
      -webkit-overflow-scrolling: touch;
    }
    
    /* Full viewport container */
    .viewport-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100vw;
      height: 200vh;
      background: #000;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }

    iframe {
      width: 100%;
      height: 200vh;
      border: 0;
      display: block;
      transform: scale(0.8);
      transform-origin: top left;
      width: 125%; /* Compensate for scale to fill width */
    }
  </style>
</head>
<body>
  <div class="viewport-container">
    <iframe src="${resolved.embedUrl}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media"></iframe>
  </div>
</body>
</html>`);
      } else {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>NetNaija — Stream Not Available</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #0b0d14; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; text-align: center; }
    .box { max-width: 420px; padding: 2rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 1rem; }
    h2 { margin: 0 0 0.5rem 0; color: #f87171; font-size: 1.25rem; }
    p { color: #9ca3af; font-size: 0.875rem; line-height: 1.4; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Stream Not Found on NetNaija</h2>
    <p>${resolved.error || "This title is currently not indexed or released on the NetNaija library."} Please try switching to another server above.</p>
  </div>
</body>
</html>`);
      }
    } catch (err: any) {
      res.status(500).send("Player resolution failed: " + err?.message);
    }
  });

  // HiCine · FSL, FSLv2, PixelServer & Cloud
  app.get("/api/hicine/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
      const tmdbId = parts[0] || "";
      const season = Math.max(1, parseInt(parts[1], 10) || 1);
      const episode = Math.max(1, parseInt(parts[2], 10) || 1);
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const directUrl = String(req.query.directUrl || "").trim();
      const result = await resolveHiCine({
        title,
        year,
        tmdbId,
        kind: kind === "movie" ? "movie" : "series",
        season,
        episode,
        directUrl: directUrl || undefined,
      });
      res.json(result);
    } catch (e: any) {
      res.json({ streams: [], captions: [], laneError: "HiCine error", diag: e?.message });
    }
  });

  // HindMovie · GDirect & Cloud
  app.get("/api/hindmovie/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
      const tmdbId = parts[0] || "";
      const season = Math.max(1, parseInt(parts[1], 10) || 1);
      const episode = Math.max(1, parseInt(parts[2], 10) || 1);
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const directUrl = String(req.query.directUrl || "").trim();
      const result = await resolveHindMovie({
        title,
        year,
        tmdbId,
        kind: kind === "movie" ? "movie" : "series",
        season,
        episode,
        directUrl: directUrl || undefined,
      });
      res.json(result);
    } catch (e: any) {
      res.json({ streams: [], captions: [], laneError: "HindMovie error", diag: e?.message });
    }
  });

  // Server 12 - Castle
  app.get("/api/castle/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
      const season = Math.max(1, parseInt(parts[1], 10) || 1);
      const episode = Math.max(1, parseInt(parts[2], 10) || 1);
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const result = await resolveCastle({
        title,
        year,
        kind: kind === "movie" ? "movie" : "series",
        season,
        episode,
      });
      res.json(result);
    } catch (e: any) {
      res.json({ streams: [], captions: [], laneError: "Castle error", diag: e?.message });
    }
  });

  // Server 13 - MoviesMod
  app.get("/api/moviesmod/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
      const season = Math.max(1, parseInt(parts[1], 10) || 1);
      const episode = Math.max(1, parseInt(parts[2], 10) || 1);
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const result = await resolveMoviesMod({
        title,
        year,
        kind: kind === "movie" ? "movie" : "series",
        season,
        episode,
      });
      res.json(result);
    } catch (e: any) {
      res.json({ streams: [], captions: [], laneError: "MoviesMod error", diag: e?.message });
    }
  });

  // Server 15 - Nuvio
  app.get("/api/nuvio/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
      const tmdbId = parts[0] || "";
      const season = Math.max(1, parseInt(parts[1], 10) || 1);
      const episode = Math.max(1, parseInt(parts[2], 10) || 1);
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const result = await resolveNuvio({
        title,
        year,
        tmdbId,
        kind: kind === "movie" ? "movie" : "series",
        season,
        episode,
      });
      res.json(result);
    } catch (e: any) {
      res.json({ streams: [], captions: [], laneError: "Nuvio error", diag: e?.message });
    }
  });

  // Licensed Anime
  app.get("/api/licensedanime/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
      const season = Math.max(1, parseInt(parts[1], 10) || 1);
      const episode = Math.max(1, parseInt(parts[2], 10) || 1);
      const title = String(req.query.title || "").trim();
      const altTitle = String(req.query.alt || "").trim();
      const result = await resolveLicensedAnime({
        title,
        altTitle,
        kind: kind === "movie" ? "movie" : "series",
        season,
        episode,
      });
      res.json(result);
    } catch (e: any) {
      res.json({ title: "", sources: [], laneError: "Licensed anime error", diag: e?.message });
    }
  });

  // Server 11 - DesiDDL (Hindi DDL Hubs)
  app.get("/api/desiddl/embed", async (req, res) => {
    try {
      const targetUrl = String(req.query.url || "").trim();
      if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
        return res.status(400).send("Invalid target URL");
      }
      const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
      const upstreamRes = await fetch(targetUrl, {
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      });
      if (!upstreamRes.ok) {
        return res.status(upstreamRes.status).send(`Error fetching page: ${upstreamRes.statusText}`);
      }
      let html = await upstreamRes.text();
      const captureScript = `
        <script>
          (function() {
            try {
              window.parent.postMessage({ type: 'yetflix-embed-ready' }, '*');
              document.addEventListener('click', function(e) {
                var a = e.target.closest('a');
                if (a && a.href) {
                  if (/\\.(mkv|mp4|avi|mov|m3u8|webm)(\\?|#|$)/i.test(a.href) || a.href.includes('googleusercontent.com') || a.href.includes('busycdn.xyz') || a.href.includes('r2.cloudflarestorage.com')) {
                    window.parent.postMessage({ type: 'yetflix-file', url: a.href }, '*');
                  }
                }
              }, true);
            } catch(err) {}
          })();
        </script>
      `;
      html = html.replace(/<head>/i, `<head>${captureScript}`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    } catch (err: any) {
      return res.status(500).send("Proxy error: " + err?.message);
    }
  });

  app.get("/api/desiddl/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const season = Math.max(1, parseInt(String(req.query.s || "1"), 10) || 1);
      const episode = Math.max(1, parseInt(String(req.query.e || "1"), 10) || 1);
      const cleanKind = kind === "movie" ? "movie" : "series";

      const opts = { title, year, kind: cleanKind, season, episode };

      // Query all sources simultaneously
      const [mmRes, hmRes, hcRes, nvRes, csRes, ymRes, mnRes, nnRes] = await Promise.allSettled([
        resolveMoviesMod(opts),
        resolveHindMovie(opts),
        resolveHiCine(opts),
        resolveNuvio({ ...opts, tmdbId: id }),
        resolveCastle(opts),
        resolveYoMoviesStream(cleanKind === "movie" ? "movie" : "tv", id, season, episode),
        resolveMovieNestStream(cleanKind === "movie" ? "movie" : "tv", id, season, episode),
        resolveNetNaijaStream(cleanKind === "movie" ? "movie" : "tv", id, season, episode),
      ]);

      function determineLinkType(url: string, customKind?: string): string {
        const u = url.toLowerCase();
        if (u.includes("gofile.io")) return "BROKEN";
        if (u.includes("r2.cloudflarestorage") || u.includes(".r2.dev")) return "⚡ R2 Cloud Direct";
        if (u.includes("googleusercontent.com") || u.includes("drive.google")) return "🟢 Google Drive Direct";
        if (u.includes("pixeldrain.com")) return "💧 Pixeldrain Direct";
        if (u.includes("busycdn.xyz") || u.includes("fastcdn")) return "⚡ High Speed CDN";
        if (u.includes(".m3u8")) return "📺 HLS Direct Stream";
        if (u.includes("hubcloud") || u.includes("gdflix")) return "☁️ HubCloud Direct";
        if (u.includes("castle")) return "🏰 Castle CDN";
        if (u.includes("yomovies") || u.includes("prmovies")) return "🎬 PRMovies Embed";
        if (u.includes("movienest")) return "🎬 MovieNest Player";
        if (u.includes("aoneroom.com") || u.includes("netnaija")) return "⚡ NetNaija Direct";
        if (customKind && customKind !== "Direct Link" && customKind !== "HiCine Stream") return customKind;
        return "🌐 DDL Hub Link";
      }

      function extractQuality(rawQuality?: string, textToScan: string = ""): string {
        const combined = `${rawQuality || ""} ${textToScan}`.toUpperCase();
        let resQual = "";
        if (/2160P|4K/i.test(combined)) resQual = "2160p 4K";
        else if (/1080P/i.test(combined)) resQual = "1080p";
        else if (/720P/i.test(combined)) resQual = "720p";
        else if (/480P/i.test(combined)) resQual = "480p";
        else if (/360P/i.test(combined)) resQual = "360p";

        let tag = "";
        if (/WEB-?DL|WEBRIP/i.test(combined)) tag = "WEB-DL";
        else if (/BLURAY|BDRIP/i.test(combined)) tag = "BluRay";
        else if (/HDRIP|HDTV/i.test(combined)) tag = "HDRip";
        else if (/CAM|HQ/i.test(combined)) tag = "CAM/HQ";

        if (resQual && tag) return `${resQual} ${tag}`;
        if (resQual) return `${resQual} ${resQual === "2160p 4K" ? "UHD" : resQual === "1080p" ? "Full HD" : "HD"}`;
        if (rawQuality && rawQuality !== "HD" && rawQuality.trim().length > 0) return rawQuality.trim();
        return "1080p Full HD";
      }

      function extractSize(bytes?: number, textToScan: string = "", qualityStr: string = ""): string {
        if (bytes && bytes > 0) {
          const gb = bytes / (1024 * 1024 * 1024);
          if (gb >= 1) return `${gb.toFixed(1)} GB`;
          const mb = bytes / (1024 * 1024);
          return `${mb.toFixed(0)} MB`;
        }
        const m = textToScan.match(/\b(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))\b/i);
        if (m) {
          return m[1].toUpperCase().replace("GIB", "GB").replace("MIB", "MB");
        }
        const qUpper = qualityStr.toUpperCase();
        if (qUpper.includes("2160") || qUpper.includes("4K")) return "3.8 GB";
        if (qUpper.includes("1080")) return "1.4 GB";
        if (qUpper.includes("720")) return "850 MB";
        if (qUpper.includes("480")) return "400 MB";
        return "1.2 GB";
      }

      const rows: any[] = [];
      const seenUrls = new Set<string>();

      function normalizeUrl(url: string): string {
        try {
          const u = new URL(url.trim());
          u.searchParams.delete("utm_source");
          u.searchParams.delete("utm_medium");
          u.searchParams.delete("ref");
          return (u.origin + u.pathname).toLowerCase().replace(/\/+$/, "") + u.search;
        } catch {
          return url.trim().toLowerCase();
        }
      }

      function addRow(item: {
        blog: string;
        rawUrl: string;
        quality?: string;
        bytes?: number;
        source?: string;
        file?: string;
        audio?: string;
        hubKind?: string;
        textScan?: string;
      }) {
        if (!item.rawUrl) return;
        const norm = normalizeUrl(item.rawUrl);
        if (seenUrls.has(norm)) return;

        // Filter out non-working / broken gofile.io links
        if (item.rawUrl.toLowerCase().includes("gofile.io") || item.rawUrl.toLowerCase().includes("filemanager")) {
          return;
        }

        seenUrls.add(norm);

        const scanText = `${item.file || ""} ${item.source || ""} ${item.textScan || ""} ${item.rawUrl}`;
        const finalQuality = extractQuality(item.quality, scanText);
        const finalSize = extractSize(item.bytes, scanText, finalQuality);
        const linkType = determineLinkType(item.rawUrl, item.hubKind);

        if (linkType === "BROKEN") return;

        rows.push({
          key: `ddl-${rows.length}-${Math.random().toString(36).substring(2, 6)}`,
          blog: item.blog,
          quality: finalQuality,
          size: finalSize,
          source: item.source || "Hindi Dual Audio",
          file: item.file || `${title} (${year || "2024"}) S${season}E${episode}`,
          audio: item.audio || "Hindi + English",
          hub: item.rawUrl,
          hubKind: linkType,
        });
      }

      // 1. MoviesMod
      if (mmRes.status === "fulfilled" && mmRes.value?.streams) {
        for (const s of mmRes.value.streams) {
          addRow({
            blog: "MoviesMod",
            rawUrl: s.url,
            quality: s.quality,
            bytes: s.size,
            source: s.platform || "Hindi Dual Audio",
            file: `${title} (${year || "2024"}) ${s.quality || "HD"}`,
            audio: s.lang || "Hindi + English",
            textScan: `${s.quality || ""} ${s.platform || ""}`,
          });
        }
      }

      // 2. VegaMovies / Nuvio
      if (nvRes.status === "fulfilled" && nvRes.value?.streams) {
        for (const s of nvRes.value.streams) {
          addRow({
            blog: "VegaMovies / Nuvio",
            rawUrl: s.url,
            quality: s.quality,
            bytes: s.size,
            source: s.platform || "Hindi DDL",
            file: `${title} (${year || "2024"}) ${s.quality || "HD"}`,
            audio: s.lang || "Hindi",
            hubKind: "VegaCloud",
            textScan: `${s.quality || ""} ${s.platform || ""}`,
          });
        }
      }

      // 3. Castle HD Engine
      if (csRes.status === "fulfilled" && csRes.value?.streams) {
        for (const s of csRes.value.streams) {
          addRow({
            blog: "Castle HD",
            rawUrl: s.url,
            quality: s.quality,
            bytes: s.size,
            source: s.platform || "Multi-Audio HD",
            file: `${title} (${year || "2024"}) Castle Stream`,
            audio: s.lang || "Hindi",
            hubKind: "Castle CDN Direct",
            textScan: `${s.quality || ""} ${s.platform || ""}`,
          });
        }
      }

      // 4. HindMovie
      if (hmRes.status === "fulfilled" && hmRes.value?.streams) {
        for (const s of hmRes.value.streams) {
          addRow({
            blog: "HindMovie",
            rawUrl: s.url,
            quality: s.name,
            source: s.description || "Hindi Dubbed",
            file: s.name || `${title} Hindi`,
            audio: "Hindi",
            hubKind: "GDirect / HubCloud",
            textScan: `${s.name || ""} ${s.description || ""}`,
          });
        }
      }

      // 5. HiCine
      if (hcRes.status === "fulfilled" && hcRes.value?.streams) {
        for (const s of hcRes.value.streams) {
          addRow({
            blog: "HiCine",
            rawUrl: s.url,
            quality: s.quality,
            bytes: s.size,
            source: s.platform || "Hindi Multi",
            file: `${title} (${year || "2024"}) ${s.quality || "HD"}`,
            audio: s.lang || "Hindi",
            hubKind: "HiCine Stream",
            textScan: `${s.quality || ""} ${s.platform || ""}`,
          });
        }
      }

      // 6. YoMovies / PRMovies
      if (ymRes.status === "fulfilled" && ymRes.value?.ok) {
        const url = ymRes.value.m3u8Url || ymRes.value.embedUrl;
        if (url) {
          addRow({
            blog: "YoMovies / PRMovies",
            rawUrl: url,
            quality: "1080p WEB-DL",
            source: "Hindi Stream",
            file: `${title} (${year || "2024"}) PRMovies`,
            audio: "Hindi Dual Audio",
            hubKind: ymRes.value.m3u8Url ? "Direct HLS Stream" : "Embed Player",
          });
        }
      }

      // 7. MovieNest
      if (mnRes.status === "fulfilled" && mnRes.value?.ok && mnRes.value.embedUrl) {
        addRow({
          blog: "MovieNest",
          rawUrl: mnRes.value.embedUrl,
          quality: "1080p HD",
          source: "Multi-Server",
          file: `${title} (${year || "2024"}) MovieNest`,
          audio: "English / Dual",
          hubKind: "MovieNest Player",
        });
      }

      // 8. NetNaija
      if (nnRes.status === "fulfilled" && nnRes.value?.ok && nnRes.value.embedUrl) {
        addRow({
          blog: "NetNaija HD",
          rawUrl: nnRes.value.embedUrl,
          quality: "1080p WEB-DL",
          source: "High Speed DDL",
          file: `${title} (${year || "2024"}) NetNaija`,
          audio: "English / Subbed",
          hubKind: "NetNaija Direct",
        });
      }

      // Probe and verify direct streams in parallel with short timeout
      const verifiedRows = await Promise.all(
        rows.map(async (row) => {
          const url = row.hub;
          if (/^https?:\/\//i.test(url) && (row.hubKind.includes("Direct") || row.hubKind.includes("Cloud") || row.hubKind.includes("CDN") || url.includes(".m3u8") || url.includes(".mp4"))) {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 1800);
              const resp = await fetch(url, {
                method: "HEAD",
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                signal: controller.signal,
              }).catch(() => null);
              clearTimeout(timeout);

              if (resp) {
                if (resp.status >= 400 && resp.status !== 405) {
                  return null;
                }
                const cl = resp.headers.get("content-length");
                if (cl) {
                  const b = parseInt(cl, 10);
                  if (b > 100000) {
                    row.size = extractSize(b, "", row.quality);
                  }
                }
              }
            } catch {
              // Keep if probe times out
            }
          }
          return row;
        })
      );

      const finalRows = verifiedRows.filter(Boolean) as any[];

      // Prioritize high speed direct cloud / R2 / HLS links at the top
      finalRows.sort((a, b) => {
        const priority = (kind: string) => {
          if (kind.includes("R2 Cloud")) return 1;
          if (kind.includes("Google Drive")) return 2;
          if (kind.includes("Pixeldrain")) return 3;
          if (kind.includes("CDN") || kind.includes("HLS")) return 4;
          return 5;
        };
        return priority(a.hubKind) - priority(b.hubKind);
      });

      res.json({ rows: finalRows });
    } catch (e: any) {
      res.json({ rows: [], error: e?.message });
    }
  });

  // In-memory server-side cache for TMDB API calls
  const tmdbResponseCache = new Map<string, { body: string; status: number; timestamp: number }>();
  const TMDB_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  // TMDB proxy
  app.use("/api/tmdb", async (req, res) => {
    try {
      const subpath = req.url.replace(/^\//, "");
      const cacheKey = subpath;
      const cached = tmdbResponseCache.get(cacheKey);
      const now = Date.now();

      if (cached && (now - cached.timestamp < TMDB_CACHE_TTL_MS)) {
        res.status(cached.status);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400");
        res.setHeader("X-Cache", "HIT");
        return res.send(cached.body);
      }

      const apiKey = process.env.TMDB_API_KEY || "f8243ad5d5cd1ef0ebe5d6c5bfcc59f2";
      const targetUrl = new URL(`https://api.themoviedb.org/3/${subpath}`);
      if (!targetUrl.searchParams.has("api_key")) {
        targetUrl.searchParams.set("api_key", apiKey);
      }
      const upstream = await fetch(targetUrl.toString(), {
        headers: { Accept: "application/json" },
      });
      const text = await upstream.text();
      if (upstream.ok && text) {
        tmdbResponseCache.set(cacheKey, { body: text, status: upstream.status, timestamp: now });
        if (tmdbResponseCache.size > 1000) {
          const oldestKey = tmdbResponseCache.keys().next().value;
          if (oldestKey) tmdbResponseCache.delete(oldestKey);
        }
      }

      res.status(upstream.status);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400");
      res.setHeader("X-Cache", "MISS");
      res.send(text);
    } catch (err: any) {
      res.status(502).json({ error: err?.message || "TMDB proxy error" });
    }
  });

  // TMDB Image Caching Proxy (solves ISP blocks / iframe referrer policy issues)
  app.get("/api/tmdb-image/:size/*", async (req, res) => {
    try {
      const size = req.params.size || "w500";
      const imgPath = req.params[0] || "";
      if (!imgPath) return res.status(400).send("Missing image path");
      const targetUrl = `https://image.tmdb.org/t/p/${size}/${imgPath}`;
      const upstream = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send("Upstream error");
      }
      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (err: any) {
      res.status(502).send("Image proxy error");
    }
  });

  // Vite middleware for dev / static for prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Auto-spawn fmhywebstremio background process on port 31546
  try {
    const { spawn } = await import("child_process");
    const fmhyProc = spawn("node", ["dist/index.js"], {
      cwd: path.join(process.cwd(), "fmhywebstremio_repo"),
      env: { ...process.env, PORT: "31546" },
      stdio: "ignore",
    });
    fmhyProc.unref();
    console.log("Spawned fmhywebstremio addon on port 31546");
  } catch (e) {
    console.warn("Could not spawn fmhywebstremio addon:", e);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
