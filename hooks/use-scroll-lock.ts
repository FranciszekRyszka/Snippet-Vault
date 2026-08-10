import { useEffect } from "react";

// Freeze background page scrolling while a modal is open, so scrolling inside the
// dialog (or over its backdrop) can't move the page behind it. Restores the
// previous state on unmount, and pads for the scrollbar's width so the page
// behind doesn't shift as the scrollbar disappears. SSR-safe.
export function useScrollLock() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const prevOverflow = el.style.overflow;
    const prevPadding = el.style.paddingRight;
    // Overlay/desktop scrollbars report 0 width — only compensate when there's a
    // classic scrollbar actually taking up space.
    const scrollbarWidth = window.innerWidth - el.clientWidth;
    el.style.overflow = "hidden";
    if (scrollbarWidth > 0) el.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      el.style.overflow = prevOverflow;
      el.style.paddingRight = prevPadding;
    };
  }, []);
}
