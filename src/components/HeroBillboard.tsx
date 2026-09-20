"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTmdbSnapshot } from "./SWRProvider";
import { img, titleOf, yearOf, type Media } from "@/lib/tmdb";
import { MOVIE_GENRES } from "@/lib/rows";
import { PlayIcon, InfoIcon, StarIcon } from "./Icons";
import clsx from "clsx";

const ROTATE_MS = 9000;

/** Netflix-style rotating hero billboard with logo images, crossfades and CTA */
export default function HeroBillboard({ heroes }: { heroes: Media[] }) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const list = useMemo(() => heroes.slice(0, 6), [heroes]);
  const active = list[idx];

  useEffect(() => {
    if (paused || list.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, list.length]);

  // enrich active hero (runtime, logo, genres) — cached per id
  const { data: details } = useTmdbSnapshot<{ runtime?: number; genres?: { id: number; name: string }[]; images?: any }>(
    active ? `movie/${active.id}?append_to_response=images&include_image_language=en,null` : null
  );

  if (!active) return null;
  const logo = img(details?.images?.logos?.[0]?.file_path, "w500");
  const genres = (details?.genres ?? (active.genre_ids ?? []).map((id) => ({ id, name: MOVIE_GENRES[id] })).filter(Boolean)) as { id: number; name: string }[];

  return (
    <section
      className="relative h-[82vh] min-h-[480px] max-h-[860px] w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div key={active.id} className="hero-in absolute inset-0">
          {img(active.backdrop_path ?? active.poster_path, "w1280") && (
            <img
              src={img(active.backdrop_path ?? active.poster_path, "w1280")!}
              alt=""
              fetchPriority={idx === 0 ? "high" : "low"}
              className="h-full w-full object-cover object-top"
              draggable={false}
            />
          )}
      </div>

      <div className="hero-fade absolute inset-0" />
      <div className="hero-fade-bottom absolute inset-x-0 bottom-0 h-40" />

      <div className="absolute inset-x-0 bottom-[16%] px-[4vw]">
        <div key={active.id} className="hero-text-in max-w-[36rem]">
            {logo ? (
              <img src={logo} alt={titleOf(active)} className="mb-4 max-h-16 max-w-[80%] object-contain drop-shadow-lg sm:max-h-24 md:max-h-36" draggable={false} />
            ) : (
              <h1 className="font-display mb-4 text-[32px] leading-[1.05] tracking-wide drop-shadow-lg sm:text-4xl md:text-6xl lg:text-7xl">{titleOf(active)}</h1>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] font-medium text-neutral-200">
              <span className="flex items-center gap-1 text-amber-400">
                <StarIcon className="h-3.5 w-3.5" /> {(active.vote_average ?? 0).toFixed(1)}
              </span>
              <span className="text-neutral-500">•</span>
              <span>{yearOf(active)}</span>
              {details?.runtime ? (
                <>
                  <span className="text-neutral-500">•</span>
                  <span>{Math.floor(details.runtime / 60)}h {details.runtime % 60}m</span>
                </>
              ) : null}
              <span className="rounded border border-neutral-500 px-1.5 text-[10px] text-neutral-300">U/A 16+</span>
            </div>

            <p className="mb-4 line-clamp-3 max-w-[32rem] text-[14px] leading-relaxed text-neutral-100 drop-shadow md:text-[15.5px]">
              {active.overview}
            </p>

            {genres.length > 0 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {genres.slice(0, 3).map((g) => (
                  <span key={g.id} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-neutral-200 backdrop-blur-sm">
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(`/watch/movie/${active.id}`)}
                className="flex items-center gap-2 rounded bg-white px-6 py-2.5 text-[15px] font-bold text-black transition hover:bg-neutral-300"
              >
                <PlayIcon className="h-5 w-5" /> Play
              </button>
              <button
                onClick={() => router.push(`/title/movie/${active.id}`)}
                className="flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 text-[15px] font-bold text-white backdrop-blur transition hover:bg-white/30"
              >
                <InfoIcon className="h-5 w-5" /> More Info
              </button>
            </div>
        </div>
      </div>

      {/* rotation dots + maturity tag (netflix-style) */}
      {list.length > 1 && (
        <div className="absolute bottom-[9%] right-[4vw] flex items-center gap-3">
          <div className="flex gap-1.5">
            {list.map((h, i) => (
              <button
                key={h.id}
                aria-label={`Show ${titleOf(h)}`}
                onClick={() => setIdx(i)}
                className={clsx("h-1.5 rounded-full transition-all", i === idx ? "w-6 bg-brand" : "w-3 bg-white/40 hover:bg-white/70")}
              />
            ))}
          </div>
          <span className="border-l-2 border-white/70 bg-black/40 py-0.5 pl-2.5 pr-4 text-[13px] font-medium text-neutral-100">
            U/A 16+
          </span>
        </div>
      )}
    </section>
  );
}
