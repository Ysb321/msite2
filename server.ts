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
import { resolveNetNaijaStream, getAuthToken } from "./src/lib/netnaija";
import { resolveVegaProvidersEngine, bypassVegaLink } from "./src/lib/vegaproviders";

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

  // AoneRoom / NetNaija Universal API & Asset Proxy
  app.all("/api/proxy/aoneroom", async (req, res) => {
    try {
      let targetUrl = String(req.query.url || "").trim();
      if (!targetUrl) {
        return res.status(400).send("Missing target URL");
      }
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        if (targetUrl.startsWith("/")) {
          targetUrl = "https://h5-api.aoneroom.com" + targetUrl;
        } else {
          targetUrl = "https://h5-api.aoneroom.com/" + targetUrl;
        }
      }

      const token = await getAuthToken();
      const method = req.method;
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://netnaija.film",
        "Referer": "https://netnaija.film/",
        "X-Client-Info": JSON.stringify({ timezone: "Africa/Lagos" }),
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      if (req.headers["content-type"]) {
        headers["Content-Type"] = String(req.headers["content-type"]);
      }

      const fetchOptions: any = {
        method,
        headers,
        signal: AbortSignal.timeout(10000),
      };

      if (method !== "GET" && method !== "HEAD") {
        if (typeof req.body === "object" && req.body !== null) {
          fetchOptions.body = JSON.stringify(req.body);
          headers["Content-Type"] = "application/json";
        } else if (req.body) {
          fetchOptions.body = req.body;
        }
      }

      const upstreamRes = await fetch(targetUrl, fetchOptions);
      res.status(upstreamRes.status);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "*");

      const contentType = upstreamRes.headers.get("content-type");
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }

      if (contentType && (contentType.includes("json") || contentType.includes("text"))) {
        const text = await upstreamRes.text();
        return res.send(text);
      } else {
        const arrayBuffer = await upstreamRes.arrayBuffer();
        return res.send(Buffer.from(arrayBuffer));
      }
    } catch (err: any) {
      return res.status(500).json({ code: 500, message: "Aoneroom proxy error: " + err?.message });
    }
  });

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

  app.all(["/api/yomovies/proxy", "/api/yomovies/proxy/*"], async (req, res) => {
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

      // If playlist (.m3u8), rewrite URIs to route through this proxy with .m3u8 / .ts extensions
      if (
        contentType.includes("mpegurl") ||
        contentType.includes("m3u8") ||
        targetUrl.includes(".m3u8")
      ) {
        const text = await upstreamRes.text();

        const lines = text.split(/\r?\n/);
        const rewritten = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return "";

          if (trimmed.startsWith("#")) {
            if (trimmed.includes("URI=")) {
              return trimmed.replace(/URI=["']([^"']+)["']/g, (_, p1) => {
                const absUrl = new URL(p1, targetUrl).href;
                return `URI="/api/yomovies/proxy/key.key?url=${encodeURIComponent(absUrl)}"`;
              });
            }
            return trimmed;
          }

          const absUrl = new URL(trimmed, targetUrl).href;
          const isSubPlaylist = absUrl.includes(".m3u8");
          const proxyPath = isSubPlaylist ? "/api/yomovies/proxy/stream.m3u8" : "/api/yomovies/proxy/segment.ts";
          return `${proxyPath}?url=${encodeURIComponent(absUrl)}`;
        });

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
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
      
      let upstreamReferer = targetUrl;
      if (
        targetUrl.includes("speedostream") ||
        targetUrl.includes("netu") ||
        targetUrl.includes("allmovieland") ||
        targetUrl.includes("mishai") ||
        targetUrl.includes("ydc1wes") ||
        targetUrl.includes("yomovies")
      ) {
        upstreamReferer = "https://yomovies.church/";
      } else if (targetUrl.includes("prmovies")) {
        upstreamReferer = "https://prmovies.site/";
      } else if (targetUrl.includes("netnaija")) {
        upstreamReferer = "https://netnaija.film/";
      }

      let upstreamRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": UA,
          "Referer": upstreamReferer,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);

      if (!upstreamRes || !upstreamRes.ok || upstreamRes.status === 403) {
        if (targetUrl.includes("yomovies.")) {
          const mirrors = ["yomovies.church", "yomovies.mx"];
          for (const mirror of mirrors) {
            const fallbackUrl = targetUrl.replace(/yomovies\.[a-z]+/i, mirror);
            if (fallbackUrl === targetUrl) continue;
            const fbRes = await fetch(fallbackUrl, {
              headers: {
                "User-Agent": UA,
                "Referer": upstreamReferer,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
              signal: AbortSignal.timeout(6000),
            }).catch(() => null);
            if (fbRes && fbRes.ok) {
              upstreamRes = fbRes;
              break;
            }
          }
        } else if (targetUrl.includes("prmovies.")) {
          const mirrors = ["prmovies.site", "prmovies.top", "prmovies.church", "prmovies.energy"];
          for (const mirror of mirrors) {
            const fallbackUrl = targetUrl.replace(/prmovies\.[a-z]+/i, mirror);
            if (fallbackUrl === targetUrl) continue;
            const fbRes = await fetch(fallbackUrl, {
              headers: {
                "User-Agent": UA,
                "Referer": upstreamReferer,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
              signal: AbortSignal.timeout(6000),
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
      const finalOrigin = new URL(finalUrl).origin;

      // If this is speedostream player, proxy its m3u8 stream, set HLS type, autostart, and strip ad networks
      if (finalUrl.includes("speedostream")) {
        html = html.replace(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi, (match, u) => {
          return `file: "/api/yomovies/proxy/master.m3u8?url=" + encodeURIComponent(${JSON.stringify(u)}), type: "hls"`;
        });
        // Enable autostart and disable advertising block
        html = html.replace(/preload:\s*['"]auto['"],?/gi, `preload: 'auto', autostart: true,`);
        html = html.replace(/["']?advertising["']?\s*:\s*\{[\s\S]*?\},/gi, "");
        html = html.replace(/jwplayer\(\)\.playAd\([^)]*\);?/gi, "");
      }

      // Replace prmovies.com references in html with requested domain
      try {
        const requestedHost = new URL(targetUrl).hostname;
        html = html.replace(/prmovies\.com/gi, requestedHost);
      } catch {}

      // Strip X-Frame-Options and Content-Security-Policy meta tags
      html = html.replace(/<meta\s+http-equiv=["']?(X-Frame-Options|Content-Security-Policy)["']?\s+content=["'][^"']+["']\s*\/?>/gi, "");

      // Ensure no-referrer meta is set for images and posters
      if (!html.includes('name="referrer"')) {
        html = html.replace(/<head>/i, `<head><meta name="referrer" content="no-referrer">`);
      }

      // Neutralize frame-busting scripts
      html = html.replace(/(top|window\.top|parent)\.location(\s*=\s*|\.href\s*=\s*|\.replace\s*\()/gi, "void(");

      // Rewrite static assets (css, js, images, fonts) to absolute URLs pointing to upstream origin
      html = html.replace(/(src|href)=["'](\/(?:_nuxt|ssrStatic|wp-content|wp-includes|images|assets|css|js|player)[^"']*)["']/gi, (match, attr, path) => {
        return `${attr}="${finalOrigin}${path}"`;
      });

      // Rewrite explicit prmovies / yomovies / speedostream links, iframes, and actions to route through this proxy
      html = html.replace(/(href|action|src|data-url|data-src|data-frame)=["']((?:https?:\/\/(?:www\.)?(?:prmovies|yomovies|speedostream|netu)\.[a-z0-9\-_.]+|\/)[^"']*)["']/gi, (match, attr, path) => {
        if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|webp)(\?.*)?$/i.test(path) || path.includes('/wp-content/') || path.includes('/wp-includes/') || path.includes('/_nuxt/')) {
          if (path.startsWith("/")) return `${attr}="${finalOrigin}${path}"`;
          return match;
        }
        if (path.startsWith("/api/")) {
          return match;
        }
        try {
          const absUrl = new URL(path, finalUrl).href;
          return `${attr}="/api/proxy/html?url=${encodeURIComponent(absUrl)}"`;
        } catch {
          return match;
        }
      });

      // Strip target="_blank" and target="_parent" so user interactions remain inside the embedded player
      html = html.replace(/\s+target=["'](?:_blank|_parent|_top)["']/gi, ' target="_self"');

      const interceptScript = `<script>
(function() {
  var CURRENT_PROXY_ORIGIN = window.location.origin;
  var UPSTREAM_PAGE_URL = ${JSON.stringify(finalUrl)};
  var UPSTREAM_ORIGIN = ${JSON.stringify(finalOrigin)};

  function toProxyUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
    var trimmed = rawUrl.trim();
    if (trimmed.startsWith("javascript:") || trimmed.startsWith("#") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return trimmed;
    }
    if (trimmed.startsWith("/api/") || trimmed.startsWith(CURRENT_PROXY_ORIGIN + "/api/")) {
      return trimmed;
    }
    try {
      var abs = new URL(trimmed, UPSTREAM_PAGE_URL).href;
      return "/api/proxy/html?url=" + encodeURIComponent(abs);
    } catch(e) {
      return trimmed;
    }
  }

  // 1. Prevent popups and external window opening - route everything inside the current player frame
  window.open = function(url) {
    if (url && typeof url === "string") {
      window.location.href = toProxyUrl(url);
    }
    return window;
  };

  // 2. Prevent frame busting / top window escaping
  try {
    Object.defineProperty(window, "top", { get: function() { return window; } });
    Object.defineProperty(window, "parent", { get: function() { return window; } });
  } catch(e) {}

  // 3. Hook window.fetch for aoneroom / netnaija API calls
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url ? input.url : "");
        if (url && (url.includes("aoneroom.com") || url.includes("/wefeed-h5api-bff/"))) {
          var absApi = new URL(url, UPSTREAM_PAGE_URL).href;
          var proxiedApi = "/api/proxy/aoneroom?url=" + encodeURIComponent(absApi);
          if (typeof input === "string") {
            input = proxiedApi;
          } else if (input && typeof Request !== "undefined" && input instanceof Request) {
            input = new Request(proxiedApi, input);
          }
        }
      } catch(e) {}
      return origFetch.call(this, input, init);
    };
  }

  // 4. Intercept AJAX requests, NEVER intercept /api/ requests
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === "string") {
      if (url.startsWith("/api/") || url.startsWith(CURRENT_PROXY_ORIGIN + "/api/")) {
        return origOpen.apply(this, arguments);
      }
      if (url.includes("aoneroom.com") || url.includes("/wefeed-h5api-bff/")) {
        var abs = new URL(url, UPSTREAM_PAGE_URL).href;
        arguments[1] = "/api/proxy/aoneroom?url=" + encodeURIComponent(abs);
      } else if (url.startsWith("/") || url.includes("yomovies") || url.includes("prmovies") || url.includes("speedostream") || url.includes("netnaija") || url.includes("newhdmovie2") || url.includes("hdmovie2")) {
        arguments[1] = toProxyUrl(url);
      }
    }
    return origOpen.apply(this, arguments);
  };

  // 5. Proactively lock all link targets to _self and fix image referrer policies
  function enforceSelfTargetAndImages() {
    var links = document.querySelectorAll("a, form");
    for (var i = 0; i < links.length; i++) {
      var el = links[i];
      if (el.getAttribute("target") !== "_self") {
        el.setAttribute("target", "_self");
      }
    }
    var imgs = document.querySelectorAll("img, div[data-src], div[data-background-image]");
    for (var j = 0; j < imgs.length; j++) {
      var img = imgs[j];
      if (img.tagName === "IMG") {
        var dataSrc = img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-lazy-src");
        var currentSrc = img.getAttribute("src") || "";
        if (dataSrc && (!currentSrc || currentSrc.startsWith("data:image/svg"))) {
          img.setAttribute("src", dataSrc);
        }
        img.setAttribute("referrerpolicy", "no-referrer");
      }
    }
  }
  window.addEventListener("DOMContentLoaded", enforceSelfTargetAndImages);
  window.addEventListener("load", enforceSelfTargetAndImages);
  setInterval(enforceSelfTargetAndImages, 300);

  // 6. Intercept all clicks on links - trap them inside the proxy player
  document.addEventListener("click", function(e) {
    var a = e.target.closest("a");
    if (a) {
      a.setAttribute("target", "_self");
      var hrefAttr = a.getAttribute("href") || "";
      if (!hrefAttr || hrefAttr.startsWith("javascript:") || hrefAttr.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.href = toProxyUrl(hrefAttr);
    }
  }, true);

  // 7. Intercept Search Input Enter key & search submission
  document.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      var input = e.target;
      if (input && (input.tagName === "INPUT" || input.getAttribute("type") === "search" || input.getAttribute("type") === "text")) {
        var val = (input.value || "").trim();
        if (val && (
          (input.placeholder && input.placeholder.toLowerCase().includes("search")) ||
          (input.name && input.name.toLowerCase().includes("search")) ||
          input.name === "s" || input.name === "q" || input.name === "keyword" ||
          (input.className && input.className.toLowerCase().includes("search"))
        )) {
          e.preventDefault();
          e.stopPropagation();
          var searchUrl;
          if (UPSTREAM_ORIGIN.includes("netnaija")) {
            searchUrl = "https://netnaija.film/search-result?keyword=" + encodeURIComponent(val);
          } else if (UPSTREAM_ORIGIN.includes("hdmovie2")) {
            searchUrl = "https://newhdmovie2.day/?s=" + encodeURIComponent(val);
          } else {
            searchUrl = UPSTREAM_ORIGIN + "/?s=" + encodeURIComponent(val);
          }
          window.location.href = toProxyUrl(searchUrl);
        }
      }
    }
  }, true);

  // 8. Intercept form submissions (e.g. search forms) - enforce inside player
  document.addEventListener("submit", function(e) {
    var form = e.target;
    if (form) {
      form.setAttribute("target", "_self");
      var act = form.getAttribute("action") || "";
      var method = (form.getAttribute("method") || "get").toLowerCase();
      if (method === "get") {
        e.preventDefault();
        e.stopPropagation();
        var formData = new FormData(form);
        var params = new URLSearchParams(formData);
        var baseAction = act ? new URL(act, UPSTREAM_PAGE_URL).href : UPSTREAM_PAGE_URL;
        var searchUrl = baseAction + (baseAction.includes("?") ? "&" : "?") + params.toString();
        window.location.href = toProxyUrl(searchUrl);
      }
    }
  }, true);

  // 9. Intercept dynamic iframes created by player tabs
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.tagName === "IFRAME") {
          var src = node.getAttribute("src");
          if (src && !src.startsWith("/api/")) {
            node.setAttribute("src", toProxyUrl(src));
          }
        }
      });
    });
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
</script>`;

      // Inject client interception script in head
      if (/<head>/i.test(html)) {
        html = html.replace(/<head>/i, `<head>${interceptScript}`);
      } else {
        html = `${interceptScript}${html}`;
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    } catch (err: any) {
      return res.status(500).send("Proxy error: " + err?.message);
    }
  });

  app.get("/api/prmovies/embed", async (req, res) => {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();
      
      const meta = id ? await getTmdbMeta(type, id) : null;
      const title = meta ? (meta.title || meta.name || "").trim() : "";
      
      const targetUrl = title 
        ? `https://prmovies.site/?s=${encodeURIComponent(title)}`
        : "https://prmovies.site/";

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PRMovies ${title ? `- ${title}` : ""}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100vw; height: 100vh; background: #000; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: 0; display: block; }
  </style>
</head>
<body>
  <iframe src="/api/proxy/html?url=${encodeURIComponent(targetUrl)}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media"></iframe>
</body>
</html>`);
    } catch (err: any) {
      return res.status(500).send("Embed error: " + err?.message);
    }
  });

  // YoMovies / SpeedoStream dynamic embed handler with direct stream resolution
  app.get("/api/yomovies/embed", async (req, res) => {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();
      const season = Math.max(1, parseInt(String(req.query.s || req.query.season || "1"), 10));
      const episode = Math.max(1, parseInt(String(req.query.e || req.query.episode || "1"), 10));

      const meta = id ? await getTmdbMeta(type, id) : null;
      const title = meta ? (meta.title || meta.name || "").trim() : "";

      // Attempt to resolve direct stream and exact post URL
      let directPostUrl: string | null = null;
      if (id) {
        try {
          const resolved = await resolveYoMoviesStream(type, id, season, episode);
          if (resolved.ok && resolved.postUrl) {
            directPostUrl = resolved.postUrl;
          }
        } catch {}
      }

      const defaultSearchUrl = title 
        ? `https://yomovies.church/?s=${encodeURIComponent(title)}`
        : "https://yomovies.church/";

      const targetUrl = directPostUrl || defaultSearchUrl;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YoMovies ${title ? `- ${title}` : ""}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100vw; height: 100vh; background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .nav-bar { display: flex; align-items: center; justify-content: space-between; height: 38px; background: #0f1015; border-bottom: 1px solid rgba(255,255,255,0.1); padding: 0 12px; font-size: 12px; color: #a1a1aa; }
    .nav-links { display: flex; align-items: center; gap: 8px; }
    .btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 6px; background: rgba(255,255,255,0.08); color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 11px; font-weight: 600; transition: background 0.2s; }
    .btn:hover { background: rgba(255,255,255,0.18); }
    .btn.active { background: #e50914; border-color: #e50914; color: #fff; }
    .frame-wrap { width: 100vw; height: calc(100vh - 38px); position: relative; }
    iframe { width: 100%; height: 100%; border: 0; display: block; }
  </style>
</head>
<body>
  <div class="nav-bar">
    <div class="nav-links">
      <span style="font-weight:700;color:#fff;">🎬 YoMovies</span>
      ${title ? `<span style="opacity:0.75;">• ${title} ${type === "tv" ? `(S${season} E${episode})` : ""}</span>` : ""}
    </div>
    <div class="nav-links">
      ${directPostUrl ? `<button class="btn active" onclick="loadUrl('${directPostUrl}')">▶ Movie / Stream Page</button>` : ""}
      <button class="btn" onclick="loadUrl('${defaultSearchUrl}')">🔍 Search Results</button>
      <button class="btn" onclick="document.getElementById('stream-frame').src = document.getElementById('stream-frame').src;">🔄 Reload</button>
    </div>
  </div>
  <div class="frame-wrap">
    <iframe id="stream-frame" src="/api/proxy/html?url=${encodeURIComponent(targetUrl)}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media"></iframe>
  </div>
  <script>
    function loadUrl(u) {
      document.getElementById('stream-frame').src = "/api/proxy/html?url=" + encodeURIComponent(u);
    }
  </script>
</body>
</html>`);
    } catch (err: any) {
      return res.status(500).send("Embed error: " + err?.message);
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

  // NetNaija dynamic embed handler - loads netnaija.film whole website inside player as it is
  app.get("/api/netnaija/embed", async (req, res) => {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();
      const season = Math.max(1, parseInt(String(req.query.s || req.query.season || "1"), 10));
      const episode = Math.max(1, parseInt(String(req.query.e || req.query.episode || "1"), 10));

      const meta = id ? await getTmdbMeta(type, id) : null;
      const title = meta ? (meta.title || meta.name || "").trim() : "";

      // Directly show the search page as per the active movie or series (e.g. /search-result?keyword=reacher)
      const targetUrl = title
        ? `https://netnaija.film/search-result?keyword=${encodeURIComponent(title)}`
        : "https://netnaija.film/";

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="referrer" content="no-referrer">
  <title>NetNaija ${title ? `- ${title}` : "Official"}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
  </style>
</head>
<body>
  <iframe 
    src="/api/proxy/html?url=${encodeURIComponent(targetUrl)}" 
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write; web-share" 
    allowfullscreen>
  </iframe>
</body>
</html>`);
    } catch (err: any) {
      return res.status(500).send("Embed error: " + err?.message);
    }
  });

  // HdMovie2 (newhdmovie2.day) dynamic embed handler - loads newhdmovie2.day whole website inside player as it is
  app.get("/api/hdmovie2/embed", async (req, res) => {
    try {
      const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
      const id = String(req.query.id || "").trim();

      const meta = id ? await getTmdbMeta(type, id) : null;
      const title = meta ? (meta.title || meta.name || "").trim() : "";

      // Directly show the search page as per the active movie or series (e.g. https://newhdmovie2.day/?s=deadpool)
      const targetUrl = title
        ? `https://newhdmovie2.day/?s=${encodeURIComponent(title)}`
        : "https://newhdmovie2.day/";

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="referrer" content="no-referrer">
  <title>HdMovie2 ${title ? `- ${title}` : "Official"}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
  </style>
</head>
<body>
  <iframe 
    src="/api/proxy/html?url=${encodeURIComponent(targetUrl)}" 
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write; web-share" 
    allowfullscreen>
  </iframe>
</body>
</html>`);
    } catch (err: any) {
      return res.status(500).send("Embed error: " + err?.message);
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

  // Server 38 - Vega Multi-Provider Engine (Zenda-Cross)
  const vegaprovidersCache = new Map<string, { expiresAt: number; data: any }>();

  app.get("/api/vegaproviders/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const season = Math.max(1, parseInt(String(req.query.s || "1"), 10) || 1);
      const episode = Math.max(1, parseInt(String(req.query.e || "1"), 10) || 1);
      const cleanKind = kind === "movie" ? "movie" : "series";

      const cacheKey = `vp:${cleanKind}:${id}:${title.toLowerCase()}:${season}:${episode}`;
      const now = Date.now();

      const cached = vegaprovidersCache.get(cacheKey);
      if (cached && cached.expiresAt > now && cached.data.rows?.length > 0) {
        return res.json(cached.data);
      }

      const opts = { title, year, kind: cleanKind, season, episode, id };
      console.log(`[VEGA ENDPOINT] Request received: ${cleanKind} ${id} "${title}" (${year})`);
      const result = await resolveVegaProvidersEngine(opts);
      console.log(`[VEGA ENDPOINT] Result: ${result?.rows?.length} rows, providers: ${result?.diag?.providersUsed?.join(", ")}`);

      if (result && result.rows?.length > 0) {
        vegaprovidersCache.set(cacheKey, { expiresAt: now + 15 * 60 * 1000, data: result });
      }

      return res.json(result);
    } catch (err: any) {
      res.json({ rows: [], streams: [], laneError: "Vega Providers error", diag: err?.message });
    }
  });

  app.post("/api/vegaproviders/bypass", async (req, res) => {
    try {
      const { url, provider, season, episode } = req.body || {};
      if (!url) return res.status(400).json({ error: "Missing url to bypass", directLinks: [] });
      const sNum = Math.max(1, parseInt(String(season || "1"), 10) || 1);
      const eNum = Math.max(1, parseInt(String(episode || "1"), 10) || 1);
      const directLinks = await bypassVegaLink(
        String(url),
        provider ? String(provider) : undefined,
        sNum,
        eNum
      );
      return res.json({ directLinks });
    } catch (err: any) {
      return res.json({ directLinks: [], error: err?.message });
    }
  });

  app.get("/api/vegaproviders/bypass", async (req, res) => {
    try {
      const url = String(req.query.url || "");
      const provider = req.query.provider ? String(req.query.provider) : undefined;
      const sNum = Math.max(1, parseInt(String(req.query.s || "1"), 10) || 1);
      const eNum = Math.max(1, parseInt(String(req.query.e || "1"), 10) || 1);
      if (!url) return res.status(400).json({ error: "Missing url to bypass", directLinks: [] });
      const directLinks = await bypassVegaLink(url, provider, sNum, eNum);
      return res.json({ directLinks });
    } catch (err: any) {
      return res.json({ directLinks: [], error: err?.message });
    }
  });

  // Server 24 - HDHub Stream endpoint
  app.get("/api/hdhub/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const parts = decodeURIComponent(id || "").split(":").filter(Boolean);
      const season = Math.max(1, parseInt(parts[1], 10) || parseInt(String(req.query.s || "1"), 10) || 1);
      const episode = Math.max(1, parseInt(parts[2], 10) || parseInt(String(req.query.e || "1"), 10) || 1);
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const result = await resolveVegaProvidersEngine({
        title,
        year,
        kind: kind === "movie" ? "movie" : "series",
        season,
        episode,
        id: parts[0],
      });
      const hdhubOnly = (result.rows || []).filter(
        (r) => r.provider === "HdHub4u" || r.blog === "HdHub4u" || (r.name && r.name.includes("HdHub4u"))
      );
      return res.json({ streams: hdhubOnly.length > 0 ? hdhubOnly : result.rows });
    } catch (err: any) {
      return res.json({ streams: [], laneError: "HDHub error", diag: err?.message });
    }
  });

  // In-memory cache for Server 11 (DesiDDL) stream results to deliver sub-10ms responses
  const desiddlCache = new Map<string, { expiresAt: number; data: any }>();

  app.get("/api/desiddl/stream/:kind/:id", async (req, res) => {
    try {
      const { kind, id } = req.params;
      const title = String(req.query.title || "").trim();
      const year = String(req.query.year || "").slice(0, 4);
      const season = Math.max(1, parseInt(String(req.query.s || "1"), 10) || 1);
      const episode = Math.max(1, parseInt(String(req.query.e || "1"), 10) || 1);
      const cleanKind = kind === "movie" ? "movie" : "series";

      const cacheKey = `${cleanKind}:${id}:${title.toLowerCase()}:${season}:${episode}`;
      const now = Date.now();

      // Return instant cached result if available
      const cached = desiddlCache.get(cacheKey);
      if (cached && cached.expiresAt > now && cached.data.rows?.length > 0) {
        return res.json(cached.data);
      }

      const opts = { title, year, kind: cleanKind, season, episode };

      // Timeout wrapper with 7.5s cap per provider so all providers get sufficient time to resolve links
      function runFast<T>(promise: Promise<T>, timeoutMs = 7500, fallback: T = null as T): Promise<T> {
        return new Promise((resolve) => {
          let done = false;
          const timer = setTimeout(() => {
            if (!done) { done = true; resolve(fallback); }
          }, timeoutMs);
          promise
            .then((res) => { if (!done) { done = true; clearTimeout(timer); resolve(res); } })
            .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } });
        });
      }

      // Query all sources simultaneously with 7.5s timeout cap
      const [mmRes, hmRes, hcRes, nvRes, csRes, ymRes, mnRes, nnRes] = await Promise.allSettled([
        runFast(resolveMoviesMod(opts), 7500),
        runFast(resolveHindMovie(opts), 7500),
        runFast(resolveHiCine(opts), 7500),
        runFast(resolveNuvio({ ...opts, tmdbId: id }), 7500),
        runFast(resolveCastle(opts), 7500),
        runFast(resolveYoMoviesStream(cleanKind === "movie" ? "movie" : "tv", id, season, episode), 7500),
        runFast(resolveMovieNestStream(cleanKind === "movie" ? "movie" : "tv", id, season, episode), 7500),
        runFast(resolveNetNaijaStream(cleanKind === "movie" ? "movie" : "tv", id, season, episode), 7500),
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

      // Fast non-blocking verification for untrusted direct streams (800ms cap)
      const verifiedRows = await Promise.all(
        rows.map(async (row) => {
          const url = row.hub;
          // Skip probes for known high-speed CDNs to save time
          if (/r2\.dev|busycdn|aoneroom|yomovies|prmovies|castle|googleusercontent|pixeldrain/i.test(url)) {
            return row;
          }
          if (/^https?:\/\//i.test(url) && (row.hubKind.includes("Direct") || row.hubKind.includes("Cloud") || url.includes(".m3u8") || url.includes(".mp4"))) {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 800);
              const resp = await fetch(url, {
                method: "HEAD",
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                signal: controller.signal,
              }).catch(() => null);
              clearTimeout(timeout);

              if (resp && resp.status >= 400 && resp.status !== 405) {
                return null;
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

      const responseObj = { rows: finalRows };

      // Cache valid results for 20 minutes
      if (finalRows.length > 0) {
        desiddlCache.set(cacheKey, {
          expiresAt: Date.now() + 20 * 60 * 1000,
          data: responseObj,
        });
      }

      res.json(responseObj);
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
