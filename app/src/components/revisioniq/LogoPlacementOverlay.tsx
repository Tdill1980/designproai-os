/**
 * LogoPlacementOverlay — RevisionIQ shared placement layer.
 *
 * Sits absolutely-positioned over the hero render image.
 *
 *   1. ARMED-LAYER MODE — single click drops a layer at the click point.
 *   2. PLACED MARKERS — each placed layer renders a draggable thumbnail with
 *      a bottom-right corner resize handle and a small toolbar (slider,
 *      preset sizes, delete) that appears on click.
 *
 * Box drawing for removal mode is handled by RemovalBoxCanvas (Konva).
 */
import { useEffect, useRef, useState } from "react";
import { X, Minus, Plus, Trash2, RotateCw, Move, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogoLayer, LogoSize } from "@/types/revision-logo";

interface LogoPlacementOverlayProps {
  placedLayers: LogoLayer[];
  armedLayerId: string | null;
  /** True when removal mode is active — RemovalBoxCanvas handles events */
  wandMode: boolean;
  onDropArmed: (xPct: number, yPct: number) => void;
  /** Box selection completed — normalized coords (0-1) */
  onBoxSelect: (x1Pct: number, y1Pct: number, x2Pct: number, y2Pct: number) => void;
  onResizePlacement: (layerId: string, size: LogoSize) => void;
  /** Continuous size callback (0.03–0.60 range) */
  onResizePlacementPercent?: (layerId: string, sizePercent: number) => void;
  /** Drag-to-move callback (center coords, 0-1) */
  onMovePlacement?: (layerId: string, xPct: number, yPct: number) => void;
  /** Rotate callback (clockwise degrees about center) */
  onRotatePlacement?: (layerId: string, rotationDeg: number) => void;
  onClearPlacement: (layerId: string) => void;
}

const SIZE_TO_PERCENT: Record<LogoSize, number> = {
  sm: 0.1,
  md: 0.18,
  lg: 0.28,
};

type ActiveDrag =
  | { kind: "move"; layerId: string; startClientX: number; startClientY: number; startXPct: number; startYPct: number }
  | { kind: "resize"; layerId: string; startClientX: number; startWidthPct: number; overlayWidthPx: number }
  | { kind: "rotate"; layerId: string; centerClientX: number; centerClientY: number; startAngle: number; startRotation: number };

