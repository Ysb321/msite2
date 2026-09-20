const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type HiCineStream = {
  name: string;
  description: string;
  url: string;
  quality?: string;
  size?: string;
};

export type HiCineResult = {
  streams: HiCineStream[];
  captions: { lang: string; name: string; url: string }[];
  laneError?: string;
  diag?: string;
};

type TokenData = {
  ts: string;
  sig: string;
};

type WorkerLinkResponse = {
  title?: string;
  size?: string;
  watchable?: boolean;
  tokens?: Record<string, TokenData>;
};

export async function resolveHiCine(opts: {
  title: string;
  year?: string;
  tmdbId?: string;
  kind?: string;
  season?: number;
  episode?: number;
  directUrl?: string;
}): Promise<HiCineResult> {
  const { title, year, kind = "movie", season = 1, episode = 1 } = opts;
  const streams: HiCineStream[] = [];

  if (!title) {
    return { streams: [], captions: [], laneError: "Title is required for HiCine search" };
  }

  try {
    const cleanSearchTitle = title.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
    const searchUrl = `https://api.hicine.sbs/api/search/${encodeURIComponent(cleanSearchTitle)}`;

    const sRes = await fetch(searchUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });

    if (!sRes.ok) {
      return { streams: [], captions: [], laneError: `HiCine API HTTP ${sRes.status}` };
    }

    const items = await sRes.json();
    if (!Array.isArray(items) || items.length === 0) {
      return { streams: [], captions: [], laneError: "No match on HiCine" };
    }

    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
    const searchWords = cleanTitle.split(" ").filter((w) => w.length > 2);

    let bestMatch: any = null;

    for (const item of items) {
      const itemTitle = (item.title || "").toLowerCase();
      const matchesTitle =
        itemTitle.includes(cleanTitle) ||
        (searchWords.length > 0 && searchWords.every((w) => itemTitle.includes(w)));

      const matchesYear = !year || itemTitle.includes(year) || (item.categories || "").includes(year);

      if (matchesTitle && matchesYear) {
        bestMatch = item;
        break;
      }
      if (!bestMatch && matchesTitle) {
        bestMatch = item;
      }
    }

    if (!bestMatch) {
      bestMatch = items[0];
    }

    type WorkerTarget = {
      workerOrigin: string;
      vcloudParam: string;
      quality: string;
      size: string;
      label: string;
    };

    const workerTargets: WorkerTarget[] = [];

    if (kind === "series" || (season && episode && kind !== "movie")) {
      const seasonKey = `season_${season}`;
      const seasonText = bestMatch[seasonKey] || bestMatch.season_zip || bestMatch.links || "";
      const lines = seasonText.split("\n");

      const epRegex = new RegExp(`(?:Episode|Ep|E)\\s*${episode}\\b`, "i");

      for (const line of lines) {
        if (!line || (lines.length > 1 && !epRegex.test(line) && seasonText.includes("Episode"))) {
          continue;
        }

        const matches = [...line.matchAll(/(https:\/\/[^/]+\.workers\.dev)\/\?vcloud=([^,\s]+)/gi)];
        for (const m of matches) {
          const workerOrigin = m[1];
          const vcloudParam = m[2];

          let quality = "720p";
          if (/2160p|4k/i.test(line)) quality = "4K";
          else if (/1080p/i.test(line)) quality = "1080p";
          else if (/720p/i.test(line)) quality = "720p";
          else if (/480p/i.test(line)) quality = "480p";

          let size = "";
          const szMatch = line.match(/(\d+(?:\.\d+)?\s*(?:MB|GB))/i);
          if (szMatch) size = szMatch[1];

          workerTargets.push({
            workerOrigin,
            vcloudParam,
            quality,
            size,
            label: `S${season}E${episode}`,
          });
        }
      }
    } else {
      const rawLinks = bestMatch.links || "";
      const lines = rawLinks.split("\n");

      for (const line of lines) {
        if (!line) continue;
        const matches = [...line.matchAll(/(https:\/\/[^/]+\.workers\.dev)\/\?vcloud=([^,\s]+)/gi)];

        for (const m of matches) {
          const workerOrigin = m[1];
          const vcloudParam = m[2];

          let quality = "1080p";
          if (/2160p|4k/i.test(line)) quality = "4K";
          else if (/1080p/i.test(line)) quality = "1080p";
          else if (/720p/i.test(line)) quality = "720p";
          else if (/480p/i.test(line)) quality = "480p";

          let size = "";
          const szMatch = line.match(/(\d+(?:\.\d+)?\s*(?:MB|GB))/i);
          if (szMatch) size = szMatch[1];

          workerTargets.push({
            workerOrigin,
            vcloudParam,
            quality,
            size,
            label: quality,
          });
        }
      }
    }

    const limitedTargets = workerTargets.slice(0, 8);

    await Promise.all(
      limitedTargets.map(async (target) => {
        try {
          const apiUrl = `${target.workerOrigin}/api/links?vcloud=${encodeURIComponent(target.vcloudParam)}`;
          const linkRes = await fetch(apiUrl, {
            headers: { "User-Agent": UA },
            signal: AbortSignal.timeout(6000),
          });

          if (!linkRes.ok) return;
          const linkData: WorkerLinkResponse = await linkRes.json();
          const tokens = linkData.tokens;
          if (!tokens) return;

          const sizeStr = linkData.size || target.size || "";

          const tokenPriority = [
            { key: "fsl2", name: "FSLv2 Fast" },
            { key: "fsl", name: "FSL Direct" },
            { key: "pixel", name: "PixelServer" },
            { key: "ten", name: "10Gbps CDN" },
            { key: "server1", name: "Server 1" },
            { key: "gofile", name: "GoFile" },
          ];

          for (const tp of tokenPriority) {
            const tok = tokens[tp.key];
            if (tok && tok.ts && tok.sig) {
              const goUrl = `${target.workerOrigin}/go?type=${tp.key}&vcloud=${encodeURIComponent(target.vcloudParam)}&ts=${tok.ts}&sig=${tok.sig}`;
              let streamUrl = goUrl;

              try {
                const redirRes = await fetch(goUrl, {
                  headers: { "User-Agent": UA },
                  redirect: "manual",
                  signal: AbortSignal.timeout(3500),
                });
                const loc = redirRes.headers.get("location");
                if (loc && loc.startsWith("http")) {
                  streamUrl = loc;
                }
              } catch {}

              streams.push({
                name: `HiCine ${target.quality} ${tp.name} 🇮🇳 Hindi`,
                description: `[${tp.name} High-Speed Direct] ${sizeStr ? "💾 " + sizeStr + " " : ""}${target.quality} · 🇮🇳 Hindi · English · HiCine`,
                url: streamUrl,
                quality: target.quality,
                size: sizeStr,
              });
            }
          }
        } catch {}
      })
    );

    streams.sort((a, b) => {
      const qA = parseInt(a.quality?.match(/\d+/)?.[0] || "1080", 10);
      const qB = parseInt(b.quality?.match(/\d+/)?.[0] || "1080", 10);
      if (qA !== qB) return qB - qA;

      const priority = (name: string) => {
        if (name.includes("FSLv2")) return 0;
        if (name.includes("FSL Direct")) return 1;
        if (name.includes("PixelServer")) return 2;
        if (name.includes("10Gbps")) return 3;
        return 4;
      };

      return priority(a.name) - priority(b.name);
    });

    return { streams, captions: [] };
  } catch (e: any) {
    return { streams: [], captions: [], laneError: e?.message || "HiCine error" };
  }
}
