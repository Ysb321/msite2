async function runFullVerification() {
  const titles = [
    { type: "movie", id: "1288445", label: "Mutiny (2026)" },
    { type: "movie", id: "550", label: "Fight Club (1999)" },
    { type: "movie", id: "27205", label: "Inception (2010)" },
    { type: "tv", id: "108978", s: 1, e: 1, label: "Reacher S1E1" },
    { type: "tv", id: "1399", s: 1, e: 1, label: "Game of Thrones S1E1" },
    { type: "tv", id: "114472", s: 1, e: 1, label: "House of the Dragon S1E1" }
  ];

  console.log("=== STARTING FULL STREAMING & QUALITY VERIFICATION ===");

  for (const t of titles) {
    console.log(`\n----------------------------------------`);
    console.log(`Testing: ${t.label} (ID: ${t.id})`);
    const embedUrl = `http://localhost:3000/api/yomovies/embed?type=${t.type}&id=${t.id}&s=${t.s || 1}&e=${t.e || 1}`;
    
    // 1. Fetch Embed HTML
    const embedRes = await fetch(embedUrl);
    if (!embedRes.ok) {
      console.error(`  FAIL Embed Status: ${embedRes.status}`);
      continue;
    }
    const html = await embedRes.text();
    const m3u8Match = html.match(/\/api\/yomovies\/proxy\?url=([^"']+)/);
    if (!m3u8Match) {
      console.error(`  FAIL No proxied M3U8 found in embed HTML!`);
      continue;
    }

    const masterProxyPath = m3u8Match[0];
    const masterFullUrl = `http://localhost:3000${masterProxyPath}`;
    console.log(`  OK Embed HTML generated successfully.`);

    // 2. Fetch Master M3U8 via Proxy
    const masterRes = await fetch(masterFullUrl);
    if (!masterRes.ok) {
      console.error(`  FAIL Master M3U8 status: ${masterRes.status}`);
      continue;
    }
    const masterText = await masterRes.text();
    
    // Verify no carriage return \r in master text lines
    const rawLines = masterText.split("\n");
    const hasCR = rawLines.some(l => l.includes("\r"));
    if (hasCR) {
      console.error(`  WARN Master M3U8 contains carriage returns!`);
    } else {
      console.log(`  OK Master M3U8 has clean LF line endings.`);
    }

    // Extract sub-playlists
    const subPaths = rawLines.filter(l => l.trim() && !l.startsWith("#"));
    console.log(`  OK Found ${subPaths.length} quality level variant(s).`);

    if (subPaths.length > 0) {
      // 3. Test each variant level M3U8
      for (let i = 0; i < subPaths.length; i++) {
        const subProxyUrl = `http://localhost:3000${subPaths[i]}`;
        const subRes = await fetch(subProxyUrl);
        if (!subRes.ok) {
          console.error(`  FAIL Variant level ${i + 1} status: ${subRes.status}`);
          continue;
        }
        const subText = await subRes.text();
        console.log(`  OK Variant level ${i + 1} playlist retrieved successfully (${subText.length} bytes).`);

        // Check if AES key is present and test fetching key
        const keyMatch = subText.match(/URI=["'](\/api\/yomovies\/proxy\?url=[^"']+)["']/i);
        if (keyMatch) {
          const keyProxyUrl = `http://localhost:3000${keyMatch[1]}`;
          const keyRes = await fetch(keyProxyUrl);
          if (!keyRes.ok) {
            console.error(`  FAIL Encryption Key status: ${keyRes.status}`);
          } else {
            const keyBuf = await keyRes.arrayBuffer();
            console.log(`  OK Encryption Key fetched successfully (${keyBuf.byteLength} bytes).`);
          }
        }

        // Check if .ts segment chunk is present and test fetching first segment
        const segMatch = subText.split("\n").find(l => l.includes("/api/yomovies/proxy?url="));
        if (segMatch) {
          const segProxyUrl = `http://localhost:3000${segMatch.trim()}`;
          const segRes = await fetch(segProxyUrl);
          if (!segRes.ok) {
            console.error(`  FAIL TS Segment status: ${segRes.status}`);
          } else {
            const segBuf = await segRes.arrayBuffer();
            console.log(`  OK TS Video Segment fetched successfully (${segBuf.byteLength} bytes).`);
          }
        }
      }
    }
  }

  console.log(`\n=== ALL VERIFICATION TESTS COMPLETED ===`);
}

runFullVerification();