export function LogoPlacementOverlay({
  placedLayers,
  armedLayerId,
  wandMode,
  onDropArmed,
  onResizePlacement,
  onResizePlacementPercent,
  onMovePlacement,
  onRotatePlacement,
  onClearPlacement,
}: LogoPlacementOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  // Track whether a meaningful drag actually happened — so we don't toggle
  // the toolbar open/closed on click-release at the end of a drag.
  const movedRef = useRef(false);

  // Only capture drop events for armed-layer placement.
  const captureEvents = !!armedLayerId;
  const cursor = armedLayerId ? "cursor-copy" : "cursor-default";

  // ── Global pointer listeners so drags keep tracking even when the pointer
  //    leaves the marker (which is common during resize / fast move).
  useEffect(() => {
    function handleMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      if (drag.kind === "move") {
        const dxPct = (e.clientX - drag.startClientX) / rect.width;
        const dyPct = (e.clientY - drag.startClientY) / rect.height;
        const nextX = Math.max(0, Math.min(1, drag.startXPct + dxPct));
        const nextY = Math.max(0, Math.min(1, drag.startYPct + dyPct));
        if (Math.abs(dxPct) > 0.002 || Math.abs(dyPct) > 0.002) movedRef.current = true;
        onMovePlacement?.(drag.layerId, nextX, nextY);
      } else if (drag.kind === "rotate") {
        // Angle from object center to pointer, minus the angle at drag start.
        const angle = Math.atan2(e.clientY - drag.centerClientY, e.clientX - drag.centerClientX) * (180 / Math.PI);
        const next = drag.startRotation + (angle - drag.startAngle);
        movedRef.current = true;
        onRotatePlacement?.(drag.layerId, next);
      } else {
        // Corner drag: treat horizontal distance as width delta.
        const dx = e.clientX - drag.startClientX;
        const deltaPct = dx / drag.overlayWidthPx;
        const nextWidthPct = Math.max(0.03, Math.min(0.60, drag.startWidthPct + deltaPct * 2));
        if (Math.abs(deltaPct) > 0.002) movedRef.current = true;
        onResizePlacementPercent?.(drag.layerId, nextWidthPct);
      }
      e.preventDefault();
    }
    function handleUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      // Small timeout so the synthetic click event that fires after pointerup
      // sees movedRef === true and skips the toolbar toggle.
      setTimeout(() => { movedRef.current = false; }, 0);
    }
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [onMovePlacement, onResizePlacementPercent, onRotatePlacement]);

  function handleOverlayPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    // Armed-layer drop only fires if we weren't dragging something else.
    if (armedLayerId && !wandMode && !dragRef.current) {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      onDropArmed(x, y);
    }
  }

  function startMoveDrag(e: React.PointerEvent, layer: LogoLayer) {
    if (!layer.placement || !onMovePlacement) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      kind: "move",
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startXPct: layer.placement.xPct,
      startYPct: layer.placement.yPct,
    };
    movedRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  function startResizeDrag(e: React.PointerEvent, layer: LogoLayer) {
    if (!layer.placement || !onResizePlacementPercent) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    const overlayWidthPx = rect?.width || 800;
    const currentPercent =
      layer.placement.sizePercent ?? SIZE_TO_PERCENT[layer.placement.size];
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      kind: "resize",
      layerId: layer.id,
      startClientX: e.clientX,
      startWidthPct: currentPercent,
      overlayWidthPx,
    };
    movedRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  function startRotateDrag(e: React.PointerEvent, layer: LogoLayer) {
    if (!layer.placement || !onRotatePlacement) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Object center in client px, derived from its placement fraction.
    const centerClientX = rect.left + layer.placement.xPct * rect.width;
    const centerClientY = rect.top + layer.placement.yPct * rect.height;
    const startAngle = Math.atan2(e.clientY - centerClientY, e.clientX - centerClientX) * (180 / Math.PI);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      kind: "rotate",
      layerId: layer.id,
      centerClientX,
      centerClientY,
      startAngle,
      startRotation: layer.placement.rotationDeg ?? 0,
    };
    movedRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  return (
    <div
      ref={overlayRef}
      onPointerUp={handleOverlayPointerUp}
      className={cn(
        "absolute inset-0 select-none",
        captureEvents ? "pointer-events-auto z-20" : "pointer-events-none",
        cursor,
      )}
    >
      {/* Placed layer markers */}
      {placedLayers.map((layer) => {
        if (!layer.placement) return null;
        const widthFraction = layer.placement.sizePercent ?? SIZE_TO_PERCENT[layer.placement.size];
        const widthPct = widthFraction * 100;
        const isActive = layer.id === activeMarkerId;
        const currentPercent = layer.placement.sizePercent ?? SIZE_TO_PERCENT[layer.placement.size];
        const rotationDeg = layer.placement.rotationDeg ?? 0;
        return (
          <div
            key={layer.id}
            className="absolute pointer-events-auto"
            style={{
              left: `${layer.placement.xPct * 100}%`,
              top: `${layer.placement.yPct * 100}%`,
              width: `${widthPct}%`,
              transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
              touchAction: "none",
            }}
          >
            <div
              className={cn(
                "relative group select-none transition-all",
                isActive ? "ring-2 ring-blue-400" : "ring-1 ring-blue-400/40 hover:ring-blue-400",
                dragRef.current?.layerId === layer.id && dragRef.current.kind === "move"
                  ? "cursor-grabbing"
                  : "cursor-grab",
              )}
              onPointerDown={(e) => startMoveDrag(e, layer)}
              onClick={(e) => {
                e.stopPropagation();
                if (movedRef.current) return;
                setActiveMarkerId(isActive ? null : layer.id);
              }}
            >
              <img
                src={layer.sourceUrl}
                alt={layer.name}
                className="w-full h-auto block opacity-90 pointer-events-none"
                draggable={false}
              />
              <div
                className={cn(
                  "absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] bg-black/80 text-blue-300 px-1.5 py-0.5 rounded whitespace-nowrap transition-opacity pointer-events-none",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                {layer.name} · drag to move
              </div>

              {/* Four-corner icon handles (Canva-style):
                    TL 🗑 delete · TR ⟳ rotate · BR ⤢ resize · BL ✥ move.
                  Visible when the object is selected. Icons counter-rotate so
                  they stay upright even when the object itself is rotated. */}
              {isActive && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ transform: `rotate(${-rotationDeg}deg)` }}
                >
                  {/* delete — top-left */}
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearPlacement(layer.id);
                      setActiveMarkerId(null);
                    }}
                    className="pointer-events-auto absolute -left-3 -top-3 w-6 h-6 rounded-full bg-white border border-zinc-300 shadow-md flex items-center justify-center hover:bg-red-50"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                  {/* rotate — top-right */}
                  <button
                    onPointerDown={(e) => startRotateDrag(e, layer)}
                    onClick={(e) => e.stopPropagation()}
                    className="pointer-events-auto absolute -right-3 -top-3 w-6 h-6 rounded-full bg-white border border-zinc-300 shadow-md flex items-center justify-center hover:bg-blue-50 cursor-grab active:cursor-grabbing"
                    title="Drag to rotate"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-blue-600" />
                  </button>
                  {/* move — bottom-left */}
                  <button
                    onPointerDown={(e) => startMoveDrag(e, layer)}
                    onClick={(e) => e.stopPropagation()}
                    className="pointer-events-auto absolute -left-3 -bottom-3 w-6 h-6 rounded-full bg-white border border-zinc-300 shadow-md flex items-center justify-center hover:bg-blue-50 cursor-grab active:cursor-grabbing"
                    title="Drag to move"
                  >
                    <Move className="w-3.5 h-3.5 text-zinc-700" />
                  </button>
                  {/* resize — bottom-right */}
                  <button
                    onPointerDown={(e) => startResizeDrag(e, layer)}
                    onClick={(e) => e.stopPropagation()}
                    className="pointer-events-auto absolute -right-3 -bottom-3 w-6 h-6 rounded-full bg-white border border-zinc-300 shadow-md flex items-center justify-center hover:bg-blue-50 cursor-nwse-resize"
                    title="Drag to resize"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-zinc-700" />
                  </button>
                </div>
              )}
            </div>

            {isActive && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex flex-col items-center gap-1.5 bg-zinc-900 border border-blue-500/40 rounded-md px-2 py-1.5 shadow-lg pointer-events-auto min-w-[160px]"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {/* Precision size slider */}
                <div className="flex items-center gap-1.5 w-full">
                  <button
                    onClick={() => {
                      const next = Math.max(0.03, currentPercent - 0.02);
                      if (onResizePlacementPercent) onResizePlacementPercent(layer.id, next);
                    }}
                    className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center"
                  >
                    <Minus className="w-3 h-3 text-zinc-300" />
                  </button>
                  <input
                    type="range"
                    min={3}
                    max={60}
                    step={1}
                    value={Math.round(currentPercent * 100)}
                    onChange={(e) => {
                      if (onResizePlacementPercent) {
                        onResizePlacementPercent(layer.id, Number(e.target.value) / 100);
                      }
                    }}
                    className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
                  />
                  <button
                    onClick={() => {
                      const next = Math.min(0.60, currentPercent + 0.02);
                      if (onResizePlacementPercent) onResizePlacementPercent(layer.id, next);
                    }}
                    className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center"
                  >
                    <Plus className="w-3 h-3 text-zinc-300" />
                  </button>
                  <span className="text-[9px] text-zinc-400 w-8 text-right">
                    {Math.round(currentPercent * 100)}%
                  </span>
                </div>
                {/* Quick size presets + delete */}
                <div className="flex items-center gap-1 w-full">
                  {(["sm", "md", "lg"] as LogoSize[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        onResizePlacement(layer.id, s);
                        if (onResizePlacementPercent) onResizePlacementPercent(layer.id, SIZE_TO_PERCENT[s]);
                      }}
                      className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded font-bold",
                        Math.abs(currentPercent - SIZE_TO_PERCENT[s]) < 0.01
                          ? "bg-blue-500 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:text-blue-300",
                      )}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      onClearPlacement(layer.id);
                      setActiveMarkerId(null);
                    }}
                    className="w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center"
                    title="Remove from this view"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
