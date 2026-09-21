import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
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

  // YoMovies / SpeedoStream dynamic embed handler
  app.get("/api/yomovies/embed", async (req, res) => {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();
      const season = Math.max(1, parseInt(String(req.query.s || req.query.season || "1"), 10));
      const episode = Math.max(1, parseInt(String(req.query.e || req.query.episode || "1"), 10));

      if (!id) {
        return res.status(400).send("Missing content ID");
      }

      const resolved = await resolveYoMoviesStream(type, id, season, episode);

      if (resolved.ok) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");

        // Primary: Artplayer + HLS.js custom player with Quality Selector if direct M3U8 was resolved
        if (resolved.m3u8Url) {
          const proxiedM3u8 = `/api/yomovies/proxy?url=${encodeURIComponent(resolved.m3u8Url)}`;
          return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${resolved.title || "SpeedoStream Player"}</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/artplayer@5.1.7/dist/artplayer.js"></script>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
    }
    .artplayer-app {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div class="artplayer-app"></div>
  <script>
    var videoSrc = "${proxiedM3u8}";
    var posterUrl = "${resolved.posterUrl ? `/api/yomovies/proxy?url=${encodeURIComponent(resolved.posterUrl)}` : ""}";

    var art = new Artplayer({
      container: '.artplayer-app',
      url: videoSrc,
      poster: posterUrl,
      type: 'm3u8',
      customType: {
        m3u8: function (video, url, art) {
          if (Hls.isSupported()) {
            if (art.hls) art.hls.destroy();
            var hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              maxBufferLength: 30,
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            art.hls = hls;

            function switchQuality(item) {
              if (art.hls) {
                var val = typeof item.value === 'number' ? item.value : parseInt(item.value, 10);
                if (isNaN(val)) val = -1;
                art.hls.currentLevel = val;
                art.hls.nextLevel = val;
                art.hls.loadLevel = val;
                var clean = (item.html || '').replace(/<[^>]*>/g, '');
                art.notice.show = 'Quality: ' + clean;
                try {
                  art.setting.update({
                    html: 'Quality',
                    tooltip: clean,
                  });
                } catch(e) {}
              }
            }

            art.on('quality', function (item) {
              switchQuality(item);
            });

            hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
              var levels = hls.levels || [];
              if (levels.length > 0) {
                var qualityOptions = [{
                  default: true,
                  html: 'Auto',
                  value: -1,
                }];

                levels.forEach(function (level, index) {
                  var height = level.height || (level.attrs && level.attrs.RESOLUTION ? level.attrs.RESOLUTION.split('x')[1] : null);
                  var label = height ? (height + 'p') : ('Quality ' + (index + 1));
                  qualityOptions.push({
                    default: false,
                    html: label,
                    value: index,
                  });
                });

                var autoOpt = qualityOptions.shift();
                var seen = {};
                var filtered = [];
                qualityOptions.forEach(function(opt) {
                  if (!seen[opt.html]) {
                    seen[opt.html] = true;
                    filtered.push(opt);
                  }
                });
                filtered.sort(function(a, b) {
                  return (parseInt(b.html) || 0) - (parseInt(a.html) || 0);
                });
                filtered.unshift(autoOpt);

                art.quality = filtered;

                art.setting.add({
                  html: 'Quality',
                  tooltip: 'Auto',
                  selector: filtered,
                  onSelect: function (item) {
                    switchQuality(item);
                    return item.html;
                  },
                });
              }
            });

            art.on('destroy', function () {
              hls.destroy();
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
          } else {
            art.notice.show = 'm3u8 playback not supported';
          }
        },
      },
      autoplay: true,
      autoMini: true,
      setting: true,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      autoPlayback: true,
      airplay: true,
      theme: '#e50914',
      icons: {
        state: '<svg width="60" height="60" viewBox="0 0 24 24"><path fill="#ffffff" d="M8 5v14l11-7z"/></svg>',
      },
      moreVideoAttr: {
        crossOrigin: 'anonymous',
        'playsinline': 'true',
        'webkit-playsinline': 'true',
      },
    });

    art.on('ready', function() {
      art.play().catch(function() {});
    });

    art.on('video:timeupdate', function () {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'timeupdate',
          currentTime: art.currentTime,
          duration: art.duration,
        }, '*');
      }
    });

    art.on('video:ended', function () {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'ended',
          currentTime: art.currentTime,
          duration: art.duration,
        }, '*');
      }
    });
  </script>
</body>
</html>`);
        }

        // Secondary: Proxy SpeedoStream player page directly with base tag and no-referrer header
        if (resolved.embedUrl) {
          try {
            const proxyRes = await fetch(resolved.embedUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                Referer: "https://yomovies.church/",
              },
            });
            if (proxyRes.ok) {
              let html = await proxyRes.text();
              html = html.replace(
                /<head>/i,
                `<head><base href="https://speedostream1.com/"><meta name="referrer" content="no-referrer">`
              );
              return res.send(html);
            }
          } catch {
            // Fallback to iframe if proxy fails
          }

          return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>${resolved.title || "SpeedoStream Player"}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <iframe
    src="${resolved.embedUrl}"
    allowfullscreen
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write; web-share"
    referrerpolicy="no-referrer"
  ></iframe>
</body>
</html>`);
        }
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SpeedoStream — Not Available</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #0b0d14; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; text-align: center; }
    .box { max-width: 420px; padding: 2rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 1rem; }
    h2 { margin: 0 0 0.5rem 0; color: #f87171; font-size: 1.25rem; }
    p { color: #9ca3af; font-size: 0.875rem; line-height: 1.4; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Stream Not Found on SpeedoStream</h2>
    <p>${resolved.error || "No active stream available for this title on YoMovies."} Please try switching to another server above.</p>
  </div>
</body>
</html>`);
    } catch (err: any) {
      res.status(500).send("Player resolution failed: " + err?.message);
    }
  });

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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    /* Responsive aspect-ratio cropping container */
    .viewport-container {
      position: relative;
      width: 100%;
      max-width: 960px; /* Force mobile/tablet wrapping on desktop to hide sidebars */
      height: 0;
      padding-bottom: 56.25%; /* 16:9 aspect ratio of player */
      overflow: hidden;
      background: #000;
      border-radius: 8px;
    }

    iframe {
      position: absolute;
      left: 0;
      width: 100%;
      border: 0;
      pointer-events: auto;
    }

    /* Target headers and breadcrumbs shifting based on layout screens */
    @media (max-width: 768px) {
      iframe {
        top: -100px;
        height: calc(100% + 150px);
      }
    }
    @media (min-width: 769px) {
      iframe {
        top: -125px;
        height: calc(100% + 180px);
      }
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
      server: { middlewareMode: true },
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
