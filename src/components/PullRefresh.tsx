"use client";

import PullToRefresh from "react-simple-pull-to-refresh";
import { useSWRConfig } from "swr";

/** Touch pull-to-refresh for mobile/tablet (github.com/lyhimy/react-simple-pull-to-refresh).
 *  Activates ONLY on touch input - desktop scrolling/UX completely unaffected.
 *  onRefresh revalidates every SWR (TMDB) key in the cache, so all rows and
 *  grids on the page refetch without a full page reload. */
export default function PullRefresh({ children }: { children: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  return (
    <PullToRefresh
      onRefresh={async () => {
        await mutate(() => true);
      }}
      pullDownThreshold={72}
      maxPullDownDistance={110}
      resistance={1.8}
      backgroundColor="#0b0b0f"
      className="w-full"
      pullingContent={
        <span className="inline-block py-3 text-sm text-neutral-500">Pull down to refresh</span>
      }
      refreshingContent={
        <span className="inline-block py-3 text-sm font-semibold text-brand">Refreshing…</span>
      }
    >
      <div>{children}</div>
    </PullToRefresh>
  );
}
