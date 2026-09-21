"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { useTmdbSnapshot } from "./SWRProvider";
import { img, titleOf, yearOf, typeOf, prefetchTitleDetails, type Media } from "@/lib/tmdb";
import { useTitleModal } from "@/context/TitleModalContext";
import SmartImage from "./SmartImage";
import { SearchIcon, XIcon } from "./Icons";

/** Netflix-style search: instant results dropdown while typing (no page
 *  navigation), Enter / "View all" opens the full results page. */
export default function SearchBox() {
  const router = useRouter();
  const { openTitleModal } = useTitleModal();
  const pathname = usePathname();
  const onSearchPage = pathname === "/search";
  const [open, setOpen] = useState(onSearchPage);
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sel, setSel] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // sync from URL when arriving on /search
  useEffect(() => {
    if (onSearchPage) {
      setOpen(true);
      const q = new URLSearchParams(window.location.search).get("q") ?? "";
      setValue(q);
      setDebounced(q);
    }
  }, [onSearchPage]);

  // Listen to global shortcut trigger (S or /)
  useEffect(() => {
    const handleGlobalFocus = () => {
      setOpen(true);
      setFocused(true);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    };

    window.addEventListener("focus-global-search", handleGlobalFocus);
    return () => window.removeEventListener("focus-global-search", handleGlobalFocus);
  }, []);

  // debounce the query that drives the live dropdown
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value]);

  // live results (cached by SWR per query — typing back is instant)
  const { data, isLoading } = useTmdbSnapshot<any>(
    debounced.length >= 2 ? `search/multi?query=${encodeURIComponent(debounced)}&include_adult=false&page=1` : null
  );

  const results = useMemo(() => {
    const all: Media[] = data?.results ?? [];
    return {
      titles: all.filter((r) => (r.media_type === "movie" || r.media_type === "tv") && (r.poster_path || r.backdrop_path)).slice(0, 6),
      people: all.filter((r) => r.media_type === "person" && r.profile_path).slice(0, 3),
    };
  }, [data]);

  const flat = useMemo(
    () => [...results.titles.map((t) => ({ kind: "title" as const, item: t })), ...results.people.map((p) => ({ kind: "person" as const, item: p }))],
    [results]
  );
  const showPanel = focused && debounced.length >= 2;
  const total = data?.total_results ?? 0;

  // close on outside click
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const goAllResults = () => {
    setFocused(false);
    inputRef.current?.blur();
    router.push(`/search?q=${encodeURIComponent(debounced)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (!showPanel) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = flat[sel];
      if (entry) {
        setFocused(false);
        if (entry.kind === "title") {
          openTitleModal(entry.item.media_type as "movie" | "tv", entry.item.id, entry.item);
        } else {
          router.push(`/person/${entry.item.id}`);
        }
      } else {
        goAllResults();
      }
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <div
        className={clsx(
          "flex items-center overflow-hidden rounded-sm border transition-all duration-300",
          open
            ? "w-52 border-white/40 bg-black/90 pl-2 sm:w-72"
            : "w-9 cursor-pointer border-transparent hover:border-white/40"
        )}
        onClick={() => {
          if (!open) {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 60);
          }
        }}
      >
        <SearchIcon className="h-5 w-5 shrink-0 text-white" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSel(-1);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder="Titles, people, genres"
          className={clsx(
            "w-full bg-transparent px-2 py-1.5 text-sm text-white outline-none placeholder:text-neutral-400",
            !open && "pointer-events-none"
          )}
          aria-label="Search"
        />
        {open && !value && (
          <span className="hidden items-center pr-2 sm:flex">
            <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400">
              /
            </kbd>
          </span>
        )}
        {open && value && (
          <button
            aria-label="Clear search"
            onClick={(e) => {
              e.stopPropagation();
              setValue("");
              setDebounced("");
              inputRef.current?.focus();
              if (onSearchPage) router.replace("/search", { scroll: false });
            }}
            className="pr-2 text-neutral-400 hover:text-white"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── live results dropdown (no page reload — just this panel) ── */}
      {showPanel && (
        <div
          className="styled-scroll absolute right-0 top-11 z-[120] max-h-[72vh] w-[86vw] overflow-y-auto overscroll-contain rounded-md border border-white/10 bg-[#141414]/98 shadow-2xl backdrop-blur-md sm:w-[400px]"
        >
          {isLoading && flat.length === 0 && (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="skeleton h-[64px] w-[45px]" />
                  <div className="flex-1 space-y-1.5 py-1">
                    <div className="skeleton h-3.5 w-3/4" />
                    <div className="skeleton h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && flat.length === 0 && (
            <p className="px-4 py-4 text-[13px] text-neutral-400">
              No matches for &ldquo;{debounced}&rdquo;.
            </p>
          )}

          {flat.length > 0 && (
            <div className="py-1.5">
              {flat.map((entry, i) => {
                const m = entry.item;
                const active = i === sel;
                if (entry.kind === "title") {
                  return (
                    <button
                      key={`${entry.kind}-${m.id}`}
                      type="button"
                      onClick={() => {
                        setFocused(false);
                        openTitleModal(m.media_type as "movie" | "tv", m.id, m);
                      }}
                      onMouseEnter={() => {
                        setSel(i);
                        prefetchTitleDetails(m.media_type as "movie" | "tv", m.id);
                      }}
                      className={clsx(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition",
                        active ? "bg-white/10" : "hover:bg-white/10"
                      )}
                    >
                      <div className="h-[64px] w-[45px] shrink-0 overflow-hidden rounded-sm bg-neutral-900">
                        <SmartImage
                          src={img(m.poster_path ?? m.backdrop_path, "w92")}
                          fallbackSrc={img(m.backdrop_path, "w300")}
                          alt={titleOf(m)}
                          title={titleOf(m)}
                          year={yearOf(m)}
                          aspectRatio="poster"
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-neutral-100">{titleOf(m)}</p>
                        <p className="truncate text-[11px] text-neutral-500">
                          {`${typeOf(m) === "tv" ? "TV Show" : "Movie"}${yearOf(m) ? ` · ${yearOf(m)}` : ""}`}
                        </p>
                      </div>
                    </button>
                  );
                }

                const profileImg = img(m.profile_path, "w185");

                return (
                  <Link
                    key={`${entry.kind}-${m.id}`}
                    href={`/person/${m.id}`}
                    onClick={() => setFocused(false)}
                    onMouseEnter={() => setSel(i)}
                    className={clsx(
                      "flex items-center gap-2.5 px-3 py-2 transition",
                      active ? "bg-white/10" : "hover:bg-white/10"
                    )}
                  >
                    <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-800 text-xs font-bold text-neutral-300 ring-1 ring-white/10">
                      {profileImg ? (
                        <SmartImage
                          src={profileImg}
                          alt={titleOf(m)}
                          title={titleOf(m)}
                          aspectRatio="square"
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span>{titleOf(m)?.[0] || "👤"}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-neutral-100">{titleOf(m)}</p>
                      <p className="truncate text-[11px] text-neutral-500">
                        Actor — see movies & series
                      </p>
                    </div>
                  </Link>
                );
              })}

              <button
                onClick={goAllResults}
                onMouseEnter={() => setSel(flat.length)}
                className={clsx(
                  "mt-1 flex w-full items-center justify-between border-t border-white/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-sky-400 transition hover:bg-white/10",
                  sel === flat.length && "bg-white/10"
                )}
              >
                <span>{total > flat.length ? `View all ${total.toLocaleString()} results` : "View all results"}</span>
                <span aria-hidden>→</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
