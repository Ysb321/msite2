"use client";

import Link from "next/link";
import { useKeyboardShortcuts } from "@/context/KeyboardShortcutsContext";
import { Keyboard } from "lucide-react";

export default function Footer() {
  const { openShortcuts } = useKeyboardShortcuts();

  return (
    <footer className="mt-14 border-t border-white/10 px-[4vw] py-10 text-[12.5px] text-neutral-500">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/home" className="hover:text-neutral-300">Home</Link>
          <Link href="/movies" className="hover:text-neutral-300">Movies</Link>
          <Link href="/tv" className="hover:text-neutral-300">TV Shows</Link>
          <Link href="/anime" className="hover:text-neutral-300">Anime</Link>
          <Link href="/categories" className="hover:text-neutral-300">Categories</Link>
          <Link href="/my-list" className="hover:text-neutral-300">My List</Link>
          <button
            onClick={openShortcuts}
            className="flex items-center gap-1.5 text-neutral-400 transition hover:text-white cursor-pointer"
          >
            <Keyboard className="h-3.5 w-3.5" />
            <span>Keyboard Shortcuts</span>
            <kbd className="rounded border border-white/20 bg-neutral-800 px-1 py-0.2 text-[9px] text-white">?</kbd>
          </button>
        </div>
        <p className="mb-2 text-[12px] font-semibold text-neutral-400">
          Yetflix — crafted with 🍿 by <span className="text-neutral-200">Yashraj</span>
        </p>
      </div>
    </footer>
  );
}

