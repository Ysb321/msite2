import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  getList,
  addToList as storageAdd,
  removeFromList as storageRemove,
  clearListStorage,
  onListChange,
  onActiveProfileChange,
  type ListItem,
} from "@/lib/storage";
import { Check, Bookmark, X, Undo2 } from "lucide-react";

export type { ListItem };

export interface ToastState {
  id: number;
  message: string;
  item?: ListItem;
  action?: "add" | "remove" | "clear";
}

export interface MyListContextValue {
  list: ListItem[];
  count: number;
  isLoaded: boolean;
  inList: (id: number) => boolean;
  addToList: (item: ListItem) => void;
  removeFromList: (id: number) => void;
  toggleList: (item: ListItem) => void;
  clearList: () => void;
}

const MyListContext = createContext<MyListContextValue | undefined>(undefined);

export function MyListProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ListItem[]>(() => getList());
  const [isLoaded, setIsLoaded] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Sync list from storage on mount, cross-tab, and on profile change
  useEffect(() => {
    setList(getList());
    setIsLoaded(true);

    const unsubList = onListChange((newList) => {
      setList(newList);
    });

    const unsubProfile = onActiveProfileChange(() => {
      setList(getList());
    });

    return () => {
      unsubList();
      unsubProfile();
    };
  }, []);

  // Dismiss toast after duration
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const inList = useCallback(
    (id: number) => list.some((item) => item.id === id),
    [list]
  );

  const addToList = useCallback((item: ListItem) => {
    storageAdd(item);
    setList((prev) => {
      if (prev.some((i) => i.id === item.id)) return prev;
      return [item, ...prev];
    });
    setToast({
      id: Date.now(),
      message: "Added to My List",
      item,
      action: "add",
    });
  }, []);

  const removeFromList = useCallback(
    (id: number) => {
      const removedItem = list.find((i) => i.id === id);
      storageRemove(id);
      setList((prev) => prev.filter((i) => i.id !== id));
      setToast({
        id: Date.now(),
        message: "Removed from My List",
        item: removedItem,
        action: "remove",
      });
    },
    [list]
  );

  const toggleList = useCallback(
    (item: ListItem) => {
      if (inList(item.id)) {
        removeFromList(item.id);
      } else {
        addToList(item);
      }
    },
    [inList, removeFromList, addToList]
  );

  const clearList = useCallback(() => {
    clearListStorage();
    setList([]);
    setToast({
      id: Date.now(),
      message: "My List cleared",
      action: "clear",
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (!toast) return;
    if (toast.action === "remove" && toast.item) {
      storageAdd(toast.item);
      setList((prev) => [toast.item!, ...prev]);
      setToast({
        id: Date.now(),
        message: "Restored to My List",
        action: "add",
      });
    } else if (toast.action === "add" && toast.item) {
      storageRemove(toast.item.id);
      setList((prev) => prev.filter((i) => i.id !== toast.item!.id));
      setToast(null);
    }
  }, [toast]);

  const value = useMemo<MyListContextValue>(
    () => ({
      list,
      count: list.length,
      isLoaded,
      inList,
      addToList,
      removeFromList,
      toggleList,
      clearList,
    }),
    [list, isLoaded, inList, addToList, removeFromList, toggleList, clearList]
  );

  return (
    <MyListContext.Provider value={value}>
      {children}

      {/* Floating Feedback Toast */}
      {toast && (
        <aside
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-neutral-700/80 bg-neutral-900/95 px-4 py-2.5 text-sm font-medium text-white shadow-2xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-3"
        >
          {toast.action === "add" ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <Check className="h-3.5 w-3.5" />
            </span>
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-neutral-300">
              <Bookmark className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="truncate max-w-[220px] sm:max-w-xs">
            {toast.item?.title ? (
              <>
                <span className="font-semibold text-neutral-200">
                  {toast.item.title}
                </span>{" "}
                — {toast.message.toLowerCase()}
              </>
            ) : (
              toast.message
            )}
          </span>

          {toast.action === "remove" && toast.item && (
            <button
              onClick={handleUndo}
              className="ml-2 flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-brand hover:bg-neutral-700 hover:text-red-400 transition"
            >
              <Undo2 className="h-3 w-3" /> Undo
            </button>
          )}

          <button
            onClick={() => setToast(null)}
            className="ml-1 rounded p-1 text-neutral-400 hover:text-white"
            aria-label="Close notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </aside>
      )}
    </MyListContext.Provider>
  );
}

const defaultMyListValue: MyListContextValue = {
  list: [],
  count: 0,
  isLoaded: true,
  inList: () => false,
  addToList: () => {},
  removeFromList: () => {},
  toggleList: () => {},
  clearList: () => {},
};

export function useMyList(): MyListContextValue {
  const context = useContext(MyListContext);
  if (!context) {
    return defaultMyListValue;
  }
  return context;
}
