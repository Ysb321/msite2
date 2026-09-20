"use client";

import Navbar from "@/components/Navbar";
import PullRefresh from "@/components/PullRefresh";
import Footer from "@/components/Footer";
import BrowseGrid from "@/components/BrowseGrid";
import RowLazy from "@/components/RowLazy";
import TmdbRow from "@/components/TmdbRow";
import { TV_ROWS } from "@/lib/rows";

/** TV section — curated rows, then the full browse grid below. */
export default function TvPage() {
  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <PullRefresh>
      <div className="px-[4vw] pb-2 pt-24 md:pt-28">
        <h1 className="font-display text-4xl tracking-wide md:text-5xl">
          TV Shows<span className="text-brand">.</span>
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Popular, top-rated and newly premiering series from around the world
        </p>
      </div>
      <div className="relative z-10 flex flex-col gap-0.5">
        {TV_ROWS.map((def, i) => (
          <RowLazy key={def.key} reserve={i < 3 ? 340 : 320}>
            <TmdbRow def={def} />
          </RowLazy>
        ))}
      </div>
      </PullRefresh>
      <BrowseGrid options={{ type: "tv", heading: "Browse All TV Shows" }} />
      <Footer />
    </main>
  );
}
