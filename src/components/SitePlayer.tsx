"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "@/components/Icons";

export type SourceMini = {
  key: string;
  quality: string;
  size: string;
  source: string;
  file: string;
  audio: string;
  /** per-row audio language - the audio selector keys on this when present */
  lang?: string;
};

type Props = {
  /** remount id (one per player open - source hops must NOT remount) */
  mountId: string;
  url: string;
  title: string;
  sources: SourceMini[];
  currentKey: string;
  /** resume position in seconds (0 = from the start) */
  startAt: number;
  /** resolve a source key to a playable file url (null = failed) */
  onPickSource: (key: string) => Promise<string | null>;
  /** subtitle tracks - Hindi auto-loads first */
  subtitles?: { url: string; name: string; lang: string }[];
  onTimeupdate?: (time: number, duration?: number) => void;
  onError?: () => void;
  onVlc?: () => void;
  onDownload?: () => void;
  onReport?: () => void;
  /** "netmirror": NetMirror's own ArtPlayer config */
  variant?: "netmirror" | "default";
  /** show the in-player audio-language selector */
  showAudio?: boolean;
};

export type StreamAudioTrack = {
  id: string | number;
  index: number;
  label: string;
  language: string;
  enabled: boolean;
  type: "hls" | "dash" | "native";
  raw?: any;
};

