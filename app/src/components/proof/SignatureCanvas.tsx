import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

interface SignatureCanvasProps {
  onSignatureChange: (pngBase64: string | null) => void;
  disabled?: boolean;
}

/**
 * Touch + mouse + pen signature capture. Uses pointer events so every
 * modern device (iOS Safari, Android Chrome, desktop Chrome, Apple
 * Pencil, Surface Pen) drives the same code path.
 *
 * Output: flat PNG base64 (without the data: prefix) whenever the stroke
 * count changes. Parent sends it to proof-sign.
 */
export const SignatureCanvas = ({
  onSignatureChange,
  disabled = false,
}: SignatureCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // Resize canvas to container (DPI-aware so strokes stay crisp on retina)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width } = container.getBoundingClientRect();
      const height = 200;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#111";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const getPoint = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const emitSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    onSignatureChange(base64);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPoint.current = getPoint(e);
    setIsEmpty(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPoint.current) return;
    const point = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint.current = point;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — capture can fail if pointer already left
    }
    emitSignature();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    setIsEmpty(true);
    onSignatureChange(null);
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className={cn(
          "relative w-full rounded-lg border-2 border-dashed transition-colors overflow-hidden bg-white",
          isEmpty
            ? "border-zinc-300 hover:border-zinc-400"
            : "border-blue-500",
          disabled && "opacity-50 pointer-events-none",
        )}
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block w-full cursor-crosshair"
          aria-label="Signature canvas"
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-zinc-400 text-sm">
            Sign here
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Draw with your finger, pen, or mouse.</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={disabled || isEmpty}
          className="h-7 text-xs"
        >
          <Eraser className="w-3 h-3 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
};
