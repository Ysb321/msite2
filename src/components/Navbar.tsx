"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { createPortal } from "react-dom";
import { isKidsActive } from "@/lib/storage";
import SearchBox from "./SearchBox";
import BottomNav from "./BottomNav";
import Avatar from "./Avatar";
import { getActiveProfile, getProfiles, onActiveProfileChange, setActiveProfile, type Profile } from "@/lib/storage";
import { ChevronIcon } from "./Icons";

const LINKS = [
  { href: "/home", label: "Home" },
  { href: "/tv", label: "TV Shows" },
  { href: "/movies", label: "Movies" },
  { href: "/anime", label: "Anime" },
  { href: "/categories", label: "Categories" },
  { href: "/my-list", label: "My List" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [afterPin, setAfterPin] = useState<null | (() => void)>(null);
  const pathname = usePathname();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const browseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProfile(getActiveProfile());
    return onActiveProfileChange(setProfile);
  }, []);

  /** Kids mode: sensitive actions (switch profile / manage / sign out)
   *  require the parent PIN (1234) before running. */
  const guarded = (action: () => void) => {
    if (!profile?.kids) { action(); return; }
    setPin(""); setPinError(false);
    setAfterPin(() => action);
    setPinOpen(true);
  };
  const submitPin = () => {
    if (pin === "1234") {
      setPinOpen(false);
      const fn = afterPin; setAfterPin(null);
      fn?.();
    } else {
      setPinError(true);
    }
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (browseRef.current && !browseRef.current.contains(e.target as Node)) setBrowseOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <header
      className={clsx(
        "fixed inset-x-0 top-0 z-[90] transition-colors duration-500",
        scrolled ? "bg-[#0b0b0f] shadow-lg" : "bg-gradient-to-b from-black/80 via-black/40 to-transparent"
      )}
    >
      <nav className="flex h-14 items-center gap-6 px-[4vw] md:h-[60px]">
        <Link href="/home" className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-display text-[26px] tracking-tight text-brand md:text-[30px]">YETFLIX</span>
          <span className="hidden text-[11px] font-semibold tracking-wide text-neutral-400 sm:inline">by Yashraj</span>
        </Link>

        {/* desktop links */}
        <div className="hidden items-center gap-4 text-[13.5px] md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "relative transition-colors hover:text-neutral-300",
                pathname.startsWith(l.href) ? "font-semibold text-white" : "text-neutral-200"
              )}
            >
              {l.label}
              {pathname.startsWith(l.href) && (
                <span className="absolute -bottom-[9px] left-0 h-[2.5px] w-full rounded-full bg-brand" />
              )}
            </Link>
          ))}
        </div>

        {/* mobile browse dropdown */}
        <div className="relative md:hidden" ref={browseRef}>
          <button
            onClick={() => setBrowseOpen((v) => !v)}
            className="flex items-center gap-1 text-[13px] text-neutral-200"
          >
            Browse <ChevronIcon className="h-3.5 w-3.5" />
          </button>
          {browseOpen && (
            <div className="absolute left-0 top-9 w-44 border-t-2 border-white bg-black/95 py-2 text-sm">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setBrowseOpen(false)}
                  className="block px-4 py-2 text-center text-neutral-200 hover:bg-white/10"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3 md:gap-4">
          <SearchBox />
          <Link href="/my-list" aria-label="My List" className="hidden text-neutral-200 hover:text-white sm:block">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path d="M4 6h16M4 12h10M4 18h7" strokeLinecap="round" />
            </svg>
          </Link>

          {/* profile menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5"
              aria-label="Profile menu"
            >
              <Avatar color={profile?.color ?? "#5e17eb"} kids={profile?.kids} className="h-8 w-8" />
              <ChevronIcon className={clsx("hidden h-3.5 w-3.5 text-white transition-transform sm:block", menuOpen && "rotate-90")} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 w-56 border-t-2 border-white bg-black/95 py-2.5 text-sm text-neutral-200 shadow-2xl">
                {getProfiles()
                  .filter((p) => p.id !== profile?.id)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => guarded(() => {
                        setActiveProfile(p);
                        setProfile(p);
                        setMenuOpen(false);
                        router.refresh();
                      })}
                      className="flex w-full items-center gap-3 px-4 py-2 hover:underline"
                    >
                      <Avatar color={p.color} kids={p.kids} className="h-7 w-7" />
                      {p.name}
                    </button>
                  ))}
                <div className="my-2 border-t border-white/20" />
                <Link href="/my-list" onClick={() => setMenuOpen(false)} className="block px-4 py-1.5 hover:underline">
                  My List
                </Link>
                <Link href="/" onClick={(e) => { e.preventDefault(); guarded(() => { setMenuOpen(false); router.push("/"); }); }} className="block px-4 py-1.5 hover:underline">
                  Manage Profiles
                </Link>
                <button
                  onClick={() => guarded(() => {
                    setActiveProfile(null);
                    router.push("/");
                  })}
                  className="block w-full px-4 py-1.5 text-left hover:underline"
                >
                  Sign out of Yetflix
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>
          <BottomNav />
      {pinOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setPinOpen(false)}
          >
            <div
              className="w-[min(92vw,340px)] rounded-xl border border-white/10 bg-[#141414] p-6 text-center shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-1 text-lg font-bold">Parental control</p>
              <p className="mb-4 text-[13px] text-neutral-400">Enter the PIN to continue</p>
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinError(false); }}
                onKeyDown={(e) => e.key === "Enter" && submitPin()}
                placeholder="••••"
                className={clsx(
                  "w-full rounded-md border bg-black/60 px-4 py-3 text-center text-2xl tracking-[0.6em] text-white outline-none",
                  pinError ? "border-brand" : "border-white/15 focus:border-white/40"
                )}
              />
              {pinError && <p className="mt-2 text-[12px] font-semibold text-brand">Wrong PIN. Try again.</p>}
              <div className="mt-4 flex gap-2">
                <button onClick={() => setPinOpen(false)} className="flex-1 rounded-md bg-white/10 py-2.5 text-sm font-semibold text-neutral-300 transition hover:bg-white/20">
                  Cancel
                </button>
                <button onClick={submitPin} className="flex-1 rounded-md bg-brand py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark">
                  Unlock
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
