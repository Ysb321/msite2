"use client";

/** Friendly, actionable setup screen shown when TMDB data can't load
 *  (missing key, rejected key, or network blocked). */
export default function SetupNotice({ error }: { error?: unknown }) {
  const err = error as { message?: string; status?: number; code?: string } | undefined;
  const rejected = err?.status === 401;
  const placeholder = !!err?.message?.includes("PLACEHOLDER");
  const blocked = !rejected && !placeholder && err?.code !== "NO_KEY";

  return (
    <div className="mx-auto my-10 max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-relaxed">
      <h2 className="mb-2 text-base font-bold text-amber-300">
        {rejected
          ? "⚠️ TMDB rejected the API key (401)"
          : placeholder
            ? "⚠️ .env.local still has the example placeholder key"
            : blocked
              ? "⚠️ Can't reach TMDB"
              : "⚠️ TMDB API key isn't set up yet"}
      </h2>

      {rejected ? (
        <p className="mb-3 text-neutral-200">
          The key was pasted incorrectly or is invalid. Re-copy it — no quotes, no extra
          spaces — and make sure it&rsquo;s the <strong>v3 API key</strong> from themoviedb.org.
        </p>
      ) : placeholder ? (
        <p className="mb-3 text-neutral-200">
          You created <code className="rounded bg-black/40 px-1">.env.local</code>, but it still
          contains <code className="rounded bg-black/40 px-1">your_tmdb_v3_api_key</code> — the
          example placeholder. Open the file and replace <strong>both</strong> values with your
          real key:
          <pre className="mt-2 overflow-x-auto rounded bg-black/50 p-2.5 text-[12px] text-neutral-300">
{`TMDB_API_KEY=paste_your_real_key_here
NEXT_PUBLIC_TMDB_API_KEY=paste_your_real_key_here`}
          </pre>
          Then stop the server (<code className="rounded bg-black/40 px-1">Ctrl+C</code>) and run{" "}
          <code className="rounded bg-black/40 px-1">npm run dev</code> again.
        </p>
      ) : blocked ? (
        <p className="mb-3 text-neutral-200">
          Your machine/network couldn&rsquo;t reach <code className="rounded bg-black/40 px-1">api.themoviedb.org</code>.
          Check your internet connection, VPN, DNS or firewall, then retry.
        </p>
      ) : (
        <ol className="mb-3 list-decimal space-y-2 pl-5 text-neutral-200">
          <li>
            In the <strong>project root</strong>, create a file named{" "}
            <code className="rounded bg-black/40 px-1">.env.local</code> — copy{" "}
            <code className="rounded bg-black/40 px-1">.env.example</code> if you have it:
            <pre className="mt-1 overflow-x-auto rounded bg-black/50 p-2.5 text-[12px] text-neutral-300">
{`TMDB_API_KEY=your_key_here
NEXT_PUBLIC_TMDB_API_KEY=your_key_here`}
            </pre>
            <span className="text-[12px] text-neutral-400">
              (Windows cmd: <code>copy .env.example .env.local</code> · PowerShell:{" "}
              <code>Copy-Item .env.example .env.local</code>)
            </span>
          </li>
          <li>
            Get your free key at{" "}
            <a
              className="text-brand underline"
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noreferrer"
            >
              themoviedb.org → Settings → API
            </a>{" "}
            and paste the <strong>same value</strong> into both lines.
          </li>
          <li>
            Stop the dev server (<code className="rounded bg-black/40 px-1">Ctrl+C</code>) and run{" "}
            <code className="rounded bg-black/40 px-1">npm run dev</code> again — env files are
            only read at startup. (For <code>npm run build &amp;&amp; npm start</code>, rebuild too.)
          </li>
        </ol>
      )}

      <p className="text-neutral-400">
        Verify: open{" "}
        <a className="text-brand underline" href="/api/tmdb/trending/movie/week" target="_blank" rel="noreferrer">
          /api/tmdb/trending/movie/week
        </a>{" "}
        — you should see JSON with a <code>results</code> list.
      </p>
      {err?.message && (
        <p className="mt-2 text-[12px] text-neutral-500">Details: {String(err.message)}</p>
      )}
    </div>
  );
}
