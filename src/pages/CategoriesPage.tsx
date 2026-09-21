"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { MOVIE_GENRES, TV_GENRES } from "@/lib/rows";
import { Film, Tv, Sparkles, Compass } from "lucide-react";

const EMOJI: Record<string, string> = {
  Action: "💥", Adventure: "🗺️", Animation: "🎨", Comedy: "😂", Crime: "🕵️",
  Documentary: "🎥", Drama: "🎭", Family: "👨‍👩‍👧", Fantasy: "🐉", History: "📜",
  Horror: "👻", Music: "🎵", Mystery: "🔍", Romance: "💕", "Sci-Fi": "🚀",
  "TV Movie": "📺", Thriller: "🔪", War: "⚔️", Western: "🤠",
  "Action & Adventure": "💥", Kids: "🧒", News: "📰", Reality: "✨",
  "Sci-Fi & Fantasy": "🚀", Soap: "🧼", Talk: "🎙️", "War & Politics": "⚔️",
};

const TILE =
  "group relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 p-4 transition-all duration-300 hover:scale-[1.03] hover:border-white/40 hover:shadow-[0_12px_24px_rgba(0,0,0,0.6)] backdrop-blur-xl md:h-36";

const GRADIENTS = [
  "from-purple-950/80 via-indigo-950/50 to-neutral-900/90",
  "from-rose-950/80 via-red-950/50 to-neutral-900/90",
  "from-emerald-950/80 via-teal-950/50 to-neutral-900/90",
  "from-amber-950/80 via-orange-950/50 to-neutral-900/90",
  "from-sky-950/80 via-blue-950/50 to-neutral-900/90",
  "from-fuchsia-950/80 via-purple-950/50 to-neutral-900/90",
];

export default function CategoriesPage() {
  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <div className="px-[4vw] pb-16 pt-24 md:pt-28">
        <div className="mb-8 max-w-2xl">
          <div className="mb-2 flex items-center gap-2 text-brand">
            <Compass className="h-5 w-5" />
            <span className="text-xs font-extrabold uppercase tracking-widest text-brand">Browse Library</span>
          </div>
          <h1 className="font-sans text-3xl font-black tracking-tight text-white sm:text-4xl md:text-5xl">
            Explore Categories<span className="text-brand">.</span>
          </h1>
          <p className="mt-2 text-sm font-medium text-neutral-400">
            Dive into thousands of movies, series, documentaries, anime, and regional cinematic hits categorized by genre.
          </p>
        </div>

        {/* Movies Genre Grid */}
        <div className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
              <Film className="h-4 w-4" />
            </div>
            <h2 className="text-xl font-extrabold text-white">Movie Genres</h2>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Object.entries(MOVIE_GENRES).map(([id, name], i) => (
              <Link
                key={id}
                href={`/genres/movie/${id}`}
                className={`${TILE} bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl filter drop-shadow-md transition-transform duration-300 group-hover:scale-125">{EMOJI[name] ?? "🎬"}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100">
                    Explore →
                  </span>
                </div>
                <div>
                  <span className="block text-base font-extrabold text-white tracking-tight group-hover:text-brand transition-colors">{name}</span>
                  <span className="text-[11px] font-semibold text-neutral-400">Movies & Cinema</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* TV Shows Genre Grid */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
              <Tv className="h-4 w-4" />
            </div>
            <h2 className="text-xl font-extrabold text-white">TV & Series Genres</h2>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Object.entries(TV_GENRES).map(([id, name], i) => (
              <Link
                key={id}
                href={`/genres/tv/${id}`}
                className={`${TILE} bg-gradient-to-br ${GRADIENTS[(i + 3) % GRADIENTS.length]}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl filter drop-shadow-md transition-transform duration-300 group-hover:scale-125">{EMOJI[name] ?? "📺"}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100">
                    Explore →
                  </span>
                </div>
                <div>
                  <span className="block text-base font-extrabold text-white tracking-tight group-hover:text-brand transition-colors">{name}</span>
                  <span className="text-[11px] font-semibold text-neutral-400">Shows & Anime</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}

