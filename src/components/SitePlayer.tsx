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
  /** per-row audio language (Castle lane) - the audio selector keys on
   *  this when present, falling back to `audio` (Server 9 dubs) */
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
  /** subtitle tracks (NetMirror Hindi lane) - Hindi auto-loads first */
  subtitles?: { url: string; name: string; lang: string }[];
  onTimeupdate?: (time: number, duration?: number) => void;
  onError?: () => void;
  onVlc?: () => void;
  onDownload?: () => void;
  onReport?: () => void;
  /** "netmirror": NetMirror's own ArtPlayer config (light-blue theme,
   *  in-player quality selector, mini progress bar, no source-panel
   *  button) for the NetMirror lanes */
  variant?: "netmirror";
  /** show the in-player audio-language selector (lanes whose rows carry
   *  per-row languages in `lang` (Castle) or `audio` (Server 9's
   *  Hindi/Tamil/Telugu dubs)); hops keep quality + resume position */
  showAudio?: boolean;
};

/* Inbuilt site player (ArtPlayer - the same engine family as Multiverse's
 * player): plays the WebStreamr direct links with a Multiverse-style UI
 * (speed / aspect / flip / lock / screenshot + Download, VLC, source
 * picker and report controls). HLS goes through hls.js; progressive files
 * straight to <video>. Source hops use switchUrl (seamless, resets to 0);
 * resume seeks once after mount. Browser-codec limits still apply
 * (HEVC/Dolby need real VLC) - failures surface via onError and the VLC
 * control stays one tap away. The Hindi lane passes subtitle tracks -
 * Hindi auto-loads first (ArtPlayer's own settings toggle them).
 * variant="netmirror": NetMirror's own player config - #b7daff theme,
 * volume 0.7, mini progress bar, in-player quality selector (their
 * quality_new control shape) wired into onPickSource, no pip/lock/
 * screenshot extras, no source-panel button. Server + subtitle
 * selectors (Cineverse-complete): servers switch platform keeping
 * quality when possible; subtitles switch caption tracks via
 * art.subtitle.switch (OFF hides). onSelect returns void per the 5.4.0
 * types, so labels sync explicitly via syncSelectorLabels.
 * showAudio adds an audio-language selector over sources[].lang
 * (Castle; falls back to sources[].audio for Server 9's dubs); hidden
 * unless 2+ languages. Language hops preserve the viewer's position
 * (pendingSeek) since it is the same content in another dub. */
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
  showAudio,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);
  const appliedUrl = useRef<string>("");
  const cbs = useRef({ onError, onVlc, onDownload, onReport, onPickSource, onTimeupdate });
  cbs.current = { onError, onVlc, onDownload, onReport, onPickSource, onTimeupdate };
  /* fresh mount values every render (the mount effect reads these, so a
   * remount never plays stale props) */
  const mountVals = useRef({ url, title, startAt, subs: subtitles });
  mountVals.current = { url, title, startAt, subs: subtitles };
  /* live mirrors for the mount-frozen selector controls (nm variant) */
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
  /* explicit label sync: onSelect returns void per the 5.4.0 types
   * (ArtPlayer ignores any return), so labels follow truth here - a
   * no-op for controls that don't exist, safe for both variants */
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
  /* pending resume position for language hops (consumed after switchUrl) */
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
        const isHls = /\.m3u8(\?|#|$)/i.test(init.url);
        const VARIANT = variant || "default";
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
          type: isHls ? "m3u8" : "mp4",
          customType: {
            m3u8: async (video: any, src: string) => {
              try {
                const { default: Hls } = (await import("hls.js")) as any;
                if (Hls.isSupported()) {
                  hlsRef.current = new Hls({ maxBufferLength: 30 });
                  hlsRef.current.loadSource(src);
                  hlsRef.current.attachMedia(video);
                } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                  video.src = src; /* Safari plays HLS natively */
                }
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
          theme: VARIANT === "netmirror" ? "#b7daff" : "#e50914",
          volume: VARIANT === "netmirror" ? 0.7 : 0.8,
          autoplay: true,
          muted: false,
          playsInline: true,
          miniProgressBar: VARIANT === "netmirror",
          pip: VARIANT !== "netmirror",
          fullscreen: true,
          lock: VARIANT !== "netmirror",
          playbackRate: true,
          aspectRatio: true,
          flip: true,
          hotkey: true,
          screenshot: VARIANT !== "netmirror",
          controls: [
            ...(showAudio && audioItems.length > 1
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
                          /* language hop: keep the viewer's position (same
                           * content, other dub) */
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
            ...(VARIANT === "netmirror"
              ? [
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
                                    (s) =>
                                      s.source === sv &&
                                      s.quality === live.current.quality
                                  ) || rows.find((s) => s.source === sv);
                                hopToRow(row?.key);
                              }
                            } catch {}
                          },
                        },
                      ]
                    : []),
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
                              (s) =>
                                s.quality === q && s.source === live.current.server
                            ) || rows.find((s) => s.quality === q);
                          hopToRow(row?.key);
                        }
                      } catch {}
                    },
                  },
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
            ...(VARIANT === "netmirror"
              ? []
              : [
                  {
                    name: "sources",
                    position: "right",
                    html: "☰",
                    tooltip: "Select source",
                    click: () => {
                      /* the panel lives outside the art container, so it
                       * can't show over fullscreen - drop out first,
                       * then open */
                      try {
                        art.fullscreen = false;
                      } catch {}
                      setPanel((p) => !p);
                    },
                  },
                ]),
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
      artRef.current = null;
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountId]);

  /* source hops: seamless url swap (position resets - different encode).
   * nm variant: the in-player selector labels follow truth here (no-op
   * when a control doesn't exist, so the default variant is safe). */
  useEffect(() => {
    const art = artRef.current;
    if (art && url && url !== appliedUrl.current) {
      appliedUrl.current = url;
      try {
        art.switchUrl(url);
      } catch {}
      /* language hop: resume where the viewer was (same content) */
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
                Couldn&apos;t auto-load — see Sources list.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
