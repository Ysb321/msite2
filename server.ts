import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { handleM2BoxStream, handleM2BoxProxy } from "./src/server/m2box";
import { resolveCastle } from "./src/lib/castle";
import { resolveMoviesMod } from "./src/lib/moviesmod";
import { resolveNuvio } from "./src/lib/nuvio";
import { resolveLicensedAnime } from "./src/lib/licensedanime";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Server 26 - M2Box
  app.get("/api/m2box/stream/:kind/:id", handleM2BoxStream);
  app.get("/api/m2box/proxy", handleM2BoxProxy);
  app.get("/api/m2box/proxy/stream.mp4", handleM2BoxProxy);

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
