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
import SetupNotice from "@/components/SetupNotice";
import { useTmdbSnapshot } from "@/components/SWRProvider";
import { HOME_ROWS, KIDS_ROWS } from "@/lib/rows";
import {
  getProgress, onProgressChange, removeProgress, clearProgress,
  getList, onListChange, getActiveProfile, isKidsActive, onActiveProfileChange,
} from "@/lib/storage";
import type { ListItem, ProgressItem } from "@/lib/storage";

export default function HomePage() {
  const [kids, setKids] = useState(false);
  const { data, isLoading, error } = useTmdbSnapshot<any>(
    kids
      ? "discover/movie?with_genres=16%7C10751&vote_count.gte=300&sort_by=popularity.desc&page=1"
      : "discover/movie?with_original_language=hi%7Cta%7Cte&region=IN&sort_by=popularity.desc&vote_count.gte=30&page=1"
  );
  const heroes = useMemo(() => (data?.results ?? []).slice(0, 6), [data]);

  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [myList, setMyList] = useState<ListItem[]>([]);
  const [profileName, setProfileName] = useState("you");

  useEffect(() => {
    setProgress(getProgress());
    setMyList(getList());
    setProfileName(getActiveProfile()?.name ?? "you");
    const a = onProgressChange(setProgress);
    const b = onListChange(setMyList);
    return () => { a(); b(); };
  }, []);

  /* live profile switching: the moment a profile changes (Navbar switch,
   * PIN unlock, profile gate), rows/hero/name follow instantly - no
   * reload needed */
  useEffect(() => {
    const sync = () => {
      setKids(isKidsActive());
      setProfileName(getActiveProfile()?.name ?? "you");
    };
    sync();
    return onActiveProfileChange(sync);
  }, []);
  // (media_type mapped from storage `type` so cards route correctly)
  const cwItems = useMemo(
    () => progress.slice(0, 14).map((p) => ({ ...p, media_type: p.type })),
    [progress]
  );
  const cwMap = useMemo(() => new Map(cwItems.map((p) => [p.id, p])), [cwItems]);

  const listItems = useMemo(
    () => myList.map((l) => ({ ...l, media_type: l.type, title: l.title })) as any[],
    [myList]
  );

  return (
    <main className="min-h-screen bg-ink">
      <IntroSplash />
      <Navbar />

      <PullRefresh>
      {heroes.length > 0 ? (
        <HeroBillboard heroes={heroes} />
      ) : isLoading ? (
        <div className="relative h-[82vh] min-h-[480px] max-h-[860px] w-full">
          <div className="skeleton h-full w-full rounded-none opacity-70" />
          <div className="absolute bottom-[16%] px-[4vw]">
            <div className="skeleton mb-4 h-14 w-[min(70vw,420px)]" />
            <div className="skeleton mb-2 h-4 w-[min(60vw,380px)]" />
            <div className="skeleton mb-2 h-4 w-[min(50vw,320px)]" />
            <div className="skeleton h-11 w-52" />
          </div>
        </div>
      ) : error ? (
        <div className="px-[4vw] pt-24 md:pt-28">
          <SetupNotice error={error} />
        </div>
      ) : null}

      <div className="relative z-10 -mt-14 flex flex-col gap-0.5 pb-6">
        {cwItems.length > 0 && (
          <Row
            title={`Continue Watching for ${profileName}`}
            items={cwItems as any}
            variant="backdrop"
            progressItems={cwMap}
            onRemove={removeProgress}
            action={
              <button
                onClick={() => clearProgress()}
                className="ml-auto rounded-full border border-neutral-600 px-3 py-0.5 text-[11px] font-semibold text-neutral-400 transition hover:border-white hover:text-white"
              >
                Remove all
              </button>
            }
          />
        )}
        {listItems.length > 0 && <Row title="My List" items={listItems} />}
        {(kids ? KIDS_ROWS : HOME_ROWS).map((def, i) => (
          <RowLazy key={def.key} reserve={i < 6 ? 340 : 320}>
            <TmdbRow def={def} />
          </RowLazy>
        ))}
      </div>

      </PullRefresh>
      <Footer />
    </main>
  );
}
