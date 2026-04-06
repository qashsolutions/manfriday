"use client";

import { useState, useMemo } from "react";
import { Marp } from "@marp-team/marp-core";

interface MarpViewerProps {
  markdown: string;
}

export default function MarpViewer({ markdown }: MarpViewerProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const { slides, css } = useMemo(() => {
    const marp = new Marp();
    const { html, css: renderedCss } = marp.render(markdown);

    // Marp wraps each slide in a <section> tag
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const sections = doc.querySelectorAll("section");
    const slideHtmls = Array.from(sections).map((s) => s.outerHTML);

    return { slides: slideHtmls, css: renderedCss };
  }, [markdown]);

  const totalSlides = slides.length;

  const goToPrev = () => setCurrentSlide((s) => Math.max(0, s - 1));
  const goToNext = () => setCurrentSlide((s) => Math.min(totalSlides - 1, s + 1));

  if (totalSlides === 0) {
    return (
      <div className="p-4 text-gray-400 text-sm">No slides found in markdown.</div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Slide viewport */}
      <div className="w-full max-w-4xl bg-white rounded-lg overflow-hidden shadow-lg">
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div
          className="marp-slide"
          dangerouslySetInnerHTML={{ __html: slides[currentSlide] }}
        />
      </div>

      {/* Navigation controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={goToPrev}
          disabled={currentSlide === 0}
          className="px-3 py-1.5 text-sm rounded border border-surface-3 bg-surface-2 text-gray-300 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Prev
        </button>
        <span className="text-sm text-gray-400 tabular-nums">
          {currentSlide + 1} / {totalSlides}
        </span>
        <button
          onClick={goToNext}
          disabled={currentSlide === totalSlides - 1}
          className="px-3 py-1.5 text-sm rounded border border-surface-3 bg-surface-2 text-gray-300 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}
