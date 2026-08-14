/**
 * HoverZoomThumb — a thumbnail that enlarges into a floating preview on hover,
 * so the team can inspect a customer's reference upload (or any asset) WITHOUT
 * leaving the page or opening a new tab. Click still opens the full file.
 *
 * The enlarged preview is rendered with `position: fixed` so it floats above
 * everything (high z-index, pointer-events-none) and tracks the cursor, clamped
 * to stay on-screen.
 */

import { useState } from "react";

interface Props {
  url: string;
  alt?: string;
  /** classes for the clickable thumbnail wrapper (sizing/border/etc.) */
  className?: string;
  /** classes for the <img> inside the thumbnail */
  imgClassName?: string;
  /** pixel size of the floating enlarged preview (square box) */
  zoomSize?: number;
}

export function HoverZoomThumb({ url, alt, className, imgClassName, zoomSize = 380 }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title="Hover to enlarge · click to open"
        className={className}
        onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
      >
        <img src={url} alt={alt} loading="lazy" className={imgClassName || "w-full h-full object-cover"} />
      </a>
      {pos && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-lg ring-2 ring-blue-400 shadow-2xl bg-white overflow-hidden"
          style={{
            width: zoomSize,
            height: zoomSize,
            left: Math.min(pos.x + 24, (typeof window !== "undefined" ? window.innerWidth : 1200) - zoomSize - 12),
            top: Math.min(
              Math.max(pos.y - zoomSize / 2, 12),
              (typeof window !== "undefined" ? window.innerHeight : 800) - zoomSize - 12,
            ),
          }}
        >
          <img src={url} alt={alt} className="w-full h-full object-contain bg-white" />
        </div>
      )}
    </>
  );
}
