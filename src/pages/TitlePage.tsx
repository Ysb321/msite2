"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Row from "@/components/Row";
import SetupNotice from "@/components/SetupNotice";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { img, titleOf, yearOf, bestLogo } from "@/lib/tmdb";
import { toggleList, inList } from "@/lib/storage";
import { PlayIcon, PlusIcon, CheckIcon, StarIcon, XIcon } from "@/components/Icons";

const runtimeLabel = (m: any) => {
  if (m?.runtime) return `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m`;
  if (m?.episode_run_time?.length) return `${m.episode_run_time[0]}m/ep`;
  return "";
};

export default function TitlePage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const t = type === "tv" ? "tv" : "movie";
  const router = useRouter();
  const key = `${t}/${id}?append_to_response=credits,videos,similar,recommendations,images&include_image_language=en,null`;
  const { data: d, isLoading, error } = useTmdbSnapshot<any>(key);
  const [saved, setSaved] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);

  useEffect(() => setSaved(inList(Number(id))), [id]);

  const trailer = useMemo(
    () => d?.videos?.results?.find((v: any) => v.site === "YouTube" && v.type === "Trailer")
      ?? d?.videos?.results?.find((v: any) => v.site === "YouTube"),
    [d]
  );

  const similar = useMemo(() => {
    const items = d?.recommendations?.results?.length ? d.recommendations.results : d?.similar?.results ?? [];
    return items.map((i: any) => ({ ...i, media_type: i.media_type ?? (i.first_air_date ? "tv" : "movie") }));
  }, [d]);

  if (isLoading && !d) {
    return (
      <main className="min-h-screen bg-ink">
        <Navbar />
        <div className="relative h-[64vh] min-h-[420px] w-full">
          <div className="skeleton h-full w-full rounded-none opacity-70" />
        </div>
        <div className="px-[4vw] pt-8"><div className="skeleton h-6 w-72" /></div>
      </main>
    );
  }

  if (!d) {
    return (
      <main className="min-h-screen bg-ink">
        <Navbar />
        {error ? (
          <div className="pt-24 md:pt-28">
            <SetupNotice error={error} />
          </div>
        ) : (
          <div className="flex h-[70vh] items-center justify-center text-neutral-400">Title not found.</div>
        )}
      </main>
    );
  }

  const backdrop = img(d.backdrop_path, "w1280");
  const logoPath = bestLogo(d?.images);
  const poster = img(d.poster_path, "w500");
  const title = titleOf(d);

  return (
    <main className="min-h-screen bg-ink">
      <Navbar />

      {/* backdrop hero */}
      <div className="relative h-[64vh] min-h-[420px] max-h-[720px] w-full overflow-hidden">
        {backdrop ? (
          <img src={backdrop} alt="" className="h-full w-full object-cover object-top" draggable={false} />
        ) : (
          <div className="h-full w-full bg-panel" />
        )}
        <div className="hero-fade absolute inset-0" />
        <div className="hero-fade-bottom absolute inset-x-0 bottom-0 h-40" />

        <div className="absolute inset-x-0 bottom-8 px-[4vw]">
          <div className="flex items-end gap-5">
            {poster && (
              <img
                src={poster}
                alt={title}
                className="hidden w-36 rounded-lg card-shadow md:block lg:w-44"
                draggable={false}
              />
            )}
            <div className="max-w-2xl pb-1">
              {logoPath ? (
                <h1 className="mb-2">
                  <img
                    src={img(logoPath, "w500") ?? undefined}
                    alt={title}
                    draggable={false}
                    className="max-h-24 w-auto max-w-full object-contain drop-shadow-lg md:max-h-36"
                  />
                </h1>
              ) : (
                <h1 className="font-display mb-2 text-4xl leading-tight tracking-wide drop-shadow-lg md:text-6xl">{title}</h1>
              )}
              {d.tagline && <p className="mb-2 text-sm italic text-neutral-300">&ldquo;{d.tagline}&rdquo;</p>}
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] font-medium text-neutral-200">
                <span className="flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-amber-400">
                  <StarIcon className="h-3.5 w-3.5" /> {(d.vote_average ?? 0).toFixed(1)}
                </span>
                <span className="text-neutral-500">•</span>
                <span>{yearOf(d)}</span>
                {runtimeLabel(d) && (
                  <>
                    <span className="text-neutral-500">•</span>
                    <span>{runtimeLabel(d)}</span>
                  </>
                )}
                <span className="rounded border border-neutral-500 px-1.5 text-[10px]">U/A {d.adult ? "A" : "16+"}</span>
                {t === "tv" && d.number_of_seasons && (
                  <>
                    <span className="text-neutral-500">•</span>
                    <span>{d.number_of_seasons} season{d.number_of_seasons > 1 ? "s" : ""}</span>
                  </>
                )}
              </div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {(d.genres ?? []).slice(0, 5).map((g: any) => (
                  <span key={g.id} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-neutral-200">
                    {g.name}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => router.push(t === "tv" ? `/watch/tv/${id}?s=1&e=1` : `/watch/movie/${id}`)}
                  className="flex items-center gap-2 rounded bg-brand px-6 py-2.5 text-[15px] font-bold text-white transition hover:bg-brand-dark"
                >
                  <PlayIcon className="h-5 w-5" /> Play
                </button>
                <button
                  onClick={() => {
                    toggleList({
                      id: Number(id), type: t as "movie" | "tv", title,
                      poster_path: d.poster_path, backdrop_path: d.backdrop_path,
                      vote_average: d.vote_average, year: yearOf(d),
                    });
                    setSaved(!saved);
                  }}
                  aria-label="My List"
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/40 text-white transition hover:border-white"
                >
                  {saved ? <CheckIcon /> : <PlusIcon />}
                </button>
                {trailer && (
                  <button
                    onClick={() => setTrailerOpen(true)}
                    className="rounded bg-white/20 px-5 py-2.5 text-[14px] font-bold text-white backdrop-blur transition hover:bg-white/30"
                  >
                    Trailer
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* overview + cast */}
      <div className="grid gap-10 px-[4vw] py-10 lg:grid-cols-[2fr,1fr]">
        <div>
          <h2 className="mb-2 text-lg font-bold">Storyline</h2>
          <p className="max-w-3xl text-[14.5px] leading-relaxed text-neutral-300">{d.overview || "No synopsis available."}</p>
        </div>
        <div className="text-[13px] leading-7 text-neutral-400">
          {d.original_language && <p><span className="text-neutral-500">Original language: </span>{d.original_language?.toUpperCase?.()}</p>}
          {d.status && <p><span className="text-neutral-500">Status: </span>{d.status}</p>}
          {(d.networks ?? []).length > 0 && <p><span className="text-neutral-500">Network: </span>{d.networks.map((n: any) => n.name).join(", ")}</p>}
          {(d.production_companies ?? []).slice(0, 3).length > 0 && (
            <p><span className="text-neutral-500">Studios: </span>{d.production_companies.slice(0, 3).map((c: any) => c.name).join(", ")}</p>
          )}
        </div>
      </div>

      {/* cast */}
      {(d.credits?.cast ?? []).length > 0 && (
        <div className="px-[4vw] pb-6">
          <h2 className="mb-4 text-lg font-bold">Cast</h2>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
            {d.credits.cast.slice(0, 15).map((c: any) => (
              <Link key={`${c.credit_id}`} href={`/person/${c.id}`} className="w-24 shrink-0 text-center transition hover:opacity-85">
                {c.profile_path ? (
                  <img src={img(c.profile_path, "w185")!} alt={c.name} loading="lazy" decoding="async"
                    className="h-24 w-24 rounded-full object-cover ring-1 ring-white/15 transition hover:ring-white/50" />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-panel-2 text-xl text-neutral-500">
                    {c.name?.[0]}
                  </div>
                )}
                <p className="mt-2 truncate text-[12px] font-semibold text-neutral-200 hover:text-white">{c.name}</p>
                <p className="truncate text-[11px] text-neutral-500">{c.character}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* seasons */}
      {t === "tv" && (d.seasons ?? []).filter((s: any) => s.season_number > 0 && s.episode_count > 0).length > 0 && (
        <div className="px-[4vw] pb-6">
          <h2 className="mb-4 text-lg font-bold">Seasons</h2>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
            {d.seasons.filter((s: any) => s.season_number > 0 && s.episode_count > 0).map((s: any) => (
              <button
                key={s.id}
                onClick={() => router.push(`/watch/tv/${id}?s=${s.season_number}&e=1`)}
                className="group w-36 shrink-0 text-left"
              >
                <div className="relative overflow-hidden rounded-md">
                  {s.poster_path ? (
                    <img src={img(s.poster_path, "w342")!} alt={s.name} loading="lazy" decoding="async"
                      className="aspect-[2/3] w-full object-cover transition group-hover:scale-105" />
                  ) : (
                    <div className="flex aspect-[2/3] w-full items-center justify-center bg-panel-2 p-3 text-center text-xs text-neutral-500">{s.name}</div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                    <PlayIcon className="h-10 w-10 text-white" />
                  </div>
                </div>
                <p className="mt-2 truncate text-[12.5px] font-semibold">{s.name}</p>
                <p className="text-[11px] text-neutral-500">{s.episode_count} episodes</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* similar */}
      {similar.length > 0 && (
        <div className="pb-8">
          <Row title="More Like This" items={similar} />
        </div>
      )}

      <Footer />

      {/* trailer modal */}
      {trailerOpen && trailer && (
        <div
          className="anim-fade-in fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setTrailerOpen(false)}
        >
          <div
            className="modal-in relative w-[min(92vw,960px)]"
            onClick={(e) => e.stopPropagation()}
          >
              <button
                onClick={() => setTrailerOpen(false)}
                aria-label="Close trailer"
                className="absolute -top-11 right-0 flex items-center gap-1.5 text-sm text-neutral-300 hover:text-white"
              >
                Close <XIcon className="h-5 w-5" />
              </button>
              <div className="aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-white/15">
                <iframe
                  src={`https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0`}
                  title={`${title} trailer`}
                  className="h-full w-full"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              </div>
          </div>
        </div>
      )}
    </main>
  );
}
