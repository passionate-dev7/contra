"use client";

import { useEffect, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

function slides(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-slide]"));
}

/** The sheet occupying the middle of the viewport, read from layout at call
 * time so it stays right mid-scroll and after manual scrolling. */
function currentIndex(all: HTMLElement[]): number {
  let at = 0;
  all.forEach((s, i) => {
    if (s.getBoundingClientRect().top < window.innerHeight / 2) at = i;
  });
  return at;
}

function go(index: number) {
  const all = slides();
  const target = all[Math.max(0, Math.min(all.length - 1, index))];
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** Fixed prev/next control for the /pitch deck. ArrowRight/ArrowLeft (and
 * PageDown/PageUp, Home/End) move one sheet; the counter follows whichever
 * sheet is on screen, so scrolling by hand keeps it honest. */
export function DeckNav({ total }: { total: number }) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const onScroll = () => setCurrent(currentIndex(slides()));
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const all = slides();
      const at = currentIndex(all);
      if (e.key === "ArrowRight" || e.key === "PageDown") go(at + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(at - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(all.length - 1);
      else return;
      e.preventDefault();
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <nav
      data-deck-nav
      aria-label="Deck navigation"
      className="fixed bottom-4 right-4 z-10 flex items-center border border-[var(--rule-strong)] bg-[var(--paper-raised)] font-[family-name:var(--font-mono)] text-xs tabular"
    >
      <button
        type="button"
        onClick={() => go(current - 1)}
        disabled={current === 0}
        aria-label="Previous sheet"
        className="press-scale px-3 py-2 text-[var(--ink)] transition-opacity duration-150 disabled:opacity-30"
      >
        <CaretLeft size={14} />
      </button>
      <span className="border-x border-[var(--rule)] px-3 py-2" aria-live="polite">
        {String(current + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
      <button
        type="button"
        onClick={() => go(current + 1)}
        disabled={current === total - 1}
        aria-label="Next sheet"
        className="press-scale px-3 py-2 text-[var(--ink)] transition-opacity duration-150 disabled:opacity-30"
      >
        <CaretRight size={14} />
      </button>
    </nav>
  );
}
