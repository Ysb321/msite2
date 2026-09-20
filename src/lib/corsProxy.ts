/**
 * Dedicated CORS Proxy Utility for External Media & Video Streams
 * Dynamically formats external video URLs to pass through the dedicated proxy route
 * with full CORS headers, byte-range seeking, and HLS segment rewriting.
 */

export function getCorsProxyUrl(rawUrl: string, ext = "video.mp4"): string {
  if (!rawUrl) return "";
  
  // If already proxied or relative API path, return as-is
  if (
    rawUrl.startsWith("/api/") ||
    rawUrl.includes("/api/stream/proxy") ||
    rawUrl.includes("/api/m2box/proxy")
  ) {
    return rawUrl;
  }

  // Base64 encode the URL to safely pass query strings, signatures, and tokens
  const b64 = typeof window !== "undefined"
    ? btoa(unescape(encodeURIComponent(rawUrl)))
    : Buffer.from(rawUrl).toString("base64");

  const safeExt = ext.startsWith(".") ? ext.slice(1) : ext;
  return `/api/stream/proxy/${safeExt}?b64=${encodeURIComponent(b64)}`;
}

/**
 * Checks if an external video URL requires passing through the CORS proxy
 */
export function shouldProxyUrl(url: string): boolean {
  if (!url || !url.startsWith("http")) return false;

  // Local/same-origin URLs don't need proxying unless explicitly requesting it
  if (typeof window !== "undefined" && url.startsWith(window.location.origin)) {
    return false;
  }

  // Known cross-origin storage providers or servers that restrict CORS/HEAD requests
  const proxyDomains = [
    "workers.dev",
    "r2.dev",
    "cloudflarestorage.com",
    "pixeldrain",
    "pixelserver",
    "googleusercontent.com",
    "hcloud",
    "hubcloud",
    "fslv2",
    "fsl",
    "vcloud",
    "hicine",
    "hindfile",
    "m2box",
    "nuvio",
  ];

  const lowerUrl = url.toLowerCase();
  return (
    proxyDomains.some((domain) => lowerUrl.includes(domain)) ||
    lowerUrl.includes(".mkv") ||
    lowerUrl.includes(".m3u8") ||
    lowerUrl.includes(".mpd")
  );
}

/**
 * Ensures any external stream URL is properly proxied if required
 */
export function ensureCorsStreamUrl(url: string): string {
  if (shouldProxyUrl(url)) {
    let ext = "video.mp4";
    if (url.includes(".m3u8")) ext = "playlist.m3u8";
    else if (url.includes(".mpd")) ext = "manifest.mpd";
    else if (url.includes(".mkv")) ext = "video.mkv";
    else if (url.includes(".ts")) ext = "segment.ts";
    
    return getCorsProxyUrl(url, ext);
  }
  return url;
}
