"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Card from "@/components/Card";
import SetupNotice from "@/components/SetupNotice";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { img, titleOf, yearOf, type Media } from "@/lib/tmdb";

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

/** Actor/person page: bio + Known For grid + full filmography (movies & TV) */
export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { data: p, isLoading, error } = useTmdbSnapshot<any>(
    `person/${id}?append_to_response=combined_credits`
  );
  const [bioOpen, setBioOpen] = useState(false);

  const knownFor = useMemo(() => {
    const cast: Media[] = p?.combined_credits?.cast ?? [];
    const seen = new Set<number>();
    return cast
      .filter((c) => (c.poster_path || c.backdrop_path) && !seen.has(c.id) && seen.add(c.id))
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, 12)
      .map((c) => ({ ...c, media_type: c.media_type ?? (c.first_air_date ? "tv" : "movie") }));
  }, [p]);

  const filmography = useMemo(() => {
    const cast: Media[] = p?.combined_credits?.cast ?? [];
    const seen = new Set<number>();
    return cast
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .sort((a, b) =>
        (b.release_date || b.first_air_date || "").localeCompare(a.release_date || a.first_air_date || "")
      );
  }, [p]);

  if (isLoading && !p) {
    return (
      <main className="min-h-screen bg-ink">
        <Navbar />
        <div className="flex gap-8 px-[4vw] pt-28">
          <div className="skeleton h-[264px] w-[176px]" />
          <div className="flex-1 space-y-3 pt-4">
            <div className="skeleton h-9 w-72" />
            <div className="skeleton h-4 w-52" />
            <div className="skeleton h-4 w-96 max-w-full" />
            <div className="skeleton h-4 w-80" />
          </div>
        </div>
      </main>
    );
  }

  if (!p) {
    return (
      <main className="min-h-screen bg-ink">
        <Navbar />
        <div className="pt-24 md:pt-28">
          {error ? <SetupNotice error={error} /> : (
            <div className="flex h-[60vh] items-center justify-center text-neutral-400">Person not found.</div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ink">
      <Navbar />

      {/* header */}
      <div className="flex flex-col gap-8 px-[4vw] pb-8 pt-24 md:flex-row md:pt-28">
        {p.profile_path ? (
          <img
            src={img(p.profile_path, "w342")!}
            alt={p.name ?? ""}
            className="h-[240px] w-[160px] shrink-0 rounded-lg object-cover card-shadow md:h-[330px] md:w-[220px]"
            draggable={false}
          />
        ) : (
          <div className="flex h-[240px] w-[160px] items-center justify-center rounded-lg bg-panel-2 text-4xl text-neutral-600 md:h-[330px] md:w-[220px]">
            {(p.name ?? "?")[0]}
          </div>
        )}

        <div className="min-w-0 max-w-3xl flex-1">
          <h1 className="font-display mb-2 text-4xl tracking-wide md:text-5xl">{p.name}</h1>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-neutral-400">
            {p.known_for_department && (
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-medium text-neutral-200">
                {p.known_for_department}
              </span>
            )}
            {p.birthday && <span>Born {fmtDate(p.birthday)}</span>}
            {p.deathday && <span>· Died {fmtDate(p.deathday)}</span>}
            {p.place_of_birth && <span>· {p.place_of_birth}</span>}
          </div>

          {p.biography && (
            <div className="text-[14px] leading-relaxed text-neutral-300">
              <p className={bioOpen ? "" : "line-clamp-4 whitespace-pre-line"}>{p.biography}</p>
              {p.biography.length > 280 && (
                <button onClick={() => setBioOpen((v) => !v)} className="mt-1 text-[12.5px] font-semibold text-sky-400 hover:text-sky-300">
                  {bioOpen ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* known for */}
      {knownFor.length > 0 && (
        <div className="px-[4vw] pb-8">
          <h2 className="mb-4 text-lg font-bold">Known For</h2>
          <div className="grid grid-cols-3 gap-x-2.5 gap-y-10 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {knownFor.map((m) => (
              <div key={`${m.media_type}-${m.id}`}>
                <Card item={m} variant="poster" className="w-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* filmography */}
      {filmography.length > 0 && (
        <div className="px-[4vw] pb-10">
          <h2 className="mb-4 text-lg font-bold">Movies &amp; Series</h2>
          <div className="max-w-4xl divide-y divide-white/5">
            {filmography.map((m) => {
              const type = m.media_type ?? (m.first_air_date ? "tv" : "movie");
              const year = yearOf(m);
              return (
                <Link
                  key={`${type}-${m.id}`}
                  href={`/title/${type}/${m.id}`}
                  className="flex items-baseline gap-4 rounded-md px-3 py-2.5 transition hover:bg-white/5"
                >
                  <span className="w-10 shrink-0 text-[13px] font-semibold text-neutral-500">{year || "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-neutral-200">{titleOf(m)}</span>
                  {m.character && <span className="hidden truncate text-[12px] text-neutral-500 sm:block">as {m.character}</span>}
                  <span className={("chip shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold " + (type === "tv" ? "bg-sky-500/15 text-sky-400" : "bg-brand/15 text-brand"))}>
                    {type === "tv" ? "SERIES" : "MOVIE"}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <Footer />
    </main>
  );
}
