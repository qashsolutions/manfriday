"use client";

import { useState, useCallback, useEffect } from "react";

interface ImageViewerProps {
  src: string;
  alt?: string;
}

export default function ImageViewer({ src, alt = "Image" }: ImageViewerProps) {
  const [fullscreen, setFullscreen] = useState(false);

  const open = () => setFullscreen(true);
  const close = useCallback(() => setFullscreen(false), []);

  // Close on Escape
  useEffect(() => {
    if (!fullscreen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("keydown", handleKey);
    // Prevent body scroll
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen, close]);

  return (
    <>
      {/* Thumbnail */}
      <button
        onClick={open}
        className="cursor-zoom-in rounded-lg overflow-hidden border border-surface-3 hover:border-accent transition-colors inline-block"
      >
        <img src={src} alt={alt} className="max-w-full h-auto" />
      </button>

      {/* Full-screen overlay */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          {/* Close button */}
          <button
            onClick={close}
            className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-surface-2 border border-surface-3 text-gray-300 hover:text-white hover:bg-surface-3 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {/* Full-size image */}
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
