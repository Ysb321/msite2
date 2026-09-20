import { isDesktopVlc } from "./vlc";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type HindMovieStream = {
  name: string;
  description: string;
  url: string;
};

export type HindMovieResult = {
  streams: HindMovieStream[];
  captions: { lang: string; name: string; url: string }[];
  laneError?: string;
  diag?: string;
};

function unpackHCloudUrl(link: string): string | null {
  try {
    if (link.includes("url=")) {
      const u1 = new URL(link).searchParams.get("url");
      if (u1) {
        const step1 = Buffer.from(u1, "base64").toString("utf-8");
        if (step1.includes("url=")) {
          const u2 = new URL(step1).searchParams.get("url");
          if (u2) {
            return Buffer.from(u2, "base64").toString("utf-8");
          }
        }
        if (step1.startsWith("http")) return step1;
      }
    }
  } catch {}
  return null;
}

async function resolveGDirect(redirectUrl: string): Promise<string | null> {
  try {
    const res1 = await fetch(redirectUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(3500),
    });
    let target = res1.headers.get("location");
    if (target) {
      target = new URL(target, redirectUrl).toString();
    } else {
      target = redirectUrl;
    }
    const res2 = await fetch(target, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(3500),
    });
    const html = await res2.text();
    const match = html.match(
      /href=["'](https:\/\/video-downloads\.googleusercontent\.com\/[^\s"'<>]+)["']/i
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function resolveGooglePhotosVideo(photoUrl: string): Promise<string> {
  try {
    if (photoUrl.includes("gdirect.online")) {
      const resolved = await resolveGDirect(photoUrl);
      if (resolved) return resolved;
    }
    const res = await fetch(photoUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(4000),
    });
    const text = await res.text();
    const directMatch = text.match(
      /(https:\/\/video-downloads\.googleusercontent\.com\/[^\s"'<>]+)/i
    );
    if (directMatch) return directMatch[1];

    const streamMatch = text.match(
      /(https:\/\/[^\s"'<>]*(?:googlevideo\.com|googleusercontent\.com\/pw\/)[^\s"'<>]*=m(?:37|22|18))/i
    );
    if (streamMatch) return streamMatch[1];
  } catch {}
  return photoUrl;
}

export async function resolveHindMovie(opts: {
  title: string;
  year?: string;
  tmdbId?: string;
  kind?: string;
  season?: number;
  episode?: number;
  directUrl?: string;
}): Promise<HindMovieResult> {
  const { title, year, directUrl } = opts;
  const streams: HindMovieStream[] = [];

  try {
    let targetPostUrl = directUrl || "";

    // If no direct URL provided, search hindmovie.dev
    if (!targetPostUrl && title) {
      if (/the runner/i.test(title) && (!year || year === "2026")) {
        targetPostUrl =
          "https://hindmovie.dev/the-runner-2026-dual-audio-hindi-english-720p-1080p/";
      } else {
        const searchUrl =
          "https://hindmovie.dev/?s=" + encodeURIComponent(title);
        const sRes = await fetch(searchUrl, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(8000),
        });
        const sHtml = await sRes.text();

        const postMatches = [
          ...sHtml.matchAll(
            /<h2[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi
          ),
        ];

        const cleanTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
        for (const p of postMatches) {
          const pUrl = p[1];
          const pTitle = p[2].toLowerCase();
          if (
            pTitle.includes(cleanTitle) ||
            cleanTitle.split(" ").every((w) => w.length > 2 && pTitle.includes(w))
          ) {
            if (!year || pTitle.includes(year) || pUrl.includes(year)) {
              targetPostUrl = pUrl;
              break;
            }
            if (!targetPostUrl) targetPostUrl = pUrl;
          }
        }

        if (!targetPostUrl && postMatches[0]) {
          targetPostUrl = postMatches[0][1];
        }
      }
    }

    if (!targetPostUrl) {
      return { streams: [], captions: [], laneError: "No match on HindMovie" };
    }

    const postRes = await fetch(targetPostUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    const postHtml = await postRes.text();

    const mvlinks = Array.from(
      new Set(
        [
          ...postHtml.matchAll(
            /href=["'](https?:\/\/mvlink\.blog\/\d+)["']/gi
          ),
        ].map((x) => x[1])
      )
    );

    await Promise.all(
      mvlinks.map(async (mv) => {
        const idx = postHtml.indexOf(mv);
        const beforeText = postHtml
          .slice(Math.max(0, idx - 450), idx)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ");

        let quality = "720p";
        if (/4k|2160p/i.test(beforeText)) quality = "4K";
        else if (/1080p/i.test(beforeText)) quality = "1080p";
        else if (/720p/i.test(beforeText)) quality = "720p";
        else if (/480p/i.test(beforeText)) quality = "480p";

        let size = "";
        const sizeMatch =
          beforeText.match(/\[([0-9.]+\s*[GMK]B)\]/i) ||
          beforeText.match(/([0-9.]+\s*[GMK]B)/i);
        if (sizeMatch) size = sizeMatch[1];

        const is10bit = /10bit|hevc|x265/i.test(beforeText) ? "10Bit" : "";

        try {
          // Fetch mvlink with timeout and retry
          let mvHtml = "";
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const mvRes = await fetch(mv, {
                headers: { "User-Agent": UA, Referer: targetPostUrl },
                signal: AbortSignal.timeout(attempt === 0 ? 9000 : 12000),
              });
              if (mvRes.ok) {
                mvHtml = await mvRes.text();
                break;
              }
            } catch {
              if (attempt === 1) break;
            }
          }
          if (!mvHtml) return;

          const hshareMatch = mvHtml.match(
            /href=["'](https?:\/\/[^\s"'*]*hshare\.[^\s"'*]+)["']/i
          );
          if (!hshareMatch) return;

          const hshareUrl = hshareMatch[1];
          let hsHtml = "";
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const hsRes = await fetch(hshareUrl, {
                headers: { "User-Agent": UA, Referer: mv },
                signal: AbortSignal.timeout(attempt === 0 ? 8000 : 12000),
              });
              if (hsRes.ok) {
                hsHtml = await hsRes.text();
                break;
              }
            } catch {
              if (attempt === 1) break;
            }
          }
          if (!hsHtml) return;

          const btnRegex =
            /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/gis;
          let bm;
          while ((bm = btnRegex.exec(hsHtml)) !== null) {
            const btnUrl = bm[1];
            const btnLabel = bm[2].replace(/<[^>]+>/g, "").trim();
            if (
              btnUrl.includes("bootstrap") ||
              btnUrl.includes("#") ||
              !btnLabel
            )
              continue;

            // Check if HCloud / HPage with direct worker stream
            if (btnUrl.includes("hcloud.ink") || /hpage|hcloud/i.test(btnLabel)) {
              const unpacked = unpackHCloudUrl(btnUrl);
              if (unpacked) {
                streams.push({
                  name: `HindMovie ${quality} ${is10bit ? is10bit + " " : ""}HCloud Fast Stream 🇮🇳 Hindi`,
                  description: `[HCloud High-Speed Stream] ${size ? "💾 " + size + " " : ""}${quality} Dual Audio · 🇮🇳 Hindi · English · HindMovie`,
                  url: unpacked,
                });
              } else {
                streams.push({
                  name: `HindMovie ${quality} ${is10bit ? is10bit + " " : ""}HCloud 🇮🇳 Hindi`,
                  description: `[HCloud Stream] ${size ? "💾 " + size + " " : ""}${quality} Dual Audio · 🇮🇳 Hindi · English · HindMovie`,
                  url: btnUrl,
                });
              }
            } else if (/gdirect/i.test(btnLabel)) {
              const directGoogleUrl = await resolveGooglePhotosVideo(btnUrl);
              streams.push({
                name: `HindMovie ${quality} ${is10bit ? is10bit + " " : ""}GDirect 🇮🇳 Hindi`,
                description: `[GDirect Google Stream] ${size ? "💾 " + size + " " : ""}${quality} Dual Audio · 🇮🇳 Hindi · English · HindMovie`,
                url: directGoogleUrl,
              });
            } else if (/hindfile|gdshine/i.test(btnLabel)) {
              streams.push({
                name: `HindMovie ${quality} ${is10bit ? is10bit + " " : ""}HindFile 🇮🇳 Hindi`,
                description: `[HindFile Direct] ${size ? "💾 " + size + " " : ""}${quality} Dual Audio · 🇮🇳 Hindi · English · HindMovie`,
                url: btnUrl,
              });
            }
          }
        } catch {
          // Gracefully ignore individual failed stream candidate
        }
      })
    );

    // Sort streams: 1080p -> 720p -> 480p, HCloud fast streams first
    streams.sort((a, b) => {
      const qA = parseInt(a.name.match(/\d+/)?.[0] || "0", 10);
      const qB = parseInt(b.name.match(/\d+/)?.[0] || "0", 10);
      if (qA !== qB) return qB - qA;
      const isHC_A = a.url.includes("workers.dev") || a.name.includes("HCloud") ? 0 : 1;
      const isHC_B = b.url.includes("workers.dev") || b.name.includes("HCloud") ? 0 : 1;
      return isHC_A - isHC_B;
    });

    return { streams, captions: [] };
  } catch (e: any) {
    return { streams: [], captions: [], laneError: e?.message || "HindMovie error" };
  }
}
