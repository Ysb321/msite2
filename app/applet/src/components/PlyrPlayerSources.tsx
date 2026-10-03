"use client";

import React, { useState } from "react";
import VideoPlayer from "@/components/VideoPlayer";
import { PlayIcon, CheckIcon, RotateCcwIcon } from "@/components/Icons";
import { openInVlc, downloadFile } from "@/lib/vlc";

type Props = {
  type: "movie" | "tv";
  tmdbId: string;
  title: string;
  season?: number;
  episode?: number;
};

const DEFAULT_SAMPLE_URL = "https://bcdnxw.hakunaymatata.com/resource/916eccdd4c0db61aee9268d8790ddf0e.mp4?sign=8eebde36966a2428858c1f839c8960f0&t=1790347712";

export default function PlyrPlayerSources({ type, tmdbId, title, season = 1, episode = 1 }: Props) {
  const [inputVal, setInputVal] = useState<string>(DEFAULT_SAMPLE_URL);
  const [streamUrl, setStreamUrl] = useState<string>(DEFAULT_SAMPLE_URL);
  const [useProxy, setUseProxy] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const sanitizeUrl = (raw: string) => {
    let clean = raw.trim();
    if (clean.toLowerCase().startsWith("vhttp")) {
      clean = clean.slice(1);
    }
    return clean;
  };

  const getPlayableUrl = (url: string, proxy: boolean) => {
    const cleaned = sanitizeUrl(url);
    if (!cleaned) return "";
    if (proxy && /^https?:\/\//i.test(cleaned) && !cleaned.includes(window.location.host)) {
      return `/api/stream/proxy?url=${encodeURIComponent(cleaned)}`;
    }
    return cleaned;
  };

  const handlePlay = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleaned = sanitizeUrl(inputVal);
    if (!cleaned) return;
    setStreamUrl(cleaned);
    setIsPlaying(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sanitizeUrl(inputVal));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const playable = getPlayableUrl(streamUrl, useProxy);

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0d14] text-white">
      <div className="p-4 bg-[#141824] border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span>⚡ Plyr Custom Stream Player (Server 45)</span>
          </h2>
          <p className="text-xs text-gray-400">
            Paste any direct MP4/HLS/MKV video link or stream URL to play instantly.
          </p>
        </div>
        <form onSubmit={handlePlay} className="flex items-center gap-2 flex-1 max-w-xl">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Paste direct video stream URL (e.g. https://...)"
            className="flex-1 bg-black/40 border border-white/20 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
          />
          <button
            type="submit"
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <PlayIcon className="w-3.5 h-3.5" />
            Play
          </button>
        </form>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={useProxy}
              onChange={(e) => setUseProxy(e.target.checked)}
              className="rounded bg-black border-white/20 text-red-600 focus:ring-0"
            />
            CORS Proxy
          </label>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-xs flex items-center gap-1.5 transition-colors"
          >
            {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-400" /> : null}
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            onClick={() => openInVlc(sanitizeUrl(inputVal))}
            className="px-3 py-1.5 bg-orange-600/80 hover:bg-orange-600 rounded text-xs font-semibold transition-colors"
          >
            VLC
          </button>
          <button
            onClick={() => downloadFile(sanitizeUrl(inputVal))}
            className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 rounded text-xs font-semibold transition-colors"
          >
            Download
          </button>
        </div>
      </div>
      <div className="flex-1 relative bg-black">
        {playable ? (
          <VideoPlayer src={playable} title={title || "Custom Stream"} poster="" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
            Enter a valid stream URL and click Play
          </div>
        )}
      </div>
    </div>
  );
}
