"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "plyr/dist/plyr.css";
import { XIcon } from "@/components/Icons";
import { getPlayableMediaUrl } from "@/lib/vlc";

export type AudioTrackOption = {
  id: string | number;
  index: number;
  label: string;
  language: string;
  enabled: boolean;
  type: "hls" | "native" | "external";
  raw?: any;
};

export type SubtitleTrackOption = {
  url: string;
  name: string;
  lang: string;
  default?: boolean;
};

export type VideoPlayerSourceMini = {
  key: string;
  quality: string;
  size?: string;
  source?: string;
  file?: string;
  audio?: string;
  lang?: string;
  url?: string;
};

export type VideoPlayerProps = {
  /** Playable stream URL (HLS .m3u8, DASH .mpd, or MP4/MKV file) */
  url: string;
  title: string;
  poster?: string;
  /** Resume position in seconds */
  startAt?: number;
  /** Subtitle tracks (WebVTT / SRT) */
  subtitles?: SubtitleTrackOption[];
  /** Sibling or alternate sources/qualities */
  sources?: VideoPlayerSourceMini[];
  currentKey?: string;
  onPickSource?: (key: string) => Promise<string | null>;
  onTimeupdate?: (time: number, duration?: number) => void;
  onEnded?: () => void;
  onError?: (err?: { message: string; code?: number }) => void;
  onVlc?: () => void;
  onDownload?: () => void;
  onReport?: () => void;
  className?: string;
};

