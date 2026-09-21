"use client";

import { useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Card from "@/components/Card";
import { useMyList } from "@/context/MyListContext";
import { getActiveProfile } from "@/lib/storage";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  Film,
  Tv,
  ArrowUpDown,
  Trash2,
  Compass,
  Search,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

type FilterType = "all" | "movie" | "tv";
type SortOption = "added" | "rating" | "title" | "year";

export default function MyListPage() {
  const router = useRouter();
  const { list, count, isLoaded, removeFromList, clearList } = useMyList();
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortOption>("added");
  const [searchQuery, setSearchQuery] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const activeProfile = getActiveProfile();

  const movieCount = useMemo(() => list.filter((i) => i.type === "movie").length, [list]);
  const tvCount = useMemo(() => list.filter((i) => i.type === "tv").length, [list]);

  const filteredItems = useMemo(() => {
    let result = [...list];

    // Filter by type
    if (filter === "movie") {
      result = result.filter((i) => i.type === "movie");
    } else if (filter === "tv") {
      result = result.filter((i) => i.type === "tv");
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((i) => i.title?.toLowerCase().includes(q));
    }

    // Sorting
    if (sort === "rating") {
      result.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    } else if (sort === "title") {
      result.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else if (sort === "year") {
      result.sort((a, b) => {
        const yA = parseInt(a.year || "0", 10) || 0;
        const yB = parseInt(b.year || "0", 10) || 0;
        return yB - yA;
      });
    }
    // "added" preserves insertion order (newest first)

    return result;
  }, [list, filter, sort, searchQuery]);

  return (
    <main className="min-h-screen bg-ink text-white selection:bg-brand selection:text-white">
      <Navbar />

      <div className="mx-auto w-full max-w-[1600px] px-[4vw] pb-16 pt-24 md:pt-28">
        {/* Page Header */}
        <div className="mb-6 flex flex-col gap-4 border-b border-neutral-800/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
              <Bookmark className="h-3.5 w-3.5" />
              <span>Personal Watchlist</span>
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl lg:text-4xl">
                My List
              </h1>
              {isLoaded && count > 0 && (
                <span className="text-sm font-medium text-neutral-400">
                  {count} {count === 1 ? "title" : "titles"}
                  {activeProfile?.name ? ` for ${activeProfile.name}` : ""}
                </span>
              )}
            </div>
          </div>

          {/* Action toolbar if items exist */}
          {count > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Clear List Button */}
              {showClearConfirm ? (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-1.5 text-xs text-red-200">
                  <span>Clear all items?</span>
                  <button
                    onClick={() => {
                      clearList();
                      setShowClearConfirm(false);
                    }}
                    className="font-bold text-red-400 hover:text-red-300 underline"
                  >
                    Yes, clear
                  </button>
                  <span className="text-neutral-500">|</span>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="text-neutral-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:border-neutral-700 hover:text-red-400"
                  title="Clear entire list"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear List</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Filter and Sort Controls */}
        {count > 0 && (
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Type Filters */}
            <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg bg-neutral-900/80 p-1 border border-neutral-800/80">
              <button
                onClick={() => setFilter("all")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  filter === "all"
                    ? "bg-brand text-white shadow"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                }`}
              >
                <span>All</span>
                <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px]">
                  {count}
                </span>
              </button>
              <button
                onClick={() => setFilter("movie")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  filter === "movie"
                    ? "bg-brand text-white shadow"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                }`}
              >
                <Film className="h-3 w-3" />
                <span>Movies</span>
                <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px]">
                  {movieCount}
                </span>
              </button>
              <button
                onClick={() => setFilter("tv")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  filter === "tv"
                    ? "bg-brand text-white shadow"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                }`}
              >
                <Tv className="h-3 w-3" />
                <span>TV Shows</span>
                <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px]">
                  {tvCount}
                </span>
              </button>
            </div>

            {/* Search and Sort controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Optional Search in list if more than 3 items */}
              {count > 3 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search in list..."
                    className="w-36 sm:w-44 rounded-lg border border-neutral-800 bg-neutral-900/80 py-1.5 pl-8 pr-3 text-xs text-white placeholder-neutral-500 focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              {/* Sort Dropdown */}
              <div className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2.5 py-1.5 text-xs text-neutral-300">
                <ArrowUpDown className="h-3.5 w-3.5 text-neutral-400" />
                <span className="text-neutral-500">Sort:</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  className="bg-transparent text-xs font-medium text-neutral-200 focus:outline-none cursor-pointer"
                >
                  <option value="added" className="bg-neutral-900 text-white">
                    Recently Added
                  </option>
                  <option value="rating" className="bg-neutral-900 text-white">
                    Highest Rated
                  </option>
                  <option value="title" className="bg-neutral-900 text-white">
                    Title (A-Z)
                  </option>
                  <option value="year" className="bg-neutral-900 text-white">
                    Release Year
                  </option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Content Render */}
        {!isLoaded ? (
          /* Loading Skeletons */
          <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] w-full rounded-md bg-neutral-800/60 animate-pulse"
              />
            ))}
          </div>
        ) : count === 0 ? (
          /* Empty List State */
          <div className="my-12 flex flex-col items-center justify-center rounded-2xl border border-neutral-850 bg-gradient-to-b from-neutral-900/40 to-neutral-950/80 px-6 py-16 text-center shadow-inner">
            <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-neutral-700/60 bg-neutral-900 shadow-xl">
              <Bookmark className="h-9 w-9 text-brand stroke-[1.7]" />
              <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand/20 text-brand">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
            </div>

            <h2 className="text-xl font-bold text-white md:text-2xl">
              Your list is empty
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
              Save movies, TV shows, and anime to your personal list by clicking the
              <span className="inline-flex items-center justify-center mx-1.5 h-5 w-5 rounded-full border border-neutral-500 bg-neutral-800 text-xs font-bold text-white align-middle">
                +
              </span>
              button on any title card or details page.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => router.push("/home")}
                className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white shadow-lg transition hover:bg-brand-dark"
              >
                <Compass className="h-4 w-4" />
                <span>Explore Trending</span>
              </button>
              <button
                onClick={() => router.push("/movies")}
                className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 text-xs font-semibold text-neutral-200 transition hover:border-neutral-500 hover:text-white"
              >
                <Film className="h-3.5 w-3.5" />
                <span>Browse Movies</span>
              </button>
              <button
                onClick={() => router.push("/tv")}
                className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 text-xs font-semibold text-neutral-200 transition hover:border-neutral-500 hover:text-white"
              >
                <Tv className="h-3.5 w-3.5" />
                <span>Browse TV Shows</span>
              </button>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          /* Filter Returned No Results */
          <div className="my-12 flex flex-col items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/30 px-6 py-14 text-center">
            <p className="text-base font-semibold text-neutral-300">
              No matching titles found
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {searchQuery
                ? `No titles match "${searchQuery}" in your list.`
                : `You don't have any ${filter === "movie" ? "movies" : "TV shows"} saved.`}
            </p>
            <button
              onClick={() => {
                setFilter("all");
                setSearchQuery("");
              }}
              className="mt-4 rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:border-white hover:text-white transition"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          /* Titles Grid */
          <div className="grid grid-cols-2 gap-x-3 gap-y-12 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {filteredItems.map((l) => (
              <div key={l.id} className="group relative">
                <Card
                  item={{ ...l, media_type: l.type } as any}
                  variant="poster"
                  className="w-full"
                  onRemove={() => removeFromList(l.id)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Footer info note when list has items */}
        {count > 0 && (
          <div className="mt-14 flex items-center justify-center gap-2 text-xs text-neutral-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>List is synced across your sessions and devices for this profile</span>
          </div>
        )}
      </div>

      <Footer />
    </main>
  );
}
