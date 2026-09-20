"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { MOVIE_GENRES, TV_GENRES } from "@/lib/rows";

const EMOJI: Record<string, string> = {
  Action: "💥", Adventure: "🗺️", Animation: "🎨", Comedy: "😂", Crime: "🕵️",
  Documentary: "🎥", Drama: "🎭", Family: "👨‍👩‍👧", Fantasy: "🐉", History: "📜",
  Horror: "👻", Music: "🎵", Mystery: "🔍", Romance: "💕", "Sci-Fi": "🚀",
  "TV Movie": "📺", Thriller: "🔪", War: "⚔️", Western: "🤠",
  "Action & Adventure": "💥", Kids: "🧒", News: "📰", Reality: "✨",
  "Sci-Fi & Fantasy": "🚀", Soap: "🧼", Talk: "🎙️", "War & Politics": "⚔️",
};

const TILE =
  "group relative flex h-28 flex-col justify-between overflow-hidden rounded-lg border border-white/10 p-3 transition hover:scale-[1.03] hover:border-white/40 md:h-32";

const GRADIENTS = [
  "from-purple-900/80 to-indigo-900/60",
  "from-rose-900/80 to-red-900/60",
  "from-emerald-900/80 to-teal-900/60",
  "from-amber-900/80 to-orange-900/60",
  "from-sky-900/80 to-blue-900/60",
  "from-fuchsia-900/80 to-purple-900/60",
];

export default function CategoriesPage() {
  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <div className="px-[4vw] pb-10 pt-24 md:pt-28">
        <h1 className="mb-6 text-2xl font-bold md:text-3xl">Categories</h1>

        <h2 className="mb-3 text-lg font-semibold text-neutral-300">Movies</h2>
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Object.entries(MOVIE_GENRES).map(([id, name], i) => (
            <Link key={id} href={`/genres/movie/${id}`} className={`${TILE} bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]}`}>
              <span className="text-2xl">{EMOJI[name] ?? "🎬"}</span>
              <span className="text-sm font-bold text-white">{name}</span>
            </Link>
          ))}
        </div>

        <h2 className="mb-3 text-lg font-semibold text-neutral-300">TV Shows</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Object.entries(TV_GENRES).map(([id, name], i) => (
            <Link key={id} href={`/genres/tv/${id}`} className={`${TILE} bg-gradient-to-br ${GRADIENTS[(i + 3) % GRADIENTS.length]}`}>
              <span className="text-2xl">{EMOJI[name] ?? "📺"}</span>
              <span className="text-sm font-bold text-white">{name}</span>
            </Link>
          ))}
        </div>
      </div>
      <Footer />
    </main>
  );
}
