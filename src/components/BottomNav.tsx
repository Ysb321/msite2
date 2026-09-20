"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useEffect } from "react";

/** Mobile bottom tab bar (Material Design 3 navigation-bar pattern:
 *  m3.material.io/components/navigation-bar — thumb-zone destinations,
 *  active pill indicator, safe-area aware). Desktop keeps the top navbar.
 *  Hidden on /watch (video-first screen). */
const TABS = [
  {
    href: "/home",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/movies",
    label: "Movies",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/tv",
    label: "TV",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="m8 3 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/anime",
    label: "Anime",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path d="M12 3c4.9 0 9 3.6 9 8s-4.1 8-9 8c-1.2 0-2.4-.2-3.5-.6L4 20l1-3.6C3.7 15 3 13.1 3 11c0-4.4 4.1-8 9-8Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 11.5h.01M15.5 11.5h.01" strokeLinecap="round" strokeWidth={2.4} />
      </svg>
    ),
  },
  {
    href: "/my-list",
    label: "My List",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const visible = !pathname.startsWith("/watch");

  /* pages with the bar reserve space at the bottom (see globals.css) */
  useEffect(() => {
    if (visible) document.body.setAttribute("data-bottomnav", "");
    else document.body.removeAttribute("data-bottomnav");
    return () => document.body.removeAttribute("data-bottomnav");
  }, [visible]);

  if (!visible) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-[80] flex items-stretch justify-around border-t border-white/10 bg-[#0b0b0f]/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className="group flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
          >
            <span
              className={clsx(
                "flex items-center justify-center rounded-full px-3.5 py-0.5 transition-colors",
                active ? "bg-brand/15 text-brand" : "text-neutral-400 group-active:text-neutral-200"
              )}
            >
              {t.icon}
            </span>
            <span
              className={clsx(
                "text-[10px] font-medium leading-none",
                active ? "text-brand" : "text-neutral-500"
              )}
            >
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
