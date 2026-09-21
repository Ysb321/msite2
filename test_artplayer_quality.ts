// Let's inspect Artplayer's recommended quality switching with hls.js
/*
Official Artplayer HLS quality integration pattern:
art.on('ready', () => {
  const hls = art.hls;
  if (!hls) return;
  
  // hls.levels contains array of { height, width, bitrate, attrs, ... }
  // To switch quality:
  // hls.currentLevel = levelIndex; (-1 for auto, 0, 1, 2... for fixed)
  // Note: hls.currentLevel = levelIndex switches next segment.
  // To switch immediately: hls.nextLevel = levelIndex; hls.loadLevel = levelIndex;
});
*/
console.log("Artplayer quality switching pattern documented.");
