/**
 * RemovalBoxCanvas — Konva-based box drawing overlay for element removal.
 *
 * Replaces the CSS-based dashed-div approach with a proper canvas so the
 * selection rectangle is pixel-precise and renders cleanly (identical UX
 * to the ZoneMasker tool in Graphics Pro).
 *
 * Sits absolutely over the hero image. Transparent background so the
 * underlying render stays visible.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Stage, Layer, Rect } from "react-konva";

interface RemovalBoxCanvasProps {
  /** True when removal mode is active */
  active: boolean;
  /** Called with normalised 0-1 coords when the user finishes drawing a box */
  onBoxSelect: (x1Pct: number, y1Pct: number, x2Pct: number, y2Pct: number) => void;
}

export function RemovalBoxCanvas({ active, onBoxSelect }: RemovalBoxCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 500 });

  // Drawing state
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [tempRect, setTempRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // ── Measure container on mount / resize ──────────────────────────────
  useEffect(() => {
    if (!active || !containerRef.current) return;

    const measure = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [active]);

  // ── Mouse / touch handlers ───────────────────────────────────────────
  const handleMouseDown = useCallback((e: any) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    setDrawing(true);
    setDrawStart(pos);
    setTempRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
  }, []);

  const handleMouseMove = useCallback(
    (e: any) => {
      if (!drawing || !drawStart) return;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos) return;

      setTempRect({
        x: Math.min(drawStart.x, pos.x),
        y: Math.min(drawStart.y, pos.y),
        width: Math.abs(pos.x - drawStart.x),
        height: Math.abs(pos.y - drawStart.y),
      });
    },
    [drawing, drawStart],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawing || !tempRect) {
      setDrawing(false);
      setDrawStart(null);
      setTempRect(null);
      return;
    }

    // Minimum 15 px in both directions to count
    if (tempRect.width > 15 && tempRect.height > 15) {
      const x1 = tempRect.x / stageSize.width;
      const y1 = tempRect.y / stageSize.height;
      const x2 = (tempRect.x + tempRect.width) / stageSize.width;
      const y2 = (tempRect.y + tempRect.height) / stageSize.height;
      onBoxSelect(x1, y1, x2, y2);
    }

    setDrawing(false);
    setDrawStart(null);
    setTempRect(null);
  }, [drawing, tempRect, stageSize, onBoxSelect]);

  // Reset drawing state when deactivated
  useEffect(() => {
    if (!active) {
      setDrawing(false);
      setDrawStart(null);
      setTempRect(null);
    }
  }, [active]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ zIndex: 25, cursor: "crosshair", background: "transparent" }}
    >
      <Stage
        width={stageSize.width}
        height={stageSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
      >
        <Layer>
          {/* Invisible hit-area so clicks register even outside the drawn rect */}
          <Rect
            x={0}
            y={0}
            width={stageSize.width}
            height={stageSize.height}
            fill="transparent"
            listening={true}
          />

          {/* Live selection rectangle while drawing */}
          {tempRect && tempRect.width > 0 && tempRect.height > 0 && (
            <Rect
              x={tempRect.x}
              y={tempRect.y}
              width={tempRect.width}
              height={tempRect.height}
              stroke="#3B82F6"
              strokeWidth={2}
              dash={[6, 3]}
              fill="rgba(59, 130, 246, 0.1)"
              cornerRadius={2}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
