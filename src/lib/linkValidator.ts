/**
 * Pre-fetch Link Validator
 * Checks if a remote video source URL is reachable and supports byte-range
 * streaming requests before passing it to Plyr or HTML5 video players.
 */

export type LinkValidationResult = {
  ok: boolean;
  url: string;
  status?: number;
  statusText?: string;
  rangeSupported: boolean;
  contentType?: string;
  isProxied?: boolean;
  error?: string;
};

export async function validateVideoLink(
  rawUrl: string,
  timeoutMs = 6000
): Promise<LinkValidationResult> {
  if (!rawUrl || !rawUrl.trim()) {
    return {
      ok: false,
      url: rawUrl,
      rangeSupported: false,
      error: "Empty or invalid video URL provided",
    };
  }

  const trimmedUrl = rawUrl.trim();

  // Helper function to test a specific endpoint with a byte-range request
  const testEndpoint = async (targetUrl: string): Promise<LinkValidationResult> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Perform a range request for bytes=0-100 to test reachability & range support
      const res = await fetch(targetUrl, {
        method: "GET",
        headers: {
          Range: "bytes=0-100",
          Accept: "*/*",
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      const status = res.status;
      const contentType = res.headers.get("content-type") || "";
      const acceptRanges = res.headers.get("accept-ranges") || "";
      const contentRange = res.headers.get("content-range") || "";

      // Standard HTTP success for streaming
      const isHttpOk = (status >= 200 && status < 400);

      // Range support check
      const isHlsOrDash =
        targetUrl.includes(".m3u8") ||
        targetUrl.includes(".mpd") ||
        contentType.includes("mpegurl") ||
        contentType.includes("dash+xml");

      const isRangeSupported =
        status === 206 ||
        acceptRanges.toLowerCase().includes("bytes") ||
        contentRange.length > 0 ||
        isHlsOrDash;

      if (isHttpOk) {
        return {
          ok: true,
          url: targetUrl,
          status,
          statusText: res.statusText || "OK",
          rangeSupported: isRangeSupported,
          contentType,
        };
      }

      return {
        ok: false,
        url: targetUrl,
        status,
        statusText: res.statusText || `HTTP ${status}`,
        rangeSupported: false,
        contentType,
        error: `Server responded with status ${status}`,
      };
    } catch (err: any) {
      const isAbort = err?.name === "AbortError";
      return {
        ok: false,
        url: targetUrl,
        rangeSupported: false,
        error: isAbort ? "Pre-fetch request timed out" : (err?.message || "Network error unreachable"),
      };
    }
  };

  // 1. Initial pre-fetch test on the direct/provided URL
  const initialResult = await testEndpoint(trimmedUrl);
  if (initialResult.ok) {
    return initialResult;
  }

  // 2. If direct URL failed (e.g. 403, 404, CORS error) and isn't proxied yet, attempt auto-proxy fallback
  if (!trimmedUrl.includes("/api/stream/proxy") && !trimmedUrl.includes("/api/m2box/proxy")) {
    try {
      const b64 =
        typeof window !== "undefined"
          ? btoa(unescape(encodeURIComponent(trimmedUrl)))
          : Buffer.from(trimmedUrl).toString("base64");

      const ext = trimmedUrl.includes(".m3u8")
        ? "playlist.m3u8"
        : trimmedUrl.includes(".mpd")
        ? "manifest.mpd"
        : "video.mp4";

      const proxyUrl = `/api/stream/proxy/${ext}?b64=${encodeURIComponent(b64)}`;
      const proxyResult = await testEndpoint(proxyUrl);

      if (proxyResult.ok) {
        return {
          ...proxyResult,
          isProxied: true,
        };
      }
    } catch {}
  }

  return initialResult;
}
