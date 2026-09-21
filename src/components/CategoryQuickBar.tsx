"use client";

import { useRef, useEffect, memo } from "react";
import clsx from "clsx";
import {
  Sparkles,
  Flame,
  Film,
  Tv,
  Trophy,
  Heart,
  Smile,
  Zap,
} from "lucide-react";

export type CategoryKey =
  | "all"
  | "trending"
  | "movies"
  | "tv"
  | "bollywood"
  | "action"
  | "family"
  | "toprated";

interface CategoryItem {
  key: CategoryKey;
  label: string;
  badge?: string;
  icon: React.ElementType;
}

const CATEGORIES: CategoryItem[] = [
  { key: "all", label: "All For You", icon: Sparkles },
  { key: "trending", label: "Trending Now", badge: "HOT", icon: Flame },
  { key: "movies", label: "Blockbuster Movies", icon: Film },
  { key: "tv", label: "TV Shows & Series", icon: Tv },
  { key: "bollywood", label: "Bollywood & Regional", badge: "INDIA", icon: Heart },
  { key: "action", label: "Action & Sci-Fi", icon: Zap },
  { key: "family", label: "Kids & Family", icon: Smile },
  { key: "toprated", label: "Top Rated Hits", badge: "★ 8.0+", icon: Trophy },
];

interface CategoryQuickBarProps {
  activeCategory: CategoryKey;
  onSelectCategory: (key: CategoryKey) => void;
  className?: string;
}

function CategoryQuickBar({
  activeCategory,
  onSelectCategory,
  className,
}: CategoryQuickBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active pill into view on mobile
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-cat="${activeCategory}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeCategory]);

  return (
    <nav
      aria-label="Content categories"
      className={clsx(
        "relative z-20 w-full px-[4vw] py-2 transition-all duration-300",
        className
      )}
    >
      <div
        ref={containerRef}
        className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1"
      >
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.key;
          const Icon = cat.icon;

          return (
            <button
              key={cat.key}
              id={`cat-filter-${cat.key}`}
              data-cat={cat.key}
              onClick={() => onSelectCategory(cat.key)}
              className={clsx(
                "group relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-bold tracking-wide transition-all duration-300 active:scale-95 cursor-pointer select-none",
                isActive
                  ? "bg-gradient-to-r from-brand via-brand-dark to-brand text-white shadow-[0_4px_20px_rgba(229,9,20,0.45)] ring-1 ring-white/30 scale-[1.02]"
                  : "border border-white/10 bg-neutral-900/80 text-neutral-300 hover:border-white/25 hover:bg-neutral-800 hover:text-white backdrop-blur-xl"
              )}
            >
              <Icon
                className={clsx(
                  "h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110",
                  isActive ? "text-white fill-current" : "text-neutral-400 group-hover:text-white"
                )}
              />
              <span>{cat.label}</span>

              {cat.badge && (
                <span
                  className={clsx(
                    "rounded-full px-1.5 py-0.2 text-[9px] font-extrabold uppercase tracking-wider",
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-white/10 text-neutral-400 group-hover:text-neutral-200"
                  )}
                >
                  {cat.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default memo(CategoryQuickBar);

