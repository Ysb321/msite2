"use client";

import Navbar from "@/components/Navbar";
import PullRefresh from "@/components/PullRefresh";
import Footer from "@/components/Footer";
import RowLazy from "@/components/RowLazy";
import TmdbRow from "@/components/TmdbRow";
import BrowseGrid from "@/components/BrowseGrid";
import { ANIME_ROWS, KIDS_ANIME_ROWS } from "@/lib/rows";
import { isKidsActive, onActiveProfileChange } from "@/lib/storage";
import { useEffect, useState } from "react";

/** Anime section — multiple rows of Japanese animation (JP + genre 16). */
export default function AnimePage() {
  const [kids, setKids] = useState(false);
  useEffect(() => {
    const sync = () => setKids(isKidsActive());
    sync();
    return onActiveProfileChange(sync);
  }, []);
  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <PullRefresh>
      <div className="px-[4vw] pb-2 pt-24 md:pt-28">
        <h1 className="font-display text-4xl tracking-wide md:text-5xl">
          Anime<span className="text-brand">.</span>
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Popular, top-rated and fresh-from-Japan series and movies
        </p>
      </div>
      <div className="relative z-10 flex flex-col gap-0.5 pb-6">
        {(kids ? KIDS_ANIME_ROWS : ANIME_ROWS).map((def, i) => (
          <RowLazy key={def.key} reserve={i < 3 ? 340 : 320}>
            <TmdbRow def={def} />
          </RowLazy>
        ))}
      </div>
      </PullRefresh>
      <BrowseGrid options={{ type: "tv", heading: kids ? "Anime for Kids" : "Browse All Anime", preset: kids ? "anime-kids" : "anime" }} />
      <Footer />
    </main>
  );
}
