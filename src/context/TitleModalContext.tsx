"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import TitleDetailModal from "@/components/TitleDetailModal";
import { prefetchTitleDetails } from "@/lib/tmdb";

interface TitleModalContextValue {
  isOpen: boolean;
  type: "movie" | "tv";
  id: number | null;
  initialData?: any;
  openTitleModal: (type: "movie" | "tv" | string, id: number | string, initialData?: any) => void;
  closeTitleModal: () => void;
}

const TitleModalContext = createContext<TitleModalContextValue | undefined>(undefined);

export function TitleModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<"movie" | "tv">("movie");
  const [id, setId] = useState<number | null>(null);
  const [initialData, setInitialData] = useState<any>(null);
  const location = useLocation();

  // Close modal when navigating to a new main route (like /watch, /categories, etc.)
  useEffect(() => {
    if (location.pathname.startsWith("/watch")) {
      setIsOpen(false);
    }
  }, [location.pathname]);

  const openTitleModal = useCallback((mediaType: "movie" | "tv" | string, mediaId: number | string, initData?: any) => {
    const t = mediaType === "tv" ? "tv" : "movie";
    const numId = typeof mediaId === "string" ? parseInt(mediaId, 10) : mediaId;
    if (!isNaN(numId) && numId > 0) {
      setType(t);
      setId(numId);
      setInitialData(initData ?? null);
      setIsOpen(true);
      // Trigger background prefetch immediately
      prefetchTitleDetails(t, numId);
    }
  }, []);

  const closeTitleModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <TitleModalContext.Provider
      value={{
        isOpen,
        type,
        id,
        initialData,
        openTitleModal,
        closeTitleModal,
      }}
    >
      {children}
      {isOpen && id !== null && (
        <TitleDetailModal
          type={type}
          id={id}
          initialData={initialData}
          onClose={closeTitleModal}
          onSelectTitle={(nextType, nextId, nextInit) => openTitleModal(nextType, nextId, nextInit)}
        />
      )}
    </TitleModalContext.Provider>
  );
}

const defaultContextValue: TitleModalContextValue = {
  isOpen: false,
  type: "movie",
  id: null,
  openTitleModal: (_type, _id) => {
    // If called outside provider, silently no-op or fallback to direct navigation if needed
  },
  closeTitleModal: () => {},
};

export function useTitleModal(): TitleModalContextValue {
  const ctx = useContext(TitleModalContext);
  if (!ctx) {
    return defaultContextValue;
  }
  return ctx;
}
