import { useEffect, useState } from "react";

/** The height the persistent <Header> renders at when nothing else is known. */
export const DEFAULT_HEADER_HEIGHT = 72;

/**
 * The rendered height of the persistent DesignProAI header, in pixels.
 *
 * The header is one row on most pages and two inside a tool (the active-tool
 * strip names VehiclePro / WallPro / CutPro beneath the OS lockup), so anything
 * pinned under it -- the dashboard sidebar -- reads the real height rather
 * than a constant. Falls back to 72px until the header is measured.
 */
export const useHeaderHeight = (): number => {
  const [height, setHeight] = useState(DEFAULT_HEADER_HEIGHT);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const header = document.querySelector("header");
    if (!header) return;
    const measure = () => setHeight(Math.round(header.getBoundingClientRect().height) || DEFAULT_HEADER_HEIGHT);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return height;
};