export default function SitePlayer({
  mountId,
  url,
  title,
  sources,
  currentKey,
  startAt,
  subtitles,
  onPickSource,
  onTimeupdate,
  onError,
  onVlc,
  onDownload,
  onReport,
  variant,
  showAudio = true,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);
  const dashRef = useRef<any>(null);
  const appliedUrl = useRef<string>("");
  const cbs = useRef({ onError, onVlc, onDownload, onReport, onPickSource, onTimeupdate });
  cbs.current = { onError, onVlc, onDownload, onReport, onPickSource, onTimeupdate };

  const mountVals = useRef({ url, title, startAt, subs: subtitles });
  mountVals.current = { url, title, startAt, subs: subtitles };

  const live = useRef({
    key: currentKey,
    server: "",
    quality: "Auto",
    sub: "OFF",
    audio: "",
    busy: false,
  });

  // Dynamic In-Stream Audio Tracks (from HLS, DASH, or HTML5 container)
  const [streamAudioTracks, setStreamAudioTracks] = useState<StreamAudioTrack[]>([]);
  const [activeAudioIndex, setActiveAudioIndex] = useState<number>(0);

  // Error & Recovery State
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState<boolean>(false);

  // Audio Processing State (Web Audio API)
  const [audioBoost, setAudioBoost] = useState<number>(100);
  const [dialogueEnhance, setDialogueEnhance] = useState<boolean>(false);
  const [nightMode, setNightMode] = useState<boolean>(false);
  const [showAudioModal, setShowAudioModal] = useState<boolean>(false);
  const [showCustomSubModal, setShowCustomSubModal] = useState<boolean>(false);
  const [customSubUrl, setCustomSubUrl] = useState<string>("");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const eqNodeRef = useRef<BiquadFilterNode | null>(null);
  const compNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const audioInitializedRef = useRef<boolean>(false);
  const autoProxyTried = useRef<boolean>(false);

  {
    const cur = sources.find((s) => s.key === currentKey) || sources[0];
    live.current.key = currentKey;
    live.current.server = cur?.source || "";
    live.current.quality = cur?.quality || "Auto";
    live.current.audio = ((cur?.lang || cur?.audio) || "").trim();
  }

  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const serverItems = Array.from(new Set(sources.map((s) => s.source || "Server"))).map(
    (sv) => ({ html: sv, server: sv })
  );
  const qualItems = Array.from(new Set(sources.map((s) => s.quality || "Auto"))).map((q) => ({
    html: q,
    quality: q,
  }));
  const subItems = (subtitles || []).map((s) => ({
    html: s.name || s.lang || "CC",
    url: s.url,
  }));
  const langOf = (s: SourceMini) => ((s.lang || s.audio) || "").trim();
  const audioItems = Array.from(new Set(sources.map(langOf).filter(Boolean))).map((a) => ({
    html: a,
    audio: a,
  }));

  const syncSelectorLabels = useCallback(() => {
    try {
      const set = (name: string, val: string) => {
        const el = host.current?.querySelector(`.art-control-${name} .art-selector-value`);
        if (el && val) el.textContent = val;
      };
      set("servers", live.current.server);
      set("quality_new", live.current.quality);
      set("quality", live.current.quality);
      set("subtitles", live.current.sub);
      set("audio", live.current.audio || "Audio");
    } catch {}
  }, []);

  const pendingSeek = useRef<number | null>(null);
  const [panel, setPanel] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [pickFail, setPickFail] = useState(false);

  // Setup Web Audio processing for Volume Boost & Dialogue Enhancement
  const initWebAudio = useCallback(() => {
    if (audioInitializedRef.current || !artRef.current?.video) return;
    try {
      const video = artRef.current.video as HTMLVideoElement;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      const sourceNode = ctx.createMediaElementSource(video);

      const gain = ctx.createGain();
      gain.gain.value = audioBoost / 100;

      const eq = ctx.createBiquadFilter();
      eq.type = "peaking";
      eq.frequency.value = 2500;
      eq.Q.value = 1.0;
      eq.gain.value = dialogueEnhance ? 6 : 0;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 30;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;

      sourceNode.connect(eq);
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
      audioInitializedRef.current = true;
    } catch (e) {
      console.warn("[SitePlayer] Web Audio API init skipped:", e);
    }
  }, [audioBoost, dialogueEnhance, nightMode]);

  // Update Gain
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      try {
        gainNodeRef.current.gain.setValueAtTime(audioBoost / 100, audioCtxRef.current.currentTime);
      } catch {}
    }
  }, [audioBoost]);

  // Update EQ
  useEffect(() => {
    if (eqNodeRef.current && audioCtxRef.current) {
      try {
        eqNodeRef.current.gain.setValueAtTime(dialogueEnhance ? 6 : 0, audioCtxRef.current.currentTime);
      } catch {}
    }
  }, [dialogueEnhance]);

  // Dynamic Audio Track Switcher (HLS, DASH, or HTML5 native)
  const selectAudioTrack = useCallback((track: StreamAudioTrack) => {
    try {
      if (track.type === "hls" && hlsRef.current) {
        hlsRef.current.audioTrack = track.index;
        setActiveAudioIndex(track.index);
        live.current.audio = track.label;
        syncSelectorLabels();
        try {
          artRef.current?.notice?.show?.(`Audio Track: ${track.label}`);
        } catch {}
      } else if (track.type === "dash" && dashRef.current) {
        dashRef.current.setCurrentTrack(track.raw);
        setActiveAudioIndex(track.index);
        live.current.audio = track.label;
        syncSelectorLabels();
        try {
          artRef.current?.notice?.show?.(`Audio Track: ${track.label}`);
        } catch {}
      } else if (track.type === "native" && artRef.current?.video) {
        const video = artRef.current.video as any;
        const tracks = video.audioTracks;
        if (tracks && tracks.length > track.index) {
          for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = i === track.index;
          }
          setActiveAudioIndex(track.index);
          live.current.audio = track.label;
          syncSelectorLabels();
          try {
            artRef.current?.notice?.show?.(`Audio Track: ${track.label}`);
          } catch {}
        }
      }
    } catch (e) {
      console.warn("[SitePlayer] Error switching audio track:", e);
    }
  }, [syncSelectorLabels]);

  // Scan HTML5 native audio tracks
  const scanNativeAudioTracks = useCallback((video: HTMLVideoElement) => {
    try {
      const tracks = (video as any).audioTracks;
      if (tracks && tracks.length > 0) {
        const list: StreamAudioTrack[] = [];
        let activeIdx = 0;
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
              ? `Audio ${lang.toUpperCase()}`
              : `Track ${i + 1}`);
          list.push({
            id: t.id || String(i),
            index: i,
            label,
            language: lang,
            enabled: !!t.enabled,
            type: "native",
          });
          if (t.enabled) activeIdx = i;
        }
        setStreamAudioTracks(list);
        setActiveAudioIndex(activeIdx);
      }
    } catch {}
  }, []);

  // Graceful Retry / Proxy Recovery
  const handleRetryWithProxy = useCallback(() => {
    if (!artRef.current) return;
    setIsRecovering(true);
    setPlayerError(null);
    try {
      let currentSrc = appliedUrl.current || url;
      if (!currentSrc.includes("/api/stream/proxy/")) {
        const b64 = window.btoa(unescape(encodeURIComponent(currentSrc)));
        currentSrc = `/api/stream/proxy/video.mp4?b64=${encodeURIComponent(b64)}`;
      }
      appliedUrl.current = currentSrc;
      artRef.current.switchUrl(currentSrc);
      setTimeout(() => {
        setIsRecovering(false);
      }, 1500);
    } catch {
      setIsRecovering(false);
    }
  }, [url]);

  const handleSimpleRetry = useCallback(() => {
    if (!artRef.current) return;
    setIsRecovering(true);
    setPlayerError(null);
    try {
      const currentSrc = appliedUrl.current || url;
      artRef.current.switchUrl(currentSrc);
      setTimeout(() => {
        setIsRecovering(false);
      }, 1500);
    } catch {
      setIsRecovering(false);
    }
  }, [url]);

  // Mount effect
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { default: Artplayer } = (await import("artplayer")) as any;
        if (dead || !host.current) return;
        const init = mountVals.current;
        appliedUrl.current = init.url;
        const subs = (init.subs || []) as { url: string; name: string; lang: string }[];
        const defSub =
          subs.find((s) => s.lang.toLowerCase().startsWith("hi")) ||
          subs.find((s) => s.lang.toLowerCase().startsWith("en")) ||
          subs[0];

        const isHls = /\.m3u8(\?|#|$)/i.test(init.url);
        const isDash = /\.mpd(\?|#|$)/i.test(init.url);

        const SUB_OPTS = {
          type: "srt",
          encoding: "utf-8",
          style: { color: "#ffffff", "font-size": "20px" },
        };
        if (defSub) live.current.sub = defSub.name || defSub.lang || "CC";

        const hopToRow = (rowKey: string | undefined) => {
          if (!rowKey || rowKey === live.current.key || live.current.busy) return;
          live.current.busy = true;
          try {
            const t = art.video?.currentTime;
            if (typeof t === "number" && t > 5) pendingSeek.current = t;
          } catch {}
          Promise.resolve(cbs.current.onPickSource(rowKey))
            .then((file) => {
              if (!file) syncSelectorLabels();
            })
            .catch(() => syncSelectorLabels())
            .finally(() => {
              live.current.busy = false;
            });
        };

        const fullUrl =
          init.url && init.url.startsWith("/") && typeof window !== "undefined"
            ? `${window.location.origin}${init.url}`
            : init.url;

        const art = new Artplayer({
          container: host.current,
          url: fullUrl,
          type: isHls ? "m3u8" : isDash ? "mpd" : "mp4",
          customType: {
            m3u8: async (video: HTMLVideoElement, src: string) => {
              try {
                if (hlsRef.current) {
                  hlsRef.current.destroy();
                  hlsRef.current = null;
                }
                const { default: Hls } = (await import("hls.js")) as any;
                if (Hls.isSupported()) {
                  const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 60,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 600,
                    xhrSetup: (xhr: XMLHttpRequest) => {
                      xhr.withCredentials = false;
                    },
                  });
                  hlsRef.current = hls;

                  // Parse HLS Dynamic Audio Tracks
                  const parseHlsAudio = () => {
                    try {
                      if (hls.audioTracks && hls.audioTracks.length > 0) {
                        const tracks: StreamAudioTrack[] = hls.audioTracks.map(
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
                                ? `Audio ${t.lang.toUpperCase()}`
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
                        setStreamAudioTracks(tracks);
                        setActiveAudioIndex(hls.audioTrack >= 0 ? hls.audioTrack : 0);
                      }
                    } catch {}
                  };

                  hls.on(Hls.Events.MANIFEST_PARSED, parseHlsAudio);
                  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, parseHlsAudio);
                  hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_: any, data: any) => {
                    setActiveAudioIndex(data.id);
                  });

                  // Robust HLS Error Recovery
                  hls.on(Hls.Events.ERROR, (_: any, data: any) => {
                    if (data.fatal) {
                      switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                          console.warn("[HLS] Fatal network error, trying to recover...");
                          hls.startLoad();
                          break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                          console.warn("[HLS] Fatal media error, recovering media...");
                          hls.recoverMediaError();
                          break;
                        default:
                          console.error("[HLS] Unrecoverable fatal error:", data);
                          setPlayerError("Stream network issue or expired manifest token.");
                          if (!dead) cbs.current.onError?.();
                          break;
                      }
                    }
                  });

                  hls.loadSource(src);
                  hls.attachMedia(video);
                } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                  video.src = src;
                }
              } catch (e) {
                console.warn("[SitePlayer] Hls.js init error:", e);
              }
            },
            mpd: async (video: HTMLVideoElement, src: string) => {
              try {
                if (dashRef.current) {
                  dashRef.current.reset();
                  dashRef.current = null;
                }
                const dashjs = (await import("dashjs")) as any;
                const MediaPlayer = dashjs.MediaPlayer || dashjs.default?.MediaPlayer;
                if (MediaPlayer) {
                  const dash = MediaPlayer().create();
                  dashRef.current = dash;

                  dash.updateSettings({
                    streaming: {
                      lowLatencyEnabled: true,
                      abr: {
                        autoSwitchBitrate: {
                          video: true,
                          audio: true,
                        },
                      },
                    },
                  });

                  dash.on(
                    dashjs.MediaPlayer.events.TRACKS_ADDED,
                    () => {
                      try {
                        const audioTracks = dash.getTracksFor("audio");
                        if (audioTracks && audioTracks.length > 0) {
                          const tracks: StreamAudioTrack[] = audioTracks.map(
                            (t: any, idx: number) => {
                              const isHi =
                                /hi|hindi/i.test(t.lang || "") ||
                                (t.labels &&
                                  t.labels.some((l: any) => /hindi/i.test(l.text || "")));
                              const isEn =
                                /en|english/i.test(t.lang || "") ||
                                (t.labels &&
                                  t.labels.some((l: any) => /english/i.test(l.text || "")));
                              const label =
                                t.labels?.[0]?.text ||
                                (isHi
                                  ? "🇮🇳 Hindi"
                                  : isEn
                                  ? "🌐 English"
                                  : t.lang
                                  ? `Audio ${t.lang.toUpperCase()}`
                                  : `Track ${idx + 1}`);
                              return {
                                id: t.id ?? idx,
                                index: idx,
                                label,
                                language: t.lang || "",
                                enabled: idx === 0,
                                type: "dash",
                                raw: t,
                              };
                            }
                          );
                          setStreamAudioTracks(tracks);
                        }
                      } catch {}
                    }
                  );

                  dash.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
                    console.warn("[DASH] Stream error:", e);
                    setPlayerError("DASH playback encountered an error.");
                  });

                  dash.initialize(video, src, true);
                }
              } catch (e) {
                console.warn("[SitePlayer] DASH.js init error:", e);
              }
            },
          },
          ...(defSub
            ? {
                subtitle: {
                  url: defSub.url,
                  type: "srt",
                  encoding: "utf-8",
                  style: { color: "#ffffff", "font-size": "20px" },
                },
              }
            : {}),
          title: init.title,
          theme: "#e50914",
          volume: 0.85,
          autoplay: true,
          muted: false,
          playsInline: true,
          miniProgressBar: false,
          pip: true,
          fullscreen: true,
          fullscreenWeb: true,
          lock: true,
          playbackRate: true,
          aspectRatio: true,
          flip: true,
          hotkey: true,
          screenshot: true,
          controls: [
            ...(qualItems.length > 1
              ? [
                  {
                    name: "quality",
                    position: "right",
                    html: live.current.quality || "Quality",
                    tooltip: "Select resolution",
                    selector: qualItems,
                    onSelect: (item: any) => {
                      try {
                        const q = item && (item as any).quality;
                        if (q && q !== live.current.quality) {
                          const rows = sourcesRef.current;
                          const row =
                            rows.find(
                              (s) =>
                                s.quality === q && s.source === live.current.server
                            ) || rows.find((s) => s.quality === q);
                          hopToRow(row?.key);
                        }
                      } catch {}
                    },
                  },
                ]
              : []),
            ...(showAudio
              ? [
                  {
                    name: "audio",
                    position: "right",
                    html: live.current.audio || "🇮🇳 Audio",
                    tooltip: "Audio Language / Dual Dub",
                    selector: [
                      ...(audioItems.length > 0
                        ? audioItems
                        : [
                            { html: "🇮🇳 Hindi (Default)", audio: "Hindi" },
                            { html: "🌐 English Dual Audio", audio: "English" },
                          ]),
                      { html: "🎛️ Audio Booster & EQ…", audio: "__open_audio_modal__" },
                    ],
                    onSelect: (item: any) => {
                      try {
                        const a = item && (item as any).audio;
                        if (a === "__open_audio_modal__") {
                          setShowAudioModal(true);
                          return;
                        }
                        if (a && a !== live.current.audio) {
                          const rows = sourcesRef.current;
                          const row =
                            rows.find((s) => langOf(s) === a && s.quality === live.current.quality) ||
                            rows.find((s) => langOf(s) === a);
                          if (row) {
                            try {
                              art.notice.show = `Audio: ${a}`;
                            } catch {}
                            hopToRow(row?.key);
                          }
                        }
                      } catch {}
                    },
                  },
                ]
              : []),
            ...(subItems.length > 0
              ? [
                  {
                    name: "subtitles",
                    position: "right",
                    html: live.current.sub,
                    tooltip: "Select subtitle",
                    selector: [
                      { html: "OFF", off: true },
                      ...subItems,
                      { html: "➕ Custom Subtitle…", custom: true },
                    ],
                    onSelect: (item: any) => {
                      try {
                        if (item && (item as any).custom) {
                          setShowCustomSubModal(true);
                          return;
                        }
                        if (item && (item as any).off) {
                          try {
                            art.subtitle.show = false;
                          } catch {}
                          live.current.sub = "OFF";
                          syncSelectorLabels();
                        } else if (item && (item as any).url) {
                          const url = (item as any).url as string;
                          const label = (item as any).html as string;
                          try {
                            art.subtitle.show = true;
                          } catch {}
                          Promise.resolve()
                            .then(() => art.subtitle.switch(url, SUB_OPTS))
                            .then(() => {
                              live.current.sub = label;
                              syncSelectorLabels();
                            })
                            .catch(() => {
                              try {
                                art.notice.show = "Subtitle failed to load";
                              } catch {}
                              syncSelectorLabels();
                            });
                        }
                      } catch {}
                    },
                  },
                ]
              : [
                  {
                    name: "subtitles",
                    position: "right",
                    html: "CC",
                    tooltip: "Subtitles",
                    click: () => setShowCustomSubModal(true),
                  },
                ]),
            {
              name: "audio_fx",
              position: "right",
              html: "🎛️",
              tooltip: "Audio EQ & Booster",
              click: () => setShowAudioModal((prev) => !prev),
            },
            {
              name: "vlc",
              position: "right",
              html: "VLC",
              tooltip: "Open in VLC Player",
              click: () => cbs.current.onVlc?.(),
            },
            {
              name: "download",
              position: "right",
              html: "⬇",
              tooltip: "Direct Download",
              click: () => cbs.current.onDownload?.(),
            },
            {
              name: "sources",
              position: "right",
              html: "☰ Sources",
              tooltip: "Switch stream source / quality",
              click: () => {
                try {
                  art.fullscreen = false;
                } catch {}
                setPanel((p) => !p);
              },
            },
            {
              name: "report",
              position: "right",
              html: "⚠",
              tooltip: "Report issue",
              click: () => cbs.current.onReport?.(),
            },
          ],
        });

        artRef.current = art;

        const v = art.video as HTMLVideoElement | undefined;
        if (v) {
          const onMeta = () => {
            setPlayerError(null);
            scanNativeAudioTracks(v);
            if (init.startAt > 0 && isFinite(v.duration) && init.startAt < v.duration) {
              try {
                v.currentTime = init.startAt;
              } catch {}
            }
          };
          v.addEventListener("loadedmetadata", onMeta);
          v.addEventListener("canplay", () => scanNativeAudioTracks(v));

          // Listen for audioTracks change
          try {
            const tracks = (v as any).audioTracks;
            if (tracks) {
              tracks.addEventListener?.("addtrack", () => scanNativeAudioTracks(v));
              tracks.addEventListener?.("removetrack", () => scanNativeAudioTracks(v));
              tracks.addEventListener?.("change", () => scanNativeAudioTracks(v));
            }
          } catch {}

          v.addEventListener("play", () => {
            initWebAudio();
          });
        }

        art.on("error", (_err: any) => {
          if (!dead) {
            const currentSrc = appliedUrl.current || init.url;
            if (
              !autoProxyTried.current &&
              currentSrc &&
              !currentSrc.includes("/api/stream/proxy") &&
              currentSrc.startsWith("http")
            ) {
              autoProxyTried.current = true;
              console.log("[SitePlayer] Auto-attempting stream proxy fallback for:", currentSrc);
              const b64 = window.btoa(unescape(encodeURIComponent(currentSrc)));
              const proxyUrl = `/api/stream/proxy/video.mp4?b64=${encodeURIComponent(b64)}`;
              appliedUrl.current = proxyUrl;
              art.switchUrl(proxyUrl);
              return;
            }
            setPlayerError("Stream playback error (CORS or format unsupported)");
            cbs.current.onError?.();
          }
        });

        v?.addEventListener("timeupdate", () => {
          if (!dead)
            cbs.current.onTimeupdate?.(
              v.currentTime,
              isFinite(v.duration) ? v.duration : undefined
            );
        });
      } catch {
        if (!dead) {
          setPlayerError("Failed to initialize video player.");
          cbs.current.onError?.();
        }
      }
    })();

    return () => {
      dead = true;
      try {
        audioCtxRef.current?.close();
      } catch {}
      try {
        artRef.current?.destroy();
      } catch {}
      try {
        hlsRef.current?.destroy?.();
      } catch {}
      try {
        dashRef.current?.reset?.();
      } catch {}
      artRef.current = null;
      hlsRef.current = null;
      dashRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountId]);

  // Source / URL update
  useEffect(() => {
    const art = artRef.current;
    if (art && url && url !== appliedUrl.current) {
      appliedUrl.current = url;
      setPlayerError(null);
      try {
        const fullUrl =
          url.startsWith("/") && typeof window !== "undefined"
            ? `${window.location.origin}${url}`
            : url;
        art.switchUrl(fullUrl);
      } catch {}
      if (pendingSeek.current != null) {
        const t = pendingSeek.current;
        pendingSeek.current = null;
        try {
          const v = art.video as HTMLVideoElement | undefined;
          const apply = () => {
            try {
              if (v && isFinite(v.duration) && t > 0 && t < v.duration) v.currentTime = t;
            } catch {}
          };
          v?.addEventListener("loadedmetadata", apply, { once: true });
          if (v && v.readyState >= 1) apply();
        } catch {}
      }
      try {
        art.title = title;
      } catch {}
    }
    syncSelectorLabels();
  }, [url, title, currentKey, sources, syncSelectorLabels]);

  const pick = async (key: string) => {
    if (key === currentKey || connecting) {
      setPanel(false);
      return;
    }
    setConnecting(key);
    setPickFail(false);
    try {
      const file = await cbs.current.onPickSource(key);
      if (file) setPanel(false);
      else setPickFail(true);
    } catch {
      setPickFail(true);
    } finally {
      setConnecting(null);
    }
  };

  const handleApplyCustomSub = () => {
    if (!customSubUrl.trim() || !artRef.current) return;
    try {
      artRef.current.subtitle.show = true;
      artRef.current.subtitle.switch(customSubUrl.trim(), {
        type: customSubUrl.endsWith(".vtt") ? "vtt" : "srt",
        encoding: "utf-8",
        style: { color: "#ffffff", "font-size": "20px" },
      });
      setShowCustomSubModal(false);
    } catch (e) {
      console.warn("Could not load custom subtitle:", e);
    }
  };

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={host} className="h-full w-full" />

      {/* Graceful Player Error State Overlay */}
      {playerError && (
        <div className="absolute inset-0 z-[115] flex flex-col items-center justify-center bg-black/85 p-6 text-center backdrop-blur-xs">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-red-400">
            <span className="text-2xl">⚠️</span>
          </div>
          <h3 className="mt-3 text-[16px] font-bold text-white">Stream Playback Notice</h3>
          <p className="mt-1 max-w-md text-[13px] text-neutral-400">
            {playerError}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <button
              onClick={handleSimpleRetry}
              disabled={isRecovering}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-white/20 disabled:opacity-50"
            >
              🔄 {isRecovering ? "Retrying…" : "Retry Stream"}
            </button>

            <button
              onClick={handleRetryWithProxy}
              disabled={isRecovering}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-[12.5px] font-bold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              🔀 Try Proxy Stream
            </button>

            <button
              onClick={() => setPanel(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-neutral-300 hover:bg-white/20 hover:text-white"
            >
              📂 Switch Server ({sources.length})
            </button>

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
          className="absolute inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
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
              {/* Dynamic In-Stream Audio Tracks (HLS / DASH / MKV) */}
              {streamAudioTracks.length > 0 && (
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
                      Stream Audio Tracks ({streamAudioTracks.length})
                    </span>
                    <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold text-brand">
                      {streamAudioTracks[0].type.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {streamAudioTracks.map((tr) => (
                      <button
                        key={tr.id}
                        onClick={() => selectAudioTrack(tr)}
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

              {/* Volume Booster */}
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
                  onClick={() => setDialogueEnhance((prev) => !prev)}
                  className={`rounded-full px-3 py-1 text-[11.5px] font-bold transition ${
                    dialogueEnhance
                      ? "bg-brand text-white"
                      : "bg-white/10 text-neutral-400 hover:bg-white/20"
                  }`}
                >
                  {dialogueEnhance ? "ON" : "OFF"}
                </button>
              </div>

              {/* Night Mode Compressor */}
              <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                <div>
                  <div className="text-[12.5px] font-semibold text-white">
                    🌙 Night Mode (Normalize Audio)
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    Balances quiet dialogue & loud action
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

      {/* Custom Subtitle Loader Modal */}
      {showCustomSubModal && (
        <div
          className="absolute inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowCustomSubModal(false)}
        >
          <div
            className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-xl bg-[#18181c] p-4 ring-1 ring-white/15"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-[14px] font-bold text-white">Load Subtitle (.srt / .vtt)</span>
              <button
                onClick={() => setShowCustomSubModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="py-3 space-y-3">
              <div>
                <label className="text-[11.5px] font-semibold text-neutral-300">
                  Subtitle URL (SRT or VTT link)
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/subs/hindi.srt"
                  value={customSubUrl}
                  onChange={(e) => setCustomSubUrl(e.target.value)}
                  className="mt-1 w-full rounded-md bg-black/50 px-3 py-2 text-[12px] text-white border border-white/10 focus:border-brand focus:outline-hidden"
                />
              </div>

              <div>
                <label className="text-[11.5px] font-semibold text-neutral-300">
                  Or Upload Local Subtitle File
                </label>
                <input
                  type="file"
                  accept=".srt,.vtt"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const objectUrl = URL.createObjectURL(file);
                      setCustomSubUrl(objectUrl);
                    }
                  }}
                  className="mt-1 block w-full text-[11px] text-neutral-400 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1.5 file:text-[11px] file:font-semibold file:text-white hover:file:bg-white/20"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCustomSubModal(false)}
                className="flex-1 rounded-lg bg-white/10 py-2 text-[12px] font-semibold text-neutral-300 hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyCustomSub}
                disabled={!customSubUrl.trim()}
                className="flex-1 rounded-lg bg-brand py-2 text-[12px] font-bold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                Load Subtitle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Source Switcher Panel */}
      {panel && (
        <div
          className="absolute inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPanel(false)}
        >
          <div
            className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-lg bg-[#141416] ring-1 ring-white/15"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="text-[13px] font-bold">Select Stream Source & Quality</span>
              <button
                onClick={() => setPanel(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Available sources ({sources.length})
            </div>
            <div className="styled-scroll min-h-0 overflow-y-auto p-1.5">
              {sources.map((s) => (
                <button
                  key={s.key}
                  onClick={() => pick(s.key)}
                  disabled={!!connecting}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-white/5 disabled:opacity-60"
                >
                  <span className="w-4 shrink-0 text-center text-[13px] font-bold text-brand">
                    {s.key === currentKey ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold">
                      {s.quality && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
                          {s.quality}
                        </span>
                      )}
                      {s.size && <span className="text-neutral-300">{s.size}</span>}
                      {s.audio && <span className="font-normal text-brand">{s.audio}</span>}
                    </span>
                    {s.source && (
                      <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                        {s.source}
                      </span>
                    )}
                    <span className="block truncate text-[10.5px] text-neutral-600">
                      {s.file}
                    </span>
                  </span>
                  {connecting === s.key && (
                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  )}
                </button>
              ))}
            </div>
            {connecting && (
              <div className="border-t border-white/10 px-3 py-2 text-center text-[12px] font-semibold">
                Connecting to stream…
              </div>
            )}
            {pickFail && !connecting && (
              <div className="border-t border-white/10 px-3 py-2 text-center text-[11.5px] text-amber-300">
                Couldn&apos;t auto-load — try another source in the list.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
