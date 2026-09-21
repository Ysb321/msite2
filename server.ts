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

  // TMDB proxy
  app.use("/api/tmdb", async (req, res) => {
    try {
      const subpath = req.url.replace(/^\//, "");
      const apiKey = process.env.TMDB_API_KEY || "f8243ad5d5cd1ef0ebe5d6c5bfcc59f2";
      const targetUrl = new URL(`https://api.themoviedb.org/3/${subpath}`);
      if (!targetUrl.searchParams.has("api_key")) {
        targetUrl.searchParams.set("api_key", apiKey);
      }
      const upstream = await fetch(targetUrl.toString(), {
        headers: { Accept: "application/json" },
      });
      res.status(upstream.status);
      const text = await upstream.text();
      res.setHeader("Content-Type", "application/json");
      res.send(text);
    } catch (err: any) {
      res.status(502).json({ error: err?.message || "TMDB proxy error" });
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
