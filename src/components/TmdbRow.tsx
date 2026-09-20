"use client";

import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import Row from "./Row";
import { swrFetcher, type Media, type ProgressItem } from "@/lib/tmdb";
import { interleave, type RowDef } from "@/lib/rows";

const MAX_PAGES = 6; // ~120 items per row — paged in as you browse

const inferType = (path: string): "movie" | "tv" | undefined => {
  if (path.includes("multi")) return undefined;
  if (path.startsWith("movie") || path.includes("/movie")) return "movie";
  if (path.startsWith("tv") || path.includes("/tv")) return "tv";
  return undefined;
};

/** Loads a declarative RowDef. Single-source rows page in endlessly as the
 *  user pages horizontally (useSWRInfinite); multi-source rows interleave. */
export default function TmdbRow({
  def,
  progressItems,
  onRemove,
}: {
  def: RowDef;
  progressItems?: Map<number, ProgressItem>;
  onRemove?: (id: number) => void;
}) {
  const single = def.sources.length === 1 ? def.sources[0] : null;

  const getKey = useCallback(
    (index: number) => {
      if (!single) return null;
      const [path, params] = single;
      const p = new URLSearchParams(params as Record<string, string>);
      p.set("page", String(index + 1));
      return `${path}?${p.toString()}`;
    },
    [single]
  );

  const infinite = useSWRInfinite<any>(single ? getKey : () => null, swrFetcher, {
    revalidateFirstPage: false,
    revalidateAll: false,
    initialSize: 1,
    keepPreviousData: true,
  });

  // multi-source fallback hooks (first page only)
  const keys = def.sources.map(([path, params]) => `${path}?${new URLSearchParams(params as any)}`);
  const multiA = useSWRInfinite(!single ? () => keys[0] : () => null, swrFetcher, { initialSize: 1 });
  const multiB = useSWRInfinite(!single && keys[1] ? () => keys[1] : () => null, swrFetcher, { initialSize: 1 });
  const multiC = useSWRInfinite(!single && keys[2] ? () => keys[2] : () => null, swrFetcher, { initialSize: 1 });

  const { items, loading, loadingMore, canLoadMore, loadMore } = useMemo(() => {
    if (single) {
      const pages = infinite.data ?? [];
      const seen = new Set<number>();
      const out: Media[] = [];
      const forced = inferType(single[0]);
      for (const page of pages)
        for (const r of page?.results ?? []) {
          if (r && !seen.has(r.id)) {
            seen.add(r.id);
            out.push(forced ? { ...r, media_type: forced } : r);
          }
        }
      const total = pages[0]?.total_pages ?? 1;
      return {
        items: out,
        loading: pages.length === 0 && infinite.isLoading,
        loadingMore: infinite.isValidating && pages.length > 0 && pages.length < infinite.size,
        canLoadMore: infinite.size < Math.min(total, MAX_PAGES),
        loadMore: () => infinite.setSize(infinite.size + 1),
      };
    }
    const lists = [multiA, multiB, multiC]
      .filter((s) => s && s.data)
      .map((s) => (s.data?.[0]?.results ?? []) as Media[]);
    const anyLoading = [multiA, multiB, multiC].some((s) => s && !s.data && s.isLoading);
    const merged = lists.length <= 1 ? lists[0] ?? [] : interleave(lists);
    return { items: merged, loading: anyLoading, loadingMore: false, canLoadMore: false, loadMore: undefined };
  }, [single, infinite.data, infinite.isLoading, infinite.isValidating, infinite.size, infinite.setSize, multiA, multiB, multiC]);

  const finalItems = def.pick ? def.pick(items) : items;

  if (!loading && finalItems.length === 0) return null;

  return (
    <Row
      title={def.title}
      items={finalItems}
      variant={def.variant}
      top10={def.top10}
      loading={loading}
      href={def.href}
      progressItems={progressItems}
      onRemove={onRemove}
      onRequestMore={canLoadMore ? loadMore : undefined}
      moreLoading={loadingMore}
    />
  );
}
