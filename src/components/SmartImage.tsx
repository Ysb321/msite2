"use client";

import { useState, useEffect, useRef, memo } from "react";
import clsx from "clsx";
import { placeholderPoster } from "@/lib/tmdb";

interface SmartImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
  fallbackSrc?: string | null;
  alt: string;
  title?: string;
  year?: string | number;
  aspectRatio?: "poster" | "backdrop" | "square" | "custom";
  priority?: boolean;
  className?: string;
  containerClassName?: string;
}

function SmartImage({
  src,
  fallbackSrc,
  alt,
  title,
  year,
  aspectRatio,
  priority = false,
  className,
  containerClassName,
  draggable = false,
  loading,
  decoding = "async",
  referrerPolicy = "no-referrer",
  ...rest
}: SmartImageProps) {
  const isInitialDataUri = Boolean(src && src.startsWith("data:"));
  const [currentSrc, setCurrentSrc] = useState<string | null>(src ?? null);
  const [isLoaded, setIsLoaded] = useState<boolean>(!src || isInitialDataUri);
  const [hasError, setHasError] = useState(false);
  const [retryStage, setRetryStage] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);

  // Sync state whenever primary src changes
  useEffect(() => {
    if (!src) {
      setCurrentSrc(null);
      setIsLoaded(true);
      setHasError(false);
      setRetryStage(0);
      return;
    }
    const isData = src.startsWith("data:");
    setCurrentSrc(src);
    setIsLoaded(isData);
    setHasError(false);
    setRetryStage(0);
  }, [src]);

  // Check if image is already cached and loaded immediately after render
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0 && !isLoaded) {
      setIsLoaded(true);
    }
  }, [currentSrc, isLoaded]);

  const handleError = () => {
    // Stage 0 -> 1: Try fallbackSrc if provided
    if (retryStage === 0 && fallbackSrc && fallbackSrc !== currentSrc) {
      setRetryStage(1);
      setCurrentSrc(fallbackSrc);
      return;
    }

    // Stage 1 -> 2: Try alternate CDN mirror if it's TMDB
    if (currentSrc && currentSrc.includes("image.tmdb.org")) {
      const altUrl = currentSrc.replace("image.tmdb.org", "images.tmdb.org");
      if (altUrl !== currentSrc && retryStage < 2) {
        setRetryStage(2);
        setCurrentSrc(altUrl);
        return;
      }
    }

    // Stage 2 -> 3: Try our reliable server-side image proxy
    if (currentSrc && (currentSrc.includes("image.tmdb.org") || currentSrc.includes("images.tmdb.org"))) {
      try {
        const urlObj = new URL(currentSrc);
        const parts = urlObj.pathname.replace(/^\/t\/p\//, "").split("/");
        const size = parts[0] || "w500";
        const pathPart = parts.slice(1).join("/");
        if (pathPart && retryStage < 3) {
          setRetryStage(3);
          setCurrentSrc(`/api/tmdb-image/${size}/${pathPart}`);
          return;
        }
      } catch {
        // Continue to final fallback
      }
    }

    // Final Stage: Fallback to high-quality responsive vector SVG placeholder
    setHasError(true);
    setCurrentSrc(placeholderPoster(title || alt || "Yetflix", year));
    setIsLoaded(true);
  };

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const finalSrc = currentSrc || placeholderPoster(title || alt || "Yetflix", year);
  const isDataUri = finalSrc.startsWith("data:");

  return (
    <div
      className={clsx(
        "relative overflow-hidden bg-panel-2",
        aspectRatio === "poster" && "aspect-[2/3]",
        aspectRatio === "backdrop" && "aspect-video",
        aspectRatio === "square" && "aspect-square",
        containerClassName
      )}
    >
      {/* Loading Shimmer Skeleton (only while waiting for remote image) */}
      {!isLoaded && !isDataUri && !hasError && (
        <div className="absolute inset-0 z-0 animate-pulse bg-gradient-to-r from-white/5 via-white/10 to-white/5 bg-[length:200%_100%]" />
      )}

      {/* Actual Rendered Image */}
      <img
        ref={imgRef}
        src={finalSrc}
        alt={alt}
        loading={priority ? "eager" : (loading ?? "lazy")}
        decoding={decoding}
        referrerPolicy={referrerPolicy}
        draggable={draggable}
        onLoad={handleLoad}
        onError={handleError}
        className={clsx(
          "h-full w-full object-cover transition-opacity duration-300",
          isLoaded || isDataUri ? "opacity-100" : "opacity-0",
          className
        )}
        {...(priority && { fetchPriority: "high" as const })}
        {...rest}
      />
    </div>
  );
}

export default memo(SmartImage);
