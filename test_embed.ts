import { resolveYoMoviesStream } from "./src/lib/yomovies";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function inspectEmbed() {
  const embedUrl = "https://speedostream1.com/embed-2yglmmqgdxim.html";
  const res = await fetch(embedUrl, {
    headers: { "User-Agent": UA, "Referer": "https://yomovies.church/" }
  });
  console.log("Embed status:", res.status);
  const html = await res.text();
  console.log("Embed HTML length:", html.length);

  const m3u8Matches = html.match(/https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*/gi);
  console.log("M3U8 Matches:", m3u8Matches);

  const scripts = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map(m => m[1]);
  scripts.forEach((s, i) => {
    if (s.includes("eval") || s.includes("m3u8") || s.includes("Player") || s.includes("sources")) {
      console.log(`Script ${i} preview:`, s.slice(0, 300));
    }
  });
}
inspectEmbed();
