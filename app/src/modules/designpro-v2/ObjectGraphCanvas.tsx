/**
 * DesignPro v2 — deterministic compositor.
 *
 * Renders the object graph as a stack of positioned <img> layers: background
 * panel at the bottom, foreground objects above it in z order. Because the
 * composition is structural (DOM layers), removing an object simply re-renders
 * the remaining layers — the background stays pixel-perfect at full source
 * resolution. There is zero canvas pixel manipulation in this path.
 *
 * Click handling reports percent coordinates so the parent can hit-test the
 * object graph and delete by ID.
 */
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type DesignObject,
  type ObjectGraph,
  getBackground,
  getForegroundObjects,
  hitTest,
} from "./objectGraph";

interface ObjectGraphCanvasProps {
  graph: ObjectGraph;
  /** When true, clicking an object removes it instantly. */
  removeMode: boolean;
  selectedId?: string | null;
  onObjectClick: (obj: DesignObject) => void;
  onBackgroundClick?: () => void;
  className?: string;
}

export function ObjectGraphCanvas({
  graph,
  removeMode,
  selectedId,
  onObjectClick,
  onBackgroundClick,
  className,
}: ObjectGraphCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const background = getBackground(graph);
  const foreground = getForegroundObjects(graph);

  const pctFromEvent = (e: React.MouseEvent): { xPct: number; yPct: number } | null => {
    const el = frameRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      xPct: (e.clientX - rect.left) / rect.width,
      yPct: (e.clientY - rect.top) / rect.height,
    };
  };

  const handleClick = (e: React.MouseEvent) => {
    const pt = pctFromEvent(e);
    if (!pt) return;
    const hit = hitTest(graph, pt.xPct, pt.yPct);
    if (hit) onObjectClick(hit);
    else onBackgroundClick?.();
  };

  const handleMove = (e: React.MouseEvent) => {
    const pt = pctFromEvent(e);
    if (!pt) return;
    setHoverId(hitTest(graph, pt.xPct, pt.yPct)?.id ?? null);
  };

  if (!background) {
    return (
      <div className={cn("flex items-center justify-center rounded-lg bg-zinc-900 text-zinc-500 text-sm h-64", className)}>
        No background layer in graph
      </div>
    );
  }

  return (
    <div
      ref={frameRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-zinc-950 select-none",
        removeMode ? "cursor-crosshair" : "cursor-pointer",
        className,
      )}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverId(null)}
    >
      {/* Layer 0: background panel — always full frame, full resolution */}
      <img
        src={background.sourceUrl}
        alt="Background panel"
        className="block w-full h-auto"
        draggable={false}
      />

      {/* Foreground objects, ascending z */}
      {foreground
        .filter((o) => o.visible)
        .map((o) => (
          <img
            key={o.id}
            src={o.sourceUrl}
            alt={o.name}
            draggable={false}
            className={cn(
              "absolute object-contain pointer-events-none transition-shadow",
              (hoverId === o.id || selectedId === o.id) && removeMode && "outline outline-2 outline-red-500",
              (hoverId === o.id || selectedId === o.id) && !removeMode && "outline outline-2 outline-cyan-400",
            )}
            style={{
              left: `${o.box.xPct * 100}%`,
              top: `${o.box.yPct * 100}%`,
              width: `${o.box.wPct * 100}%`,
              height: `${o.box.hPct * 100}%`,
              transform: o.rotationDeg ? `rotate(${o.rotationDeg}deg)` : undefined,
            }}
          />
        ))}

      {removeMode && (
        <div className="absolute top-2 left-2 rounded bg-red-600/90 px-2 py-1 text-[11px] font-bold text-white">
          Remove mode — click an object to delete it instantly
        </div>
      )}
    </div>
  );
}
