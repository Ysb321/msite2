"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Keyboard,
  X,
  Compass,
  Search,
  Bookmark,
  Film,
  Tv,
  Sparkles,
  Layers,
  User,
  SlidersHorizontal,
  ArrowDown,
  ArrowUp,
  Maximize,
  Volume2,
  Play,
  RotateCcw,
  Check,
} from "lucide-react";

export interface ShortcutItem {
  keys: string[];
  label: string;
  description: string;
  category: "navigation" | "control" | "playback";
  action?: () => void;
}

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteShortcut: (key: string) => void;
}

export default function KeyboardShortcutsModal({
  isOpen,
  onClose,
  onExecuteShortcut,
}: KeyboardShortcutsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Close on Escape key and handle tab focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAction = (shortcutKey: string) => {
    onExecuteShortcut(shortcutKey);
    setCopiedKey(shortcutKey);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  return (
    <div
      id="keyboard-shortcuts-modal"
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-dialog-title"
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/20 bg-[#121217]/95 shadow-[0_25px_60px_rgba(0,0,0,0.9)] backdrop-blur-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4.5 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/20 text-brand ring-1 ring-brand/40 shadow-inner">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="shortcuts-dialog-title"
                className="text-lg font-bold tracking-wide text-white"
              >
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-neutral-400">
                Speed through Yetflix with instant key navigation
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close shortcuts dialog"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Shortcut Cards */}
        <div className="styled-scroll flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: Navigation */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Compass className="h-4 w-4 text-sky-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Instant Navigation
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ShortcutCard
                keys={["H"]}
                label="Home"
                description="Go to Homepage"
                icon={<Compass className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("h")}
              />
              <ShortcutCard
                keys={["S", "/"]}
                label="Search"
                description="Focus search bar / Search page"
                icon={<Search className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("s")}
              />
              <ShortcutCard
                keys={["L"]}
                label="My List"
                description="Open your saved watchlist"
                icon={<Bookmark className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("l")}
              />
              <ShortcutCard
                keys={["M"]}
                label="Movies"
                description="Browse blockbuster movies"
                icon={<Film className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("m")}
              />
              <ShortcutCard
                keys={["T"]}
                label="TV Shows"
                description="Explore series & anime"
                icon={<Tv className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("t")}
              />
              <ShortcutCard
                keys={["A"]}
                label="Anime"
                description="Anime hub & simulcasts"
                icon={<Sparkles className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("a")}
              />
              <ShortcutCard
                keys={["C"]}
                label="Categories"
                description="Genres and collections"
                icon={<Layers className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("c")}
              />
              <ShortcutCard
                keys={["P"]}
                label="Profiles"
                description="Switch or manage profiles"
                icon={<User className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("p")}
              />
            </div>
          </div>

          {/* Section 2: Browsing & UI Controls */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Browsing & Modals
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ShortcutCard
                keys={["Esc"]}
                label="Close / Escape"
                description="Close modal, video, or unfocus search"
                icon={<X className="h-4 w-4 text-neutral-300" />}
                onClick={onClose}
              />
              <ShortcutCard
                keys={["?"]}
                label="Shortcut Guide"
                description="Toggle this cheat sheet modal"
                icon={<Keyboard className="h-4 w-4 text-neutral-300" />}
                onClick={() => {}}
              />
              <ShortcutCard
                keys={["J"]}
                label="Scroll Down"
                description="Smoothly scroll feed downwards"
                icon={<ArrowDown className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("j")}
              />
              <ShortcutCard
                keys={["K"]}
                label="Scroll Up"
                description="Smoothly scroll feed upwards"
                icon={<ArrowUp className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("k")}
              />
              <ShortcutCard
                keys={["G"]}
                label="Top of Page"
                description="Instant jump to feed top"
                icon={<RotateCcw className="h-4 w-4 text-neutral-300" />}
                onClick={() => handleAction("g")}
              />
            </div>
          </div>

          {/* Section 3: Video Playback */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Play className="h-4 w-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Video Player Controls
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ShortcutCard
                keys={["Space"]}
                label="Play / Pause"
                description="Toggle video playback state"
                icon={<Play className="h-4 w-4 text-neutral-300" />}
              />
              <ShortcutCard
                keys={["F"]}
                label="Fullscreen"
                description="Toggle fullscreen mode"
                icon={<Maximize className="h-4 w-4 text-neutral-300" />}
              />
              <ShortcutCard
                keys={["M"]}
                label="Mute / Unmute"
                description="Toggle audio volume in player"
                icon={<Volume2 className="h-4 w-4 text-neutral-300" />}
              />
              <ShortcutCard
                keys={["←", "→"]}
                label="Seek 10s"
                description="Rewind / Fast-forward 10 seconds"
                icon={<RotateCcw className="h-4 w-4 text-neutral-300" />}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 bg-white/[0.02] px-6 py-3.5 text-center text-xs text-neutral-400 flex items-center justify-between">
          <span>Press any key while browsing to trigger the action</span>
          <span className="flex items-center gap-1.5 font-medium text-neutral-300">
            Press <kbd className="rounded border border-white/20 bg-neutral-800 px-1.5 py-0.5 text-[10px] text-white">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

interface ShortcutCardProps {
  keys: string[];
  label: string;
  description: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}

function ShortcutCard({
  keys,
  label,
  description,
  icon,
  onClick,
}: ShortcutCardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "group flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-3 transition hover:border-white/25 hover:bg-white/[0.08]",
        onClick ? "cursor-pointer" : "cursor-default"
      )}
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/40 ring-1 ring-white/10 group-hover:ring-white/25">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-neutral-200 group-hover:text-white">
            {label}
          </p>
          <p className="truncate text-[11px] text-neutral-400">{description}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 pl-2">
        {keys.map((k) => (
          <kbd
            key={k}
            className="flex min-w-[24px] h-6 items-center justify-center rounded-md border border-white/20 bg-neutral-800 px-1.5 text-[11px] font-bold text-white shadow group-hover:border-white/40 group-hover:bg-neutral-700"
          >
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
}
