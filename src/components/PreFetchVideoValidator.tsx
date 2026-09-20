"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import VideoPlayer, { VideoPlayerProps } from "@/components/VideoPlayer";
import { validateVideoLink, LinkValidationResult } from "@/lib/linkValidator";
import { openInVlc, downloadFile, generateVlcProtocolUrl, downloadM3uPlaylist, unwrapDirectUrl, getPlayableMediaUrl } from "@/lib/vlc";
import { RotateCcwIcon, PlayIcon, CheckIcon } from "@/components/Icons";

export type PreFetchVideoValidatorProps = VideoPlayerProps & {
  onSwitchServer?: () => void;
};

export default function PreFetchVideoValidator({
  url,
  title,
  poster,
  startAt = 0,
  subtitles,
  sources,
  currentKey,
  onPickSource,
  onTimeupdate,
  onEnded,
  onError,
  onVlc,
  onDownload,
  onReport,
  onSwitchServer,
  className,
}: PreFetchVideoValidatorProps) {
  const [validationState, setValidationState] = useState<"validating" | "valid" | "invalid">("validating");
  const [validationResult, setValidationResult] = useState<LinkValidationResult | null>(null);
  const [activeUrl, setActiveUrl] = useState<string>(url);
  const [vlcNote, setVlcNote] = useState<string>("Preparing VLC Media Player handoff...");
  const [copied, setCopied] = useState<boolean>(false);
  const [useWebPlayer, setUseWebPlayer] = useState<boolean>(false);
  const vlcTriggeredRef = useRef<boolean>(false);

  const handleOpenVlc = useCallback(async (targetUrl: string) => {
    let absUrl = targetUrl;
    try {
      absUrl = new URL(targetUrl, window.location.origin).toString();
    } catch {}

    setVlcNote("Launching VLC...");
    const res = await openInVlc(absUrl, title);
    setVlcNote(res.note || (res.ok ? "Sent to VLC player ✓" : "Link copied to clipboard"));
  }, [title]);

  const runValidation = useCallback(async (targetUrl: string, forceProxy = false) => {
    setValidationState("validating");
    vlcTriggeredRef.current = false;

    let urlToTest = targetUrl;
    if (forceProxy && !targetUrl.includes("/api/stream/proxy")) {
      const b64 = typeof window !== "undefined"
        ? btoa(unescape(encodeURIComponent(targetUrl)))
        : Buffer.from(targetUrl).toString("base64");
      urlToTest = `/api/stream/proxy/video.mp4?b64=${encodeURIComponent(b64)}`;
    }

    const res = await validateVideoLink(urlToTest);
    setValidationResult(res);

    if (res.ok) {
      setActiveUrl(res.url);
      setValidationState("valid");

      // Directly open in VLC on successful validation
      if (!vlcTriggeredRef.current) {
        vlcTriggeredRef.current = true;
        handleOpenVlc(res.url);
      }
    } else {
      setValidationState("invalid");
      onError?.({ message: res.error || "Pre-fetch validation failed", code: res.status });
    }
  }, [onError, handleOpenVlc]);

  useEffect(() => {
    runValidation(url);
  }, [url, runValidation]);

  const copyStreamUrl = useCallback(async () => {
    try {
      const directUrl = unwrapDirectUrl(activeUrl);
      await navigator.clipboard.writeText(directUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {}
  }, [activeUrl]);

  // Render Validating State
  if (validationState === "validating") {
    return (
      <div className={`relative flex h-full w-full min-h-[380px] flex-col items-center justify-center bg-black/95 p-6 text-center text-white ${className || ""}`}>
        <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500/10 border border-orange-500/20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        </div>
        <h3 className="text-base font-semibold tracking-wide text-white">Validating Remote Video Source</h3>
        <p className="mt-1 text-xs text-neutral-400 max-w-md">
          Checking server reachability & preparing direct VLC stream handoff...
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-full bg-neutral-900/80 px-3 py-1 text-[11px] text-neutral-400 border border-neutral-800 font-mono">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-orange-500" />
          <span className="truncate max-w-[280px]">{url}</span>
        </div>
      </div>
    );
  }

  // Render Link Unavailable State
  if (validationState === "invalid") {
    return (
      <div className={`relative flex h-full w-full min-h-[380px] flex-col items-center justify-center bg-neutral-950 p-6 text-center text-white border border-red-500/20 rounded-xl ${className || ""}`}>
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/15 text-red-500 border border-red-500/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-0.5 text-xs font-semibold text-red-400 border border-red-500/20 mb-2">
          <span>Validation Error</span>
          {validationResult?.status && <span>• HTTP {validationResult.status}</span>}
        </div>

        <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
          Link Unavailable
        </h2>

        <p className="mt-2 max-w-lg text-xs leading-relaxed text-neutral-300 sm:text-sm">
          The remote video source could not be reached or does not support byte-range requests required for streaming.
        </p>

        {validationResult?.error && (
          <div className="mt-3 rounded-lg bg-neutral-900/90 px-3 py-2 text-xs text-neutral-400 font-mono border border-neutral-800/80 max-w-md break-all">
            Reason: {validationResult.error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => runValidation(url)}
            className="flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-700 transition"
          >
            <RotateCcwIcon className="h-4 w-4" />
            <span>Retry Pre-fetch</span>
          </button>

          <button
            onClick={() => runValidation(url, true)}
            className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-xs font-medium text-white hover:bg-orange-500 transition shadow-lg shadow-orange-900/20"
          >
            <PlayIcon className="h-4 w-4" />
            <span>Force Proxy Stream</span>
          </button>

          {onSwitchServer && (
            <button
              onClick={onSwitchServer}
              className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white transition"
            >
              <span>Select Another Server</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Render Web Player if user explicitly toggled it
  if (useWebPlayer) {
    return (
      <div className="relative flex flex-col h-full w-full">
        <div className="flex items-center justify-between bg-neutral-900 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-300">
          <span className="font-medium text-amber-400">Web Player Active</span>
          <button
            onClick={() => setUseWebPlayer(false)}
            className="rounded bg-neutral-800 px-2.5 py-1 text-[11px] font-medium hover:bg-neutral-700 text-white transition"
          >
            Switch to Direct VLC Mode
          </button>
        </div>
        <VideoPlayer
          url={getPlayableMediaUrl(activeUrl)}
          title={title}
          poster={poster}
          startAt={startAt}
          subtitles={subtitles}
          sources={sources}
          currentKey={currentKey}
          onPickSource={onPickSource}
          onTimeupdate={onTimeupdate}
          onEnded={onEnded}
          onError={onError}
          onVlc={onVlc}
          onDownload={onDownload}
          onReport={onReport}
          className={className}
        />
      </div>
    );
  }

  // Render Default: Direct VLC Stream Launcher View
  return (
    <div className={`relative flex h-full w-full min-h-[400px] flex-col items-center justify-center bg-gradient-to-b from-neutral-950 via-black to-neutral-950 p-6 text-center text-white border border-orange-500/20 rounded-xl shadow-2xl ${className || ""}`}>
      {/* VLC Traffic Cone Icon / Banner */}
      <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-orange-500/10 text-orange-500 border border-orange-500/30 shadow-lg shadow-orange-500/10">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10 text-orange-500">
          <path d="M12 2L2 19h20L12 2zm0 4.5l5.5 10.5h-11L12 6.5zM12 9l-3 6h6l-3-6z" />
        </svg>
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-orange-500"></span>
        </span>
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3.5 py-1 text-xs font-semibold text-orange-400 border border-orange-500/30 mb-2">
        <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
        <span>Direct VLC Stream Active</span>
      </div>

      <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl max-w-xl line-clamp-1">
        {title || "Stream Handed Off to VLC"}
      </h2>

      <p className="mt-2 text-xs text-orange-300 font-medium bg-orange-950/40 border border-orange-500/20 px-3 py-1 rounded-md">
        {vlcNote}
      </p>

      <div className="mt-4 flex w-full max-w-md flex-col gap-1.5 rounded-lg bg-neutral-900/90 px-3 py-2 text-xs text-neutral-400 border border-neutral-800 font-mono text-left">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 text-[10px]">DIRECT STREAM:</span>
          <span className="truncate flex-1 text-neutral-300 select-all" title={unwrapDirectUrl(activeUrl)}>{unwrapDirectUrl(activeUrl)}</span>
        </div>
        <div className="flex items-center gap-2 border-t border-neutral-800/80 pt-1.5">
          <span className="text-orange-500 text-[10px] font-bold">VLC PROTOCOL:</span>
          <span className="truncate flex-1 text-orange-300/90 select-all" title={generateVlcProtocolUrl(activeUrl)}>{generateVlcProtocolUrl(activeUrl)}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a
          href={generateVlcProtocolUrl(activeUrl)}
          onClick={(e) => {
            e.preventDefault();
            handleOpenVlc(activeUrl);
          }}
          className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-orange-500 active:scale-95 transition shadow-lg shadow-orange-900/30"
        >
          <PlayIcon className="h-4 w-4 fill-current" />
          <span>Open in VLC Player</span>
        </a>

        <button
          onClick={() => downloadM3uPlaylist(activeUrl, title)}
          className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-950/40 px-4 py-2.5 text-xs font-medium text-orange-200 hover:bg-orange-900/50 transition"
        >
          <span>Download .M3U (VLC File)</span>
        </button>

        <button
          onClick={copyStreamUrl}
          className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800 hover:text-white transition"
        >
          {copied ? <CheckIcon className="h-4 w-4 text-green-400" /> : null}
          <span>{copied ? "Link Copied!" : "Copy Direct Stream Link"}</span>
        </button>

        <button
          onClick={() => downloadFile(unwrapDirectUrl(activeUrl), `${title || "video"}.mp4`)}
          className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800 hover:text-white transition"
        >
          <span>Download MP4</span>
        </button>

        {onSwitchServer && (
          <button
            onClick={onSwitchServer}
            className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white transition"
          >
            <span>Switch Server</span>
          </button>
        )}
      </div>

      <div className="mt-6 border-t border-neutral-800/80 pt-4 text-center flex items-center justify-center gap-4">
        <button
          onClick={() => setUseWebPlayer(true)}
          className="text-xs text-amber-400 hover:text-amber-300 font-medium underline underline-offset-4 transition flex items-center gap-1.5"
        >
          <PlayIcon className="h-3 w-3 fill-current" />
          <span>Having trouble with VLC? Watch in Browser (Web Player)</span>
        </button>
      </div>
    </div>
  );
}
