"use client";

import useSWR, { SWRConfig } from "swr";
import { useEffect, useState } from "react";
import { swrFetcher, getCached, sanitizeForKids } from "@/lib/tmdb";
import { isKidsActive } from "@/lib/storage";

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 60_000,
        keepPreviousData: true,
        fallback: {}, // primed per-key by useTmdbSnapshot below
      }}
    >
      {children}
    </SWRConfig>
  );
}

/** useSWR + localStorage snapshot: paints cached data instantly, then
 *  revalidates in the background — zero spinner on revisit.
 *
 *  Hydration-safe: the snapshot is applied only AFTER mount so the first
 *  client render matches the server (server has no localStorage → skeleton),
 *  then the cached data pops in immediately. */
export function useTmdbSnapshot<T = any>(key: string | null) {
  const [snapshot, setSnapshot] = useState<{ key: string | null; data: T | undefined } | null>(null);

  useEffect(() => {
    setSnapshot({ key, data: key ? getCached(key).data : undefined });
  }, [key]);

  const fallbackData =
    snapshot && snapshot.key === key && snapshot.data !== undefined ? snapshot.data : undefined;

  const res = useSWR<T, any, string | null>(key, {
    fallbackData,
    keepPreviousData: true,
  });

  /* Kids mode: sanitize on the RETURN path too - cached localStorage
   * snapshots, SWR's in-memory cache and in-flight responses (fetched
   * before a profile switch) can all carry unfiltered data; this makes
   * it impossible for non-kids content to render in Kids mode. */
  if (isKidsActive() && res.data) {
    return { ...res, data: sanitizeForKids(res.data) as T };
  }
  return res;
}
