"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import { useTitleModal } from "@/context/TitleModalContext";
import { useExploreAll } from "@/context/ExploreAllContext";
import clsx from "clsx";
import {
  Compass,
  Search,
  Bookmark,
  Film,
  Tv,
  Sparkles,
  Layers,
  User,
  ArrowDown,
  ArrowUp,
  RotateCcw,
  Keyboard,
} from "lucide-react";

interface ToastInfo {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface KeyboardShortcutsContextValue {
  isShortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  toggleShortcuts: () => void;
  executeShortcut: (key: string) => void;
}

const KeyboardShortcutsContext = createContext<
  KeyboardShortcutsContextValue | undefined
>(undefined);

function isUserTyping(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toLowerCase();
  const isInput = tag === "input" || tag === "textarea" || tag === "select";
  const isContentEditable = target.isContentEditable;
  const isRoleInput =
    target.getAttribute("role") === "textbox" ||
    target.getAttribute("role") === "searchbox";

  return isInput || isContentEditable || isRoleInput;
}

export function KeyboardShortcutsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isOpen: titleModalOpen, closeTitleModal } = useTitleModal();
  const { isOpen: exploreOpen, closeExploreAll } = useExploreAll();

  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<ToastInfo | null>(null);

  const showToast = useCallback((info: ToastInfo) => {
    setToast(info);
    const t = setTimeout(() => {
      setToast((curr) => (curr?.key === info.key ? null : curr));
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  const openShortcuts = useCallback(() => setIsShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setIsShortcutsOpen(false), []);
  const toggleShortcuts = useCallback(
    () => setIsShortcutsOpen((prev) => !prev),
    []
  );

  const executeShortcut = useCallback(
    (keyChar: string) => {
      const lower = keyChar.toLowerCase();

      switch (lower) {
        case "h":
          if (pathname !== "/home") {
            router.push("/home");
            showToast({
              key: "H",
              label: "Home",
              icon: <Compass className="h-4 w-4" />,
            });
          }
          break;

        case "s":
        case "/": {
          showToast({
            key: lower === "/" ? "/" : "S",
            label: "Search",
            icon: <Search className="h-4 w-4" />,
          });
          // Dispatch event to focus Navbar search bar or route to /search
          const dispatched = window.dispatchEvent(
            new CustomEvent("focus-global-search")
          );
          if (pathname !== "/search" && !document.querySelector("input[aria-label='Search']")) {
            router.push("/search");
          }
          break;
        }

        case "l":
          if (pathname !== "/my-list") {
            router.push("/my-list");
            showToast({
              key: "L",
              label: "My List",
              icon: <Bookmark className="h-4 w-4" />,
            });
          }
          break;

        case "m":
          // Only navigate if not on watch page (where M might be used for mute)
          if (!pathname.startsWith("/watch") && pathname !== "/movies") {
            router.push("/movies");
            showToast({
              key: "M",
              label: "Movies",
              icon: <Film className="h-4 w-4" />,
            });
          }
          break;

        case "t":
          if (pathname !== "/tv") {
            router.push("/tv");
            showToast({
              key: "T",
              label: "TV Shows",
              icon: <Tv className="h-4 w-4" />,
            });
          }
          break;

        case "a":
          if (pathname !== "/anime") {
            router.push("/anime");
            showToast({
              key: "A",
              label: "Anime",
              icon: <Sparkles className="h-4 w-4" />,
            });
          }
          break;

        case "c":
          if (pathname !== "/categories") {
            router.push("/categories");
            showToast({
              key: "C",
              label: "Categories",
              icon: <Layers className="h-4 w-4" />,
            });
          }
          break;

        case "p":
          if (pathname !== "/") {
            router.push("/");
            showToast({
              key: "P",
              label: "Profiles",
              icon: <User className="h-4 w-4" />,
            });
          }
          break;

        case "j":
          window.scrollBy({ top: 480, behavior: "smooth" });
          showToast({
            key: "J",
            label: "Scroll Down",
            icon: <ArrowDown className="h-4 w-4" />,
          });
          break;

        case "k":
          // If not in watch video mode, scroll up
          if (!pathname.startsWith("/watch")) {
            window.scrollBy({ top: -480, behavior: "smooth" });
            showToast({
              key: "K",
              label: "Scroll Up",
              icon: <ArrowUp className="h-4 w-4" />,
            });
          }
          break;

        case "g":
          window.scrollTo({ top: 0, behavior: "smooth" });
          showToast({
            key: "G",
            label: "Scroll to Top",
            icon: <RotateCcw className="h-4 w-4" />,
          });
          break;

        case "?":
          toggleShortcuts();
          showToast({
            key: "?",
            label: isShortcutsOpen ? "Closed Help" : "Shortcut Guide",
            icon: <Keyboard className="h-4 w-4" />,
          });
          break;

        default:
          break;
      }
    },
    [
      pathname,
      router,
      showToast,
      toggleShortcuts,
      isShortcutsOpen,
    ]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if modifier keys like Ctrl / Meta / Alt are pressed (unless it's '?' which is Shift+/)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // When user is typing inside an input/textarea
      if (isUserTyping(e.target)) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      // Handle Escape for all open modals
      if (e.key === "Escape") {
        if (isShortcutsOpen) {
          setIsShortcutsOpen(false);
          return;
        }
        if (titleModalOpen) {
          closeTitleModal();
          return;
        }
        if (exploreOpen) {
          closeExploreAll();
          return;
        }
        return;
      }

      // Forward slash prevents default browser quick-find
      if (e.key === "/" || e.key === "?") {
        e.preventDefault();
      }

      executeShortcut(e.key);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    executeShortcut,
    isShortcutsOpen,
    titleModalOpen,
    exploreOpen,
    closeTitleModal,
    closeExploreAll,
  ]);

  return (
    <KeyboardShortcutsContext.Provider
      value={{
        isShortcutsOpen,
        openShortcuts,
        closeShortcuts,
        toggleShortcuts,
        executeShortcut,
      }}
    >
      {children}

      {/* Global Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={closeShortcuts}
        onExecuteShortcut={executeShortcut}
      />

      {/* Floating HUD Indicator Toast */}
      {toast && (
        <div
          id="keyboard-hud-toast"
          className="pointer-events-none fixed bottom-20 right-6 z-[300] flex items-center gap-2.5 rounded-xl border border-white/25 bg-[#16161e]/95 px-3.5 py-2 text-white shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 md:bottom-8"
        >
          {toast.icon && (
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/20 text-brand">
              {toast.icon}
            </div>
          )}
          <span className="text-xs font-semibold tracking-wide text-neutral-200">
            {toast.label}
          </span>
          <kbd className="flex h-5 min-w-[20px] items-center justify-center rounded border border-white/20 bg-neutral-800 px-1.5 text-[10px] font-bold text-white shadow-sm">
            {toast.key}
          </kbd>
        </div>
      )}
    </KeyboardShortcutsContext.Provider>
  );
}

const defaultContextValue: KeyboardShortcutsContextValue = {
  isShortcutsOpen: false,
  openShortcuts: () => {},
  closeShortcuts: () => {},
  toggleShortcuts: () => {},
  executeShortcut: () => {},
};

export function useKeyboardShortcuts(): KeyboardShortcutsContextValue {
  const ctx = useContext(KeyboardShortcutsContext);
  if (!ctx) {
    return defaultContextValue;
  }
  return ctx;
}