export default function VideoPlayer({
  url,
  title,
  poster,
  startAt = 0,
  subtitles = [],
  sources = [],
  currentKey = "",
  onPickSource,
  onTimeupdate,
  onEnded,
  onError,
  onVlc,
  onDownload,
  onReport,
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrInstanceRef = useRef<any>(null);
  const hlsInstanceRef = useRef<any>(null);
  const dashInstanceRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentStreamUrl = useRef<string>(url);
  const hasAutoProxyRetried = useRef<boolean>(false);

  // Dynamic Audio Tracks
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [activeAudioIndex, setActiveAudioIndex] = useState<number>(0);

  // Subtitles
  const [customSubUrl, setCustomSubUrl] = useState<string>("");
  const [showSubModal, setShowSubModal] = useState<boolean>(false);

  // Web Audio Equalizer & Volume Booster (up to 300%)
  const [audioBoost, setAudioBoost] = useState<number>(100);
  const [dialogueClarity, setDialogueClarity] = useState<boolean>(false);
  const [nightMode, setNightMode] = useState<boolean>(false);
  const [showAudioModal, setShowAudioModal] = useState<boolean>(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const eqNodeRef = useRef<BiquadFilterNode | null>(null);
  const compNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const audioSetupDone = useRef<boolean>(false);

  // Sources & Quality Modal
  const [showSourcesModal, setShowSourcesModal] = useState<boolean>(false);
  const [isSwitchingSource, setIsSwitchingSource] = useState<string | null>(null);

  // Errors & Recovery
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);

  // Callbacks ref
  const cbs = useRef({
    onPickSource,
    onTimeupdate,
    onEnded,
    onError,
    onVlc,
    onDownload,
    onReport,
  });
  cbs.current = {
    onPickSource,
    onTimeupdate,
    onEnded,
    onError,
    onVlc,
    onDownload,
    onReport,
  };

  // Web Audio Initializer
  const setupWebAudio = useCallback(() => {
    if (audioSetupDone.current || !videoRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(videoRef.current);

      const gain = ctx.createGain();
      gain.gain.value = audioBoost / 100;

      const eq = ctx.createBiquadFilter();
      eq.type = "peaking";
      eq.frequency.value = 2500;
      eq.Q.value = 1.0;
      eq.gain.value = dialogueClarity ? 6 : 0;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 30;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;

      source.connect(eq);
      eq.connect(gain);

      if (nightMode) {
        gain.connect(comp);
        comp.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }

      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
      eqNodeRef.current = eq;
      compNodeRef.current = comp;
      audioSetupDone.current = true;
    } catch {
      // Ignore Web Audio CORS or duplicate connection limitations
    }
  }, [audioBoost, dialogueClarity, nightMode]);

  // Audio Gain Sync
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      try {
        gainNodeRef.current.gain.setValueAtTime(audioBoost / 100, audioCtxRef.current.currentTime);
      } catch {}
    }
  }, [audioBoost]);

  // Dialogue Clarity EQ Sync
  useEffect(() => {
    if (eqNodeRef.current && audioCtxRef.current) {
      try {
        eqNodeRef.current.gain.setValueAtTime(dialogueClarity ? 6 : 0, audioCtxRef.current.currentTime);
      } catch {}
    }
  }, [dialogueClarity]);

  // Switch Audio Track
  const handleSelectAudioTrack = useCallback((track: AudioTrackOption) => {
    try {
      if (track.type === "hls" && hlsInstanceRef.current) {
        hlsInstanceRef.current.audioTrack = track.index;
        setActiveAudioIndex(track.index);
      } else if (track.type === "native" && videoRef.current) {
        const v = videoRef.current as any;
        const tracks = v.audioTracks;
        if (tracks && tracks.length > track.index) {
          for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = i === track.index;
          }
          setActiveAudioIndex(track.index);
        }
      }
    } catch (e) {
      console.warn("[VideoPlayer] Failed to switch audio track:", e);
    }
  }, []);

  // Scan Native Audio Tracks
  const scanNativeAudio = useCallback((v: HTMLVideoElement) => {
    try {
      const tracks = (v as any).audioTracks;
      if (tracks && tracks.length > 0) {
        const list: AudioTrackOption[] = [];
        let active = 0;
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          const lang = t.language || "";
          const isHi = /hi|hindi/i.test(lang) || /hindi/i.test(t.label || "");
          const isEn = /en|english/i.test(lang) || /english/i.test(t.label || "");
          const label =
            t.label ||
            (isHi
              ? "🇮🇳 Hindi"
              : isEn
              ? "🌐 English"
              : lang
              ? `Audio (${lang.toUpperCase()})`
              : `Audio Track ${i + 1}`);
          list.push({
            id: t.id || String(i),
            index: i,
            label,
            language: lang,
            enabled: !!t.enabled,
            type: "native",
          });
          if (t.enabled) active = i;
        }
        setAudioTracks(list);
        setActiveAudioIndex(active);
      }
    } catch {}
  }, []);

  // Proxy Retry
  const handleRetryProxy = useCallback(() => {
    setIsRetrying(true);
    setPlayerError(null);
    try {
      let target = currentStreamUrl.current || url;
      if (!target.includes("/api/stream/proxy/")) {
        const b64 = window.btoa(unescape(encodeURIComponent(target)));
        target = `/api/stream/proxy/video.mp4?b64=${encodeURIComponent(b64)}`;
      }
      currentStreamUrl.current = target;
      if (videoRef.current) {
        videoRef.current.src = target;
        videoRef.current.load();
        videoRef.current.play().catch(() => {});
      }
      setTimeout(() => setIsRetrying(false), 1200);
    } catch {
      setIsRetrying(false);
    }
  }, [url]);

  const handleSimpleRetry = useCallback(() => {
    setIsRetrying(true);
    setPlayerError(null);
    try {
      const target = currentStreamUrl.current || url;
      if (videoRef.current) {
        videoRef.current.src = target;
        videoRef.current.load();
        videoRef.current.play().catch(() => {});
      }
      setTimeout(() => setIsRetrying(false), 1200);
    } catch {
      setIsRetrying(false);
    }
  }, [url]);

  // Main Effect: Initialize Plyr & Hls.js
  useEffect(() => {
    let isDisposed = false;
    const video = videoRef.current;
    if (!video) return;

    const activeMediaUrl = getPlayableMediaUrl(url);
    currentStreamUrl.current = activeMediaUrl;
    setPlayerError(null);
    let plyr: any = null;
    let hls: any = null;
    let dash: any = null;

    const isHls = /\.m3u8(\?|#|$)/i.test(activeMediaUrl);
    const isDash = /\.mpd(\?|#|$)/i.test(activeMediaUrl);

    (async () => {
      try {
        const { default: Plyr } = (await import("plyr")) as any;

        if (isDisposed || !videoRef.current) return;

        // Custom Plyr Options
        const defaultOptions: any = {
          controls: [
            "play-large",
            "restart",
            "rewind",
            "play",
            "fast-forward",
            "progress",
            "current-time",
            "duration",
            "mute",
            "volume",
            "captions",
            "settings",
            "pip",
            "airplay",
            "fullscreen",
          ],
          settings: ["captions", "quality", "speed"],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
          tooltips: { controls: true, seek: true },
          keyboard: { focused: true, global: true },
          seekTime: 10,
          invertTime: false,
          toggleInvert: true,
          captions: { active: true, update: true, language: "auto" },
        };

        if (isHls) {
          const { default: Hls } = (await import("hls.js")) as any;
          if (Hls.isSupported()) {
            hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 60,
              maxBufferLength: 30,
              maxMaxBufferLength: 600,
              xhrSetup: (xhr: XMLHttpRequest) => {
                xhr.withCredentials = false;
              },
            });
            hlsInstanceRef.current = hls;

            hls.loadSource(activeMediaUrl);
            hls.attachMedia(video);

            // Audio Track Parsing
            const onHlsAudioParsed = () => {
              try {
                if (hls.audioTracks && hls.audioTracks.length > 0) {
                  const tracks: AudioTrackOption[] = hls.audioTracks.map(
                    (t: any, idx: number) => {
                      const isHi =
                        /hi|hindi/i.test(t.lang || "") || /hindi/i.test(t.name || "");
                      const isEn =
                        /en|english/i.test(t.lang || "") || /english/i.test(t.name || "");
                      const label =
                        t.name ||
                        (isHi
                          ? "🇮🇳 Hindi"
                          : isEn
                          ? "🌐 English"
                          : t.lang
                          ? `Audio (${t.lang.toUpperCase()})`
                          : `Track ${idx + 1}`);
                      return {
                        id: t.id ?? idx,
                        index: idx,
                        label,
                        language: t.lang || "",
                        enabled: hls.audioTrack === idx,
                        type: "hls",
                        raw: t,
                      };
                    }
                  );
                  setAudioTracks(tracks);
                  setActiveAudioIndex(hls.audioTrack >= 0 ? hls.audioTrack : 0);
                }
              } catch {}
            };

            hls.on(Hls.Events.MANIFEST_PARSED, onHlsAudioParsed);
            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, onHlsAudioParsed);
            hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_: any, data: any) => {
              setActiveAudioIndex(data.id);
            });

            // Quality Levels Integration for Plyr
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              try {
                const availableQualities = hls.levels.map((l: any) => l.height);
                defaultOptions.quality = {
                  default: availableQualities[0],
                  options: availableQualities,
                  forced: true,
                  onChange: (newQuality: number) => {
                    hls.levels.forEach((level: any, levelIndex: number) => {
                      if (level.height === newQuality) {
                        hls.currentLevel = levelIndex;
                      }
                    });
                  },
                };
              } catch {}
            });

            // Fatal Error Handling
            hls.on(Hls.Events.ERROR, (_: any, data: any) => {
              if (data?.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.warn("[Hls.js] Network error, recovering...");
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.warn("[Hls.js] Media error, recovering...");
                    hls.recoverMediaError();
                    break;
                  default:
                    console.warn("[Hls.js] Fatal unrecoverable error:", data?.details);
                    setPlayerError("Stream network issue or expired manifest token.");
                    cbs.current.onError?.({
                      message: data?.details || "HLS fatal error",
                      code: data?.response?.code,
                    });
                    break;
                }
              }
            });
          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Native Safari HLS
            video.src = activeMediaUrl;
          }
        } else if (isDash) {
          try {
            const { default: dashjs } = (await import("dashjs")) as any;
            dash = dashjs.MediaPlayer().create();
            dash.initialize(video, activeMediaUrl, true);
            dashInstanceRef.current = dash;

            dash.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
              console.warn("[dashjs] Fatal error:", e?.message || e?.type || "DASH error");
              setPlayerError("DASH stream network issue or expired manifest token.");
              cbs.current.onError?.({ message: "DASH fatal error", code: 4 });
            });
          } catch (dashErr) {
            console.warn("[dashjs] Initialization error:", (dashErr as any)?.message || String(dashErr));
            video.src = activeMediaUrl;
          }
        } else {
          // Progressive MP4 / MKV / WebM / Proxied Stream
          video.src = activeMediaUrl;
        }

        // Instantiate Plyr
        plyr = new Plyr(video, defaultOptions);
        plyrInstanceRef.current = plyr;

        // Apply resume start position
        const applyStartAt = () => {
          if (startAt > 0 && isFinite(video.duration) && startAt < video.duration) {
            video.currentTime = startAt;
          }
          scanNativeAudio(video);
        };

        video.addEventListener("loadedmetadata", applyStartAt, { once: true });
        video.addEventListener("canplay", () => scanNativeAudio(video));
        video.addEventListener("play", () => setupWebAudio(), { once: true });

        plyr.on("timeupdate", () => {
          if (!isDisposed) {
            cbs.current.onTimeupdate?.(
              video.currentTime,
              isFinite(video.duration) ? video.duration : undefined
            );
          }
        });

        plyr.on("ended", () => {
          if (!isDisposed) cbs.current.onEnded?.();
        });

        const handleVideoError = (e?: any) => {
          if (e?.preventDefault) try { e.preventDefault(); } catch {}
          if (e?.stopPropagation) try { e.stopPropagation(); } catch {}
          if (isDisposed) return;

          const mediaErr = video.error;
          const errMsg =
            mediaErr?.code === 1
              ? "Playback aborted"
              : mediaErr?.code === 2
              ? "Network error occurred while loading video"
              : mediaErr?.code === 3
              ? "Error occurred while decoding video"
              : mediaErr?.code === 4
              ? "Stream format not supported or access restricted by provider"
              : (typeof e === "string" ? e : e?.message) || "Stream playback error";

          // Auto-proxy fallback on first failure if url is a direct link
          if (
            !hasAutoProxyRetried.current &&
            !url.includes("/api/stream/proxy") &&
            url.startsWith("http")
          ) {
            hasAutoProxyRetried.current = true;
            console.log("[VideoPlayer] Auto-attempting stream proxy fallback...");
            handleRetryProxy();
            return;
          }

          setPlayerError(errMsg);
          cbs.current.onError?.({
            message: errMsg,
            code: mediaErr?.code,
          });
        };

        video.addEventListener("error", handleVideoError);
        plyr.on("error", handleVideoError);
      } catch (err: any) {
        console.warn("[VideoPlayer] Init warning:", err?.message || String(err));
      }
    })();

    return () => {
      isDisposed = true;
      try {
        audioCtxRef.current?.close();
      } catch {}
      try {
        plyrInstanceRef.current?.destroy();
      } catch {}
      try {
        hlsInstanceRef.current?.destroy();
      } catch {}
      try {
        dashInstanceRef.current?.reset();
      } catch {}
      plyrInstanceRef.current = null;
      hlsInstanceRef.current = null;
      dashInstanceRef.current = null;
      audioSetupDone.current = false;
    };
  }, [url, startAt, scanNativeAudio, setupWebAudio, handleRetryProxy]);

  // Pick Source Callback
  const handlePickSource = async (key: string) => {
    if (key === currentKey || isSwitchingSource) {
      setShowSourcesModal(false);
      return;
    }
    setIsSwitchingSource(key);
    try {
      const newUrl = await cbs.current.onPickSource?.(key);
      if (newUrl) {
        setShowSourcesModal(false);
      }
    } catch {}
    finally {
      setIsSwitchingSource(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden rounded-lg bg-black text-white ${
        className || ""
      }`}
    >
      {/* HTML5 Video Element wrapped by Plyr */}
      <video
        ref={videoRef}
        playsInline
        poster={poster}
        className="h-full w-full object-contain"
      >
        {/* Render Subtitle Tracks */}
        {subtitles.map((sub, idx) => (
          <track
            key={`${sub.lang}-${idx}`}
            kind="captions"
            label={sub.name || sub.lang}
            srcLang={sub.lang}
            src={sub.url}
            default={sub.default || idx === 0}
          />
        ))}
      </video>

      {/* Top Header Overlay with Title and Quick Utilities */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/30 to-transparent p-4 transition-opacity">
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="max-w-[280px] truncate text-[13.5px] font-bold text-white drop-shadow-md sm:max-w-md md:max-w-lg">
            {title}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5">
          {/* Audio Booster & Dialogue Clarity Button */}
          <button
            onClick={() => setShowAudioModal(true)}
            title="Audio Boost & Voice Clarity"
            className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-neutral-200 backdrop-blur-md ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white"
          >
            <span>🎛️</span>
            <span className="hidden sm:inline">Audio EQ</span>
          </button>

          {/* Subtitle Loader Button */}
          <button
            onClick={() => setShowSubModal(true)}
            title="Custom Subtitles (.srt/.vtt)"
            className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-neutral-200 backdrop-blur-md ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white"
          >
            <span>💬</span>
            <span className="hidden sm:inline">Subtitles</span>
          </button>

          {/* Sources List Button */}
          {sources.length > 0 && (
            <button
              onClick={() => setShowSourcesModal(true)}
              title="Switch Server / Quality"
              className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-neutral-200 backdrop-blur-md ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white"
            >
              <span>☰</span>
              <span className="hidden sm:inline">Sources ({sources.length})</span>
            </button>
          )}

          {/* VLC Button */}
          {onVlc && (
            <button
              onClick={() => cbs.current.onVlc?.()}
              title="Open stream in VLC Player"
              className="rounded-full bg-orange-600/80 px-2.5 py-1 text-[11px] font-bold text-white shadow backdrop-blur-md transition hover:bg-orange-600"
            >
              VLC
            </button>
          )}

          {/* Download Button */}
          {onDownload && (
            <button
              onClick={() => cbs.current.onDownload?.()}
              title="Download Video File"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-neutral-200 backdrop-blur-md ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white"
            >
              ⬇
            </button>
          )}
        </div>
      </div>

      {/* Error & Recovery Overlay */}
      {playerError && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/85 p-6 text-center backdrop-blur-xs">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-2xl text-red-400">
            ⚠️
          </div>
          <h3 className="mt-3 text-[16px] font-bold text-white">Playback Interrupted</h3>
          <p className="mt-1 max-w-md text-[13px] text-neutral-400">{playerError}</p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <button
              onClick={handleSimpleRetry}
              disabled={isRetrying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-white/20 disabled:opacity-50"
            >
              🔄 {isRetrying ? "Retrying…" : "Retry Stream"}
            </button>

            <button
              onClick={handleRetryProxy}
              disabled={isRetrying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-[12.5px] font-bold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              🔀 Try Proxy Stream
            </button>

            {sources.length > 0 && (
              <button
                onClick={() => setShowSourcesModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
              >
                📂 Switch Source ({sources.length})
              </button>
            )}

            {onVlc && (
              <button
                onClick={() => cbs.current.onVlc?.()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600/30 px-4 py-2 text-[12.5px] font-semibold text-orange-200 hover:bg-orange-600/50"
              >
                🎬 Open in VLC
              </button>
            )}
          </div>
        </div>
      )}

      {/* Audio FX, Dynamic Tracks & Volume Booster Modal */}
      {showAudioModal && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowAudioModal(false)}
        >
          <div
            className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-xl bg-[#18181c] p-4 ring-1 ring-white/15"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🎛️</span>
                <span className="text-[14px] font-bold text-white">Audio Tracks & EQ</span>
              </div>
              <button
                onClick={() => setShowAudioModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="styled-scroll space-y-4 overflow-y-auto py-3 pr-1 max-h-[70vh]">
              {/* Dynamic In-Stream Audio Tracks */}
              {audioTracks.length > 0 && (
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
                      Detected Audio Tracks ({audioTracks.length})
                    </span>
                    <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold text-brand">
                      {audioTracks[0].type.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {audioTracks.map((tr) => (
                      <button
                        key={tr.id}
                        onClick={() => handleSelectAudioTrack(tr)}
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition ${
                          activeAudioIndex === tr.index
                            ? "bg-brand text-white font-bold"
                            : "bg-white/5 text-neutral-300 hover:bg-white/10"
                        }`}
                      >
                        <span>{tr.label}</span>
                        {activeAudioIndex === tr.index && <span>✓ Active</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Volume Booster Slider */}
              <div>
                <div className="flex items-center justify-between text-[12px] font-semibold">
                  <span className="text-neutral-300">Volume Booster</span>
                  <span className="font-bold text-brand">{audioBoost}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="300"
                  step="10"
                  value={audioBoost}
                  onChange={(e) => setAudioBoost(parseInt(e.target.value, 10))}
                  className="mt-2 w-full accent-brand cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>50%</span>
                  <span>100% (Normal)</span>
                  <span>200%</span>
                  <span>300% (Boost)</span>
                </div>
              </div>

              {/* Dialogue & Vocal Clarity Booster */}
              <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                <div>
                  <div className="text-[12.5px] font-semibold text-white">
                    🗣️ Vocal / Dialogue Clarity
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    Boosts Hindi / English speech frequencies
                  </div>
                </div>
                <button
                  onClick={() => setDialogueClarity((prev) => !prev)}
                  className={`rounded-full px-3 py-1 text-[11.5px] font-bold transition ${
                    dialogueClarity
                      ? "bg-brand text-white"
                      : "bg-white/10 text-neutral-400 hover:bg-white/20"
                  }`}
                >
                  {dialogueClarity ? "ON" : "OFF"}
                </button>
              </div>

              {/* Night Mode Dynamic Normalizer */}
              <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                <div>
                  <div className="text-[12.5px] font-semibold text-white">
                    🌙 Night Mode (Normalize Audio)
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    Balances whisper dialogue & explosions
                  </div>
                </div>
                <button
                  onClick={() => setNightMode((prev) => !prev)}
                  className={`rounded-full px-3 py-1 text-[11.5px] font-bold transition ${
                    nightMode
                      ? "bg-brand text-white"
                      : "bg-white/10 text-neutral-400 hover:bg-white/20"
                  }`}
                >
                  {nightMode ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowAudioModal(false)}
              className="mt-2 w-full rounded-lg bg-white/10 py-2 text-[12px] font-semibold text-white hover:bg-white/20"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Subtitles Custom Loader Modal */}
      {showSubModal && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowSubModal(false)}
        >
          <div
            className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-xl bg-[#18181c] p-4 ring-1 ring-white/15"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-[14px] font-bold text-white">Load Subtitles (.vtt / .srt)</span>
              <button
                onClick={() => setShowSubModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="py-3 space-y-3">
              <div>
                <label className="text-[11.5px] font-semibold text-neutral-300">
                  Subtitle URL (Direct WebVTT link)
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/subtitles/hindi.vtt"
                  value={customSubUrl}
                  onChange={(e) => setCustomSubUrl(e.target.value)}
                  className="mt-1 w-full rounded-md bg-black/50 px-3 py-2 text-[12px] text-white border border-white/10 focus:border-brand focus:outline-hidden"
                />
              </div>

              <div>
                <label className="text-[11.5px] font-semibold text-neutral-300">
                  Or Upload Local Subtitle File (.vtt/.srt)
                </label>
                <input
                  type="file"
                  accept=".vtt,.srt"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const objUrl = URL.createObjectURL(file);
                      setCustomSubUrl(objUrl);
                    }
                  }}
                  className="mt-1 block w-full text-[11px] text-neutral-400 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1.5 file:text-[11px] file:font-semibold file:text-white hover:file:bg-white/20"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowSubModal(false)}
                className="flex-1 rounded-lg bg-white/10 py-2 text-[12px] font-semibold text-neutral-300 hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (customSubUrl.trim() && videoRef.current) {
                    const track = document.createElement("track");
                    track.kind = "captions";
                    track.label = "Custom Subtitle";
                    track.srclang = "custom";
                    track.src = customSubUrl.trim();
                    track.default = true;
                    videoRef.current.appendChild(track);
                    setShowSubModal(false);
                  }
                }}
                disabled={!customSubUrl.trim()}
                className="flex-1 rounded-lg bg-brand py-2 text-[12px] font-bold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                Add Subtitle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sources & Quality Selection Modal */}
      {showSourcesModal && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowSourcesModal(false)}
        >
          <div
            className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-xl bg-[#18181c] ring-1 ring-white/15"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="text-[13.5px] font-bold text-white">
                Select Stream Source / Quality
              </span>
              <button
                onClick={() => setShowSourcesModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="px-4 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
              Available Sources ({sources.length})
            </div>

            <div className="styled-scroll min-h-0 overflow-y-auto p-2 max-h-[60vh]">
              {sources.map((s) => (
                <button
                  key={s.key}
                  onClick={() => handlePickSource(s.key)}
                  disabled={!!isSwitchingSource}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-white/5 disabled:opacity-60"
                >
                  <span className="w-4 shrink-0 text-center text-[13px] font-bold text-brand">
                    {s.key === currentKey ? "✓" : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-white">
                      {s.quality && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
                          {s.quality}
                        </span>
                      )}
                      {s.size && <span className="text-neutral-400">{s.size}</span>}
                      {s.audio && <span className="text-brand font-normal">{s.audio}</span>}
                    </div>
                    {s.source && (
                      <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                        {s.source}
                      </span>
                    )}
                  </div>
                  {isSwitchingSource === s.key && (
                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
