"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "@/components/Icons";
import type { SourceMini } from "./SitePlayer";

type Props = {
  /** remount id (one per player open - same-type hops must NOT remount) */
  mountId: string;
  url: string;
  title: string;
  sources: SourceMini[];
  currentKey: string;
  /** resume position in seconds (0 = from the start) */
  startAt: number;
  /** resolve a source key to a playable file url (null = failed) */
  onPickSource: (key: string) => Promise<string | null>;
  /** sidecar subtitle tracks (OFF hides; first Hindi/English auto-loads) */
  subtitles?: { url: string; name: string; lang: string }[];
  onTimeupdate?: (time: number, duration?: number) => void;
  onError?: () => void;
  onVlc?: () => void;
  onDownload?: () => void;
  onReport?: () => void;
};

/** stream family: HLS (.m3u8) / DASH (.mpd) / progressive file */
export const streamKind = (u: string): "hls" | "dash" | "file" =>
  /\.m3u8(\?|#|$)/i.test(u) ? "hls" : /\.mpd(\?|#|$)/i.test(u) ? "dash" : "file";

/* Smart player (ArtPlayer + hls.js + dash.js): plays HLS, DASH and
 * progressive files with VLC-style in-player menus - Quality, Audio
 * language, Server, Subtitles (sidecar) and a source panel - plus VLC,
 * Download and Report controls. Menus hop between source rows (each
 * row is one encode/dub); language hops preserve position (same
 * content, other dub). HLS alternate-audio renditions auto-prefer
 * Hindi with an on-screen notice. One mount plays one stream family -
 * consumers remount across families via the React key (same-type hops
 * use seamless switchUrl). Unmuted autoplay falls back to muted +
 * notice when the browser blocks it (no dead spinner). */
export default function SmartPlayer({
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
  const live = useRef({ key: currentKey, server: "", quality: "Auto", sub: "OFF", audio: "", busy: false });
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
      set("subtitles", live.current.sub);
      set("audio", live.current.audio || "Audio");
    } catch {}
  }, []);
  const pendingSeek = useRef<number | null>(null);
  const [panel, setPanel] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [pickFail, setPickFail] = useState(false);

  /* mount once per mountId */
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
        const kind = streamKind(init.url);
        const SUB_OPTS = {
          type: "srt",
          encoding: "utf-8",
          style: { color: "#ffffff", "font-size": "20px" },
        };
        if (defSub) live.current.sub = defSub.name || defSub.lang || "CC";
        const hopToRow = (rowKey: string | undefined) => {
          if (!rowKey || rowKey === live.current.key || live.current.busy) return;
          live.current.busy = true;
          Promise.resolve(cbs.current.onPickSource(rowKey))
            .then((file) => {
              if (!file) syncSelectorLabels();
            })
            .catch(() => syncSelectorLabels())
            .finally(() => {
              live.current.busy = false;
            });
        };
        const art = new Artplayer({
          container: host.current,
          url: init.url,
          type: kind === "hls" ? "m3u8" : kind === "dash" ? "mpd" : "mp4",
          customType: {
            m3u8: async (video: any, src: string) => {
              try {
                const HlsMod = (await import("hls.js")) as any;
                const Hls = HlsMod.default || HlsMod;
                if (Hls.isSupported()) {
                  const hls = new Hls({ maxBufferLength: 30 });
                  hlsRef.current = hls;
                  try {
                    hls.on(Hls.Events.MANIFEST_PARSED, (_e: any, data: any) => {
                      try {
                        const tracks = (data && data.audioTracks) || hls.audioTracks || [];
                        if (tracks.length > 1) {
                          const idx = tracks.findIndex((t: any) =>
                            /hindi|\bhin\b/i.test(`${t.name || ""} ${t.lang || ""}`)
                          );
                          if (idx > 0) hls.audioTrack = idx;
                          const n = idx >= 0 ? idx : hls.audioTrack;
                          const cur = tracks[n] || {};
                          art.notice.show = `Audio: ${cur.name || cur.lang || `track ${n + 1}`} (${tracks.length} tracks)`;
                        }
                      } catch {}
                    });
                  } catch {}
                  hls.loadSource(src);
                  hls.attachMedia(video);
                } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                  video.src = src; /* Safari plays HLS natively */
                }
              } catch {}
            },
            mpd: async (video: any, src: string) => {
              try {
                const mod = (await import("dashjs")) as any;
                const dj = mod?.default || mod;
                const p = dj.MediaPlayer().create();
                dashRef.current = p;
                p.initialize(video, src, true);
              } catch {}
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
          volume: 0.8,
          autoplay: true,
          muted: false,
          playsInline: true,
          miniProgressBar: true,
          pip: true,
          fullscreen: true,
          lock: true,
          playbackRate: true,
          aspectRatio: true,
          flip: true,
          hotkey: true,
          screenshot: true,
          controls: [
            ...(audioItems.length > 1
              ? [
                  {
                    name: "audio",
                    position: "right",
                    html: live.current.audio || "Audio",
                    tooltip: "Audio language",
                    selector: audioItems,
                    onSelect: (item: any) => {
                      try {
                        const a = item && (item as any).audio;
                        if (a && a !== live.current.audio) {
                          const rows = sourcesRef.current;
                          try {
                            const t = art.video?.currentTime;
                            if (typeof t === "number" && t > 5) pendingSeek.current = t;
                          } catch {}
                          try {
                            art.notice.show = `Audio: ${a}`;
                          } catch {}
                          const row =
                            rows.find((s) => langOf(s) === a && s.quality === live.current.quality) ||
                            rows.find((s) => langOf(s) === a);
                          hopToRow(row?.key);
                        }
                      } catch {}
                    },
                  },
                ]
              : []),
            ...(qualItems.length > 1
              ? [
                  {
                    name: "quality_new",
                    position: "right",
                    html: live.current.quality,
                    tooltip: "Select quality",
                    selector: qualItems,
                    onSelect: (item: any) => {
                      try {
                        const q = item && (item as any).quality;
                        if (q && q !== live.current.quality) {
                          const rows = sourcesRef.current;
                          const row =
                            rows.find(
                              (s) => s.quality === q && s.source === live.current.server
                            ) || rows.find((s) => s.quality === q);
                          hopToRow(row?.key);
                        }
                      } catch {}
                    },
                  },
                ]
              : []),
            ...(serverItems.length > 1
              ? [
                  {
                    name: "servers",
                    position: "right",
                    html: live.current.server,
                    tooltip: "Select server",
                    selector: serverItems,
                    onSelect: (item: any) => {
                      try {
                        const sv = item && (item as any).server;
                        if (sv && sv !== live.current.server) {
                          const rows = sourcesRef.current;
                          const row =
                            rows.find(
                              (s) => s.source === sv && s.quality === live.current.quality
                            ) || rows.find((s) => s.source === sv);
                          hopToRow(row?.key);
                        }
                      } catch {}
                    },
                  },
                ]
              : []),
            ...(subItems.length
              ? [
                  {
                    name: "subtitles",
                    position: "right",
                    html: live.current.sub,
                    tooltip: "Select subtitle",
                    selector: [{ html: "OFF", off: true }, ...subItems],
                    onSelect: (item: any) => {
                      try {
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
              : []),
            {
              name: "vlc",
              position: "right",
              html: "VLC",
              tooltip: "Open in VLC",
              click: () => cbs.current.onVlc?.(),
            },
            {
              name: "download",
              position: "right",
              html: "⬇",
              tooltip: "Download",
              click: () => cbs.current.onDownload?.(),
            },
            {
              name: "sources",
              position: "right",
              html: "☰",
              tooltip: "Select source",
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
        /* autoplay with sound is often blocked after a long background
         * fetch (no recent tap): fall back to muted + notice rather
         * than a dead spinner - one tap on volume restores sound */
        try {
          const pr = (art.video as HTMLVideoElement)?.play?.();
          (pr as Promise<void> | undefined)?.catch?.(() => {
            try {
              art.muted = true;
              (art.video as HTMLVideoElement)?.play?.()?.catch?.(() => {});
              art.notice.show = "Tap the volume icon for sound";
            } catch {}
          });
        } catch {}
        if (init.startAt > 0) {
          const v = art.video as HTMLVideoElement | undefined;
          const apply = () => {
            try {
              if (v && isFinite(v.duration) && init.startAt < v.duration)
                v.currentTime = init.startAt;
            } catch {}
          };
          if (v) {
            if (v.readyState >= 1) apply();
            else v.addEventListener("loadedmetadata", apply, { once: true });
          }
        }
        art.on("error", () => {
          if (!dead) cbs.current.onError?.();
        });
        const v = art.video as HTMLVideoElement | undefined;
        v?.addEventListener("timeupdate", () => {
          if (!dead)
            cbs.current.onTimeupdate?.(
              v.currentTime,
              isFinite(v.duration) ? v.duration : undefined
            );
        });
      } catch {
        if (!dead) cbs.current.onError?.();
      }
    })();
    return () => {
      dead = true;
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

  /* same-family hops: seamless url swap. Cross-family hops remount via
   * the consumer's key (switchUrl can't swap engines). */
  useEffect(() => {
    const art = artRef.current;
    if (art && url && url !== appliedUrl.current) {
      appliedUrl.current = url;
      try {
        art.switchUrl(url);
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
  }, [url, title, currentKey, sources]);

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

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={host} className="h-full w-full" />
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
              <span className="text-[13px] font-bold">Select Stream Source</span>
              <button
                onClick={() => setPanel(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Available sources
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
                      {s.audio && <span className="font-normal">{s.audio}</span>}
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
                Couldn&apos;t auto-load — try another source.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
