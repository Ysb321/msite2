const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function testFreshToken() {
  const embedUrl = "https://speedostream1.com/embed-2yglmmqgdxim.html";
  const embedRes = await fetch(embedUrl, {
    headers: { "User-Agent": UA, "Referer": "https://yomovies.church/" }
  });
  const embedHtml = await embedRes.text();
  const m3u8Match = embedHtml.match(/https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*/i);
  if (!m3u8Match) {
    console.log("No m3u8 found!");
    return;
  }
  const freshMasterUrl = m3u8Match[0];
  console.log("Fresh Master URL:", freshMasterUrl);

  // Fetch Master M3U8
  const masterRes = await fetch(freshMasterUrl, {
    headers: { "User-Agent": UA, "Referer": "https://speedostream1.com/" }
  });
  console.log("Master Status:", masterRes.status);
  const masterText = await masterRes.text();
  console.log("Master Text:\n", masterText);

  // Extract sub-playlist URL
  const subLines = masterText.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#"));
  console.log("Sub-playlists:", subLines);

  if (subLines.length > 0) {
    const subUrl = new URL(subLines[0], freshMasterUrl).href;
    console.log("Fetching sub-playlist:", subUrl);
    const subRes = await fetch(subUrl, {
      headers: { "User-Agent": UA, "Referer": "https://speedostream1.com/" }
    });
    console.log("Sub-playlist Status:", subRes.status);
    const subText = await subRes.text();
    console.log("Sub-playlist preview (first 400 chars):\n", subText.slice(0, 400));

    // Extract key URL
    const keyMatch = subText.match(/URI=["']([^"']+)["']/i);
    if (keyMatch) {
      const keyUrl = new URL(keyMatch[1], subUrl).href;
      console.log("Fetching Key URL:", keyUrl);
      const keyRes = await fetch(keyUrl, {
        headers: { "User-Agent": UA, "Referer": "https://speedostream1.com/" }
      });
      console.log("Key Status:", keyRes.status);
      const keyBuf = await keyRes.arrayBuffer();
      console.log("Key Byte Length:", keyBuf.byteLength);
    }
  }
}

testFreshToken();
