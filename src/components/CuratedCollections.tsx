"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { useTitleModal } from "@/context/TitleModalContext";
import { useExploreAll } from "@/context/ExploreAllContext";
import {
  Sparkles,
  Play,
  Film,
  Tv,
  Zap,
  Flame,
  Globe,
  ChevronRight,
  Shield,
  Heart,
  Crown,
} from "lucide-react";
import clsx from "clsx";
import SmartImage from "./SmartImage";

interface CollectionTile {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  image: string;
  icon: React.ElementType;
  gradient: string;
  borderColor: string;
  actionType: "explore" | "title" | "route";
  targetEndpoint?: string;
  targetMediaType?: "movie" | "tv";
  targetRoute?: string;
}

const COLLECTIONS: CollectionTile[] = [
  {
    id: "marvel-universe",
    title: "Marvel Universe",
    subtitle: "Epic superhero saga & blockbusters",
    badge: "COLLECTION",
    image: "https://image.tmdb.org/t/p/w780/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg",
    icon: Shield,
    gradient: "from-red-950/90 via-red-900/40 to-transparent",
    borderColor: "hover:border-red-500/50 hover:shadow-[0_0_25px_rgba(239,68,68,0.25)]",
    actionType: "explore",
    targetEndpoint: "discover/movie?with_companies=420%7C38679&sort_by=popularity.desc",
    targetMediaType: "movie",
  },
  {
    id: "anime-legends",
    title: "Top Anime Hits",
    subtitle: "Demon Slayer, JJK, Attack on Titan",
    badge: "TRENDING",
    image: "https://image.tmdb.org/t/p/w780/2OMG0D4Z76Y1K3fN2a92K9a478c.jpg",
    icon: Zap,
    gradient: "from-purple-950/90 via-purple-900/40 to-transparent",
    borderColor: "hover:border-purple-500/50 hover:shadow-[0_0_25px_rgba(168,85,247,0.25)]",
    actionType: "route",
    targetRoute: "/anime",
  },
  {
    id: "bollywood-blockbusters",
    title: "Bollywood Cinema",
    subtitle: "Record-breaking Indian blockbusters",
    badge: "POPULAR",
    image: "https://image.tmdb.org/t/p/w780/A6YsZq31bW101QWcO2nZ6Y9E69e.jpg",
    icon: Heart,
    gradient: "from-amber-950/90 via-amber-900/40 to-transparent",
    borderColor: "hover:border-amber-500/50 hover:shadow-[0_0_25px_rgba(245,158,11,0.25)]",
    actionType: "explore",
    targetEndpoint: "discover/movie?with_original_language=hi&sort_by=popularity.desc&vote_count.gte=30",
    targetMediaType: "movie",
  },
  {
    id: "critically-acclaimed",
    title: "Award Winners",
    subtitle: "Oscar & Golden Globe laureates",
    badge: "PRESTIGE",
    image: "https://image.tmdb.org/t/p/w780/8Z8J4Pcr9s6v873Qj9X8n5O79sL.jpg",
    icon: Crown,
    gradient: "from-emerald-950/90 via-emerald-900/40 to-transparent",
    borderColor: "hover:border-emerald-500/50 hover:shadow-[0_0_25px_rgba(16,185,129,0.25)]",
    actionType: "explore",
    targetEndpoint: "discover/movie?sort_by=vote_average.desc&vote_count.gte=5000",
    targetMediaType: "movie",
  },
];

function CuratedCollections() {
  const router = useRouter();
  const { openExploreAll } = useExploreAll();

  const handleSelect = (col: CollectionTile) => {
    if (col.actionType === "route" && col.targetRoute) {
      router.push(col.targetRoute);
    } else if (col.actionType === "explore" && col.targetEndpoint) {
      openExploreAll({
        title: col.title,
        endpoint: col.targetEndpoint,
        mediaType: col.targetMediaType ?? "movie",
      });
    }
  };

  return (
    <section
      id="curated-collections-section"
      className="relative z-10 my-8 px-[4vw]"
      aria-label="Curated Collections"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/30">
            <Sparkles className="h-4 w-4" />
          </div>
          <h2 className="font-display2 text-lg tracking-wider text-neutral-100 md:text-[22px]">
            Curated Collections
          </h2>
          <span className="hidden rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-400 sm:inline-block">
            Handpicked
          </span>
        </div>
      </div>

      {/* Modern Bento Grid */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {COLLECTIONS.map((col) => {
          const Icon = col.icon;
          return (
            <div
              key={col.id}
              onClick={() => handleSelect(col)}
              className={clsx(
                "group relative aspect-[16/10] cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-neutral-900 transition-all duration-300 hover:scale-[1.03] active:scale-95",
                col.borderColor
              )}
            >
              {/* Background Image with Zoom on Hover */}
              <div className="absolute inset-0 overflow-hidden">
                <SmartImage
                  src={col.image}
                  alt={col.title}
                  title={col.title}
                  aspectRatio="custom"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-center filter brightness-[0.7] transition-transform duration-500 ease-out group-hover:scale-110"
                />
              </div>

              {/* Gradient Vignette Overlay */}
              <div
                className={clsx(
                  "absolute inset-0 bg-gradient-to-t",
                  col.gradient
                )}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

              {/* Card Content */}
              <div className="absolute inset-0 flex flex-col justify-between p-4">
                {/* Top Badge */}
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-[9.5px] font-extrabold tracking-wider text-neutral-200 backdrop-blur-md">
                    {col.badge}
                  </span>
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-transform group-hover:scale-110 group-hover:bg-brand">
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>

                {/* Bottom Title & Subtitle */}
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-white drop-shadow">
                    <Icon className="h-4 w-4 text-amber-400" />
                    <h3 className="font-display text-base font-bold tracking-tight text-white drop-shadow-md sm:text-lg">
                      {col.title}
                    </h3>
                  </div>
                  <p className="line-clamp-1 text-[11px] font-medium text-neutral-300 drop-shadow">
                    {col.subtitle}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default memo(CuratedCollections);
