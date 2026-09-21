"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { Media } from "@/lib/tmdb";
import ExploreAllModal from "@/components/ExploreAllModal";

export interface ExploreAllConfig {
  title: string;
  subtitle?: string;
  sources?: [string, Record<string, string | number>][];
  endpoint?: string;
  initialItems?: Media[];
  mediaType?: "movie" | "tv" | "all";
  variant?: "poster" | "backdrop";
  top10?: boolean;
  pick?: (items: Media[]) => Media[];
}

interface ExploreAllContextValue {
  openExploreAll: (config: ExploreAllConfig) => void;
  closeExploreAll: () => void;
  isOpen: boolean;
  config: ExploreAllConfig | null;
}

const ExploreAllContext = createContext<ExploreAllContextValue | undefined>(undefined);

export function ExploreAllProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<ExploreAllConfig | null>(null);
  const location = useLocation();

  // Close modal whenever route changes
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname, location.search]);

  const openExploreAll = useCallback((cfg: ExploreAllConfig) => {
    setConfig(cfg);
    setIsOpen(true);
  }, []);

  const closeExploreAll = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <ExploreAllContext.Provider
      value={{
        openExploreAll,
        closeExploreAll,
        isOpen,
        config,
      }}
    >
      {children}
      {isOpen && config && (
        <ExploreAllModal config={config} onClose={closeExploreAll} />
      )}
    </ExploreAllContext.Provider>
  );
}

const defaultExploreAllValue: ExploreAllContextValue = {
  openExploreAll: () => {},
  closeExploreAll: () => {},
  isOpen: false,
  config: null,
};

export function useExploreAll(): ExploreAllContextValue {
  const ctx = useContext(ExploreAllContext);
  if (!ctx) {
    return defaultExploreAllValue;
  }
  return ctx;
}
