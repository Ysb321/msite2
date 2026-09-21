"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import PullRefresh from "@/components/PullRefresh";
import Footer from "@/components/Footer";
import HeroBillboard from "@/components/HeroBillboard";
import IntroSplash from "@/components/IntroSplash";
import Row from "@/components/Row";
import RowLazy from "@/components/RowLazy";
import TmdbRow from "@/components/TmdbRow";
import TrendingNowCarousel from "@/components/TrendingNowCarousel";
import CategoryQuickBar, { type CategoryKey } from "@/components/CategoryQuickBar";
import SpotlightBanner from "@/components/SpotlightBanner";
import CuratedCollections from "@/components/CuratedCollections";
import SetupNotice from "@/components/SetupNotice";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { HOME_ROWS, KIDS_ROWS } from "@/lib/rows";
import {
  getProgress,
  onProgressChange,
  removeProgress,
  clearProgress,
  getActiveProfile,
  isKidsActive,
  onActiveProfileChange,
} from "@/lib/storage";
import type { ProgressItem } from "@/lib/storage";
import { useMyList } from "@/context/MyListContext";
import { useExploreAll } from "@/context/ExploreAllContext";

export default function HomePage() {
  const [kids, setKids] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("all");
  const { list: myList } = useMyList();
  const { openExploreAll } = useExploreAll();

  const { data, isLoading, error } = useTmdbSnapshot<any>(
    kids
      ? "discover/movie?with_genres=16%7C10751&vote_count.gte=300&sort_by=popularity.desc&page=1"
      : "discover/movie?with_original_language=hi%7Cta%7Cte&region=IN&sort_by=popularity.desc&vote_count.gte=30&page=1"
  );
  const heroes = useMemo(() => (data?.results ?? []).slice(0, 6), [data]);

  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [profileName, setProfileName] = useState("you");

  useEffect(() => {
    setProgress(getProgress());
    setProfileName(getActiveProfile()?.name ?? "you");
    const a = onProgressChange(setProgress);
    return () => {
      a();
    };
  }, []);

  /* live profile switching: when a profile changes (Navbar switch,
   * PIN unlock, profile gate), rows/hero/name follow instantly */
  useEffect(() => {
    const sync = () => {
      setKids(isKidsActive());
      setProfileName(getActiveProfile()?.name ?? "you");
    };
    sync();
    return onActiveProfileChange(sync);
  }, []);

  // Continue watching mapped items
  const cwItems = useMemo(
    () => progress.slice(0, 14).map((p) => ({ ...p, media_type: p.type })),
    [progress]
  );
  const cwMap = useMemo(() => new Map(cwItems.map((p) => [p.id, p])), [cwItems]);

  const listItems = useMemo(
    () => myList.map((l) => ({ ...l, media_type: l.type, title: l.title })) as any[],
    [myList]
  );

  // Dynamic row filtering based on CategoryQuickBar
  const filteredRows = useMemo(() => {
    const allDefs = kids ? KIDS_ROWS : HOME_ROWS;
    if (activeCategory === "all") return allDefs;

    if (activeCategory === "trending") {
      return allDefs.filter((d) => d.key.includes("trending") || d.key.includes("top10"));
    }
    if (activeCategory === "movies") {
      return allDefs.filter(
        (d) =>
          d.key.includes("movie") ||
          d.key === "bollywood" ||
          d.key === "south-indian" ||
          d.key === "hollywood" ||
          d.key === "marvel" ||
          d.key === "dubbed-hits" ||
          d.key === "top10-india"
      );
    }
    if (activeCategory === "tv") {
      return allDefs.filter(
        (d) =>
          d.key.includes("tv") ||
          d.key === "anime" ||
          d.key === "korean-tv" ||
          d.key === "cartoons"
      );
    }
    if (activeCategory === "bollywood") {
      return allDefs.filter(
        (d) =>
          d.key === "bollywood" ||
          d.key === "south-indian" ||
          d.key === "indian-tv" ||
          d.key === "trending-india" ||
          d.key === "top10-india" ||
          d.key === "dubbed-hits"
      );
    }
    if (activeCategory === "action") {
      return allDefs.filter(
        (d) =>
          d.key === "marvel" ||
          d.key === "hollywood" ||
          d.key === "dubbed-hits" ||
          d.key === "trending-movies"
      );
    }
    if (activeCategory === "family") {
      return allDefs.filter(
        (d) =>
          d.key === "anime" ||
          d.key.includes("kids") ||
          d.key === "dubbed-hits"
      );
    }
    if (activeCategory === "toprated") {
      return allDefs.filter(
        (d) =>
          d.key.includes("top10") ||
          d.key === "bollywood" ||
          d.key === "hollywood" ||
          d.key === "marvel"
      );
    }
    return allDefs;
  }, [kids, activeCategory]);

  return (
    <main className="min-h-screen bg-ink text-neutral-100">
      <IntroSplash />
      <Navbar />

      <PullRefresh>
        {/* Dynamic Hero Billboard */}
        {heroes.length > 0 ? (
          <HeroBillboard heroes={heroes} />
        ) : isLoading ? (
          <div className="relative h-[86vh] min-h-[540px] max-h-[920px] w-full bg-ink">
            <div className="skeleton h-full w-full rounded-none opacity-40" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/60 to-transparent" />
            <div className="absolute bottom-[16%] px-[4vw]">
              <div className="skeleton mb-3 h-6 w-36 rounded-full" />
              <div className="skeleton mb-4 h-16 w-[min(70vw,440px)] rounded-lg" />
              <div className="skeleton mb-2 h-4 w-[min(60vw,380px)]" />
              <div className="skeleton mb-5 h-4 w-[min(50vw,320px)]" />
              <div className="flex gap-3">
                <div className="skeleton h-12 w-36 rounded-lg" />
                <div className="skeleton h-12 w-36 rounded-lg" />
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="px-[4vw] pt-24 md:pt-28">
            <SetupNotice error={error} />
          </div>
        ) : null}

        {/* Category & Mood Quick Navigation Bar */}
        <div className="relative z-20 -mt-10 sm:-mt-12 mb-2">
          <CategoryQuickBar
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
          />
        </div>

        {/* Content Feed Section */}
        <div className="relative z-10 flex flex-col gap-1 pb-10">
          {/* Continue Watching Section */}
          {cwItems.length > 0 && activeCategory === "all" && (
            <Row
              title={`Continue Watching for ${profileName}`}
              items={cwItems as any}
              variant="backdrop"
              progressItems={cwMap}
              onRemove={removeProgress}
              onExploreAll={() =>
                openExploreAll({
                  title: `Continue Watching for ${profileName}`,
                  initialItems: cwItems as any,
                  variant: "backdrop",
                })
              }
              action={
                <button
                  onClick={() => clearProgress()}
                  className="ml-auto rounded-full border border-neutral-700 bg-neutral-900/80 px-3 py-1 text-[11px] font-semibold text-neutral-400 transition hover:border-white hover:text-white"
                >
                  Clear all
                </button>
              }
            />
          )}

          {/* User's Watchlist */}
          {listItems.length > 0 && activeCategory === "all" && (
            <Row
              title="My List"
              items={listItems}
              href="/my-list"
              onExploreAll={() =>
                openExploreAll({
                  title: "My List",
                  initialItems: listItems,
                })
              }
            />
          )}

          {/* Live Trending Now Carousel */}
          {(activeCategory === "all" ||
            activeCategory === "trending" ||
            activeCategory === "movies" ||
            activeCategory === "tv") && (
            <TrendingNowCarousel
              initialType={
                activeCategory === "movies"
                  ? "movie"
                  : activeCategory === "tv"
                  ? "tv"
                  : "all"
              }
            />
          )}

          {/* Curated Dynamic Content Rows */}
          {filteredRows.map((def, i) => (
            <div key={def.key}>
              {/* Insert Curated Collections Bento Box after 2nd row in 'all' view */}
              {i === 2 && activeCategory === "all" && !kids && (
                <CuratedCollections />
              )}

              {/* Insert Spotlight Feature Banner between 4th and 5th row in 'all' view */}
              {i === 4 && activeCategory === "all" && !kids && (
                <SpotlightBanner />
              )}

              <RowLazy
                reserve={i < 4 ? 340 : 300}
                priority={i < 2}
              >
                <TmdbRow def={def} />
              </RowLazy>
            </div>
          ))}
        </div>
      </PullRefresh>

      <Footer />
    </main>
  );
}
