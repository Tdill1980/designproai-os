/**
 * LayerLift — single-gesture, dual-engine precision editor.
 *
 * The user drags a glassmorphism selection box over an element (logo, text,
 * stripe). On release, TWO engines fire in parallel:
 *
 *   ENGINE 1 — THE LIFT (instant, local, no AI cost):
 *     Frontend canvas mathematically slices the bbox pixels into a
 *     transparent PNG. Uploaded to the asset library and spawned as a
 *     draggable LogoLayer immediately — the user can position it on other
 *     views right away.
 *
 *   ENGINE 2 — THE PATCH (Gemini, 25-50s, 1 token):
 *     Composite the source with a magenta semi-transparent overlay over
 *     the same bbox and call the precise-erase edge function. Gemini
 *     erases the marker and continues the surrounding wrap material
 *     across that region — exact color, exact finish, exact reflections,
 *     no hallucinated stripes coming back.
 *
 * End result: one drag, one release — extracted asset in hand, vehicle
 * surface beneath it healed seamlessly.
 *
 * Usage:
 *   <LayerLift
 *     open={open}
 *     onOpenChange={setOpen}
 *     imageUrl={currentViewUrl}
 *     viewLabel="Driver Side"
 *     userId={currentUserId}
 *     finish={render.finish_type}
 *     colorName={render.color_name}
 *     vehicleYear={render.vehicle_year}
 *     vehicleMake={render.vehicle_make}
 *     vehicleModel={render.vehicle_model}
 *     onLifted={(layer, healedBackgroundUrl) => {
 *       // layer is a LogoLayer{kind: "extracted"} ready for LayerStrip
 *       // healedBackgroundUrl is the precise-erase Gemini output
 *     }}
 *   />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Wand2, Sparkles, Undo2, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { runLayerLift, type NormalizedBox } from "@/lib/precise-erase-composite";
import type { LogoLayer } from "@/types/revision-logo";
import {
  ProductionMethodPicker,
  type ProductionMethod,
} from "./ProductionMethodPicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  viewLabel?: string;
  userId: string | null;
  finish?: string | null;
  colorName?: string | null;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  /** Fires once both engines complete. layer can be added to LayerStrip,
   * healedBackgroundUrl swaps into the current view. */
  onLifted: (layer: LogoLayer, healedBackgroundUrl: string) => void | Promise<void>;
  /** Production method that the lift is for. Drives the constraint copy
   *  shown to the operator before they drag (Print & Cut is permissive;
   *  Manufacture Film Cut warns that gradients will be flattened). When
   *  provided alongside onProductionMethodChange the picker renders in
   *  the modal header so the operator can flip it without leaving. */
  productionMethod?: ProductionMethod;
  onProductionMethodChange?: (value: ProductionMethod) => void;
}

interface DragRect {
  // Stage-space (rendered image pixels in the DOM)
  x: number;
  y: number;
  width: number;
  height: number;
}

export function LayerLift({
  open,
  onOpenChange,
  imageUrl,
  viewLabel,
  userId,
  finish,
  colorName,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  onLifted,
  productionMethod = "printed",
  onProductionMethodChange,
}: Props) {
  // Image bitmap + container measurement
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });

  // Drag state — pointer-events on a single overlay div, glassmorphism box
  // rendered via CSS so blur is a real effect (not a Konva fake).
  const [drawing, setDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "lifting" | "patching" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);

  // Reset all transient state when dialog opens/closes or image changes
  useEffect(() => {
    if (!open) {
      setDrawing(false);
      setDragStart(null);
      setDragRect(null);
      setBusy(false);
      setStage("idle");
      setError(null);
      setImgLoaded(false);
      setImgError(null);
    }
  }, [open, imageUrl]);

  // Measure container so we can convert drag coords into normalized 0-1 image
  // coords no matter the modal size.
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const el = containerRef.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const aspect = imgRef.current && imgLoaded
    ? imgRef.current.naturalWidth / imgRef.current.naturalHeight
    : 16 / 9;

  // Fit the image into the container preserving aspect ratio — gives us a
  // letterboxed area whose offsets we use to translate between screen px
  // and normalized image coords.
  const imgRectInStage = useMemo(() => {
    const cW = containerSize.width;
    const cH = containerSize.height;
    let w = cW;
    let h = cW / aspect;
    if (h > cH) {
      h = cH;
      w = cH * aspect;
    }
    return { x: (cW - w) / 2, y: (cH - h) / 2, w, h };
  }, [containerSize, aspect]);

  function stageToImageNorm(stageX: number, stageY: number): { x: number; y: number } | null {
    const r = imgRectInStage;
    const x = (stageX - r.x) / r.w;
    const y = (stageY - r.y) / r.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  function getPointer(e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (busy || !imgLoaded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = getPointer(e);
    setDrawing(true);
    setDragStart(p);
    setDragRect({ x: p.x, y: p.y, width: 0, height: 0 });
    setError(null);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawing || !dragStart) return;
    const p = getPointer(e);
    setDragRect({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      width: Math.abs(p.x - dragStart.x),
      height: Math.abs(p.y - dragStart.y),
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawing) return;
    setDrawing(false);
    setDragStart(null);
    const rect = dragRect;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!rect || rect.width < 12 || rect.height < 12) {
      setDragRect(null);
      return;
    }
    // Convert to normalized image coords
    const tl = stageToImageNorm(rect.x, rect.y);
    const br = stageToImageNorm(rect.x + rect.width, rect.y + rect.height);
    if (!tl || !br) {
      setDragRect(null);
      toast.info("Draw the box inside the image.");
      return;
    }
    const box: NormalizedBox = {
      xPct: Math.min(tl.x, br.x),
      yPct: Math.min(tl.y, br.y),
      wPct: Math.abs(br.x - tl.x),
      hPct: Math.abs(br.y - tl.y),
    };
    void executeLift(box, rect);
  }

  async function executeLift(box: NormalizedBox, _stageRect: DragRect) {
    if (!imageUrl || !userId) {
      toast.error("Sign in required to lift layers.");
      setDragRect(null);
      return;
    }

    // LayerLift only works on discrete elements (logos, text, stripes) sitting
    // on a surrounding solid wrap: it keys the cutout against the wrap color at
    // the selection edges and heals the hole by cloning that same surrounding
    // material. When the box covers most of the panel, the thing being lifted
    // IS the background design — there's no clean wrap around it to key against
    // or clone back in, so both engines fail. Catch it here and steer the user
    // to a Revision instead of burning a token on a heal that can't work.
    const boxArea = box.wPct * box.hPct;
    if (boxArea > 0.5) {
      const note =
        "LayerLift can only remove layers like text and logos. The item you're trying to lift is part of the background design — there's no clean wrap underneath to lift it off. To change the main artwork, use a Revision instead.";
      setError(note);
      setDragRect(null);
      toast.error(note, { duration: 8000 });
      return;
    }

    setBusy(true);
    setStage("lifting");
    setError(null);
    const toastId = toast.loading("Lifting element + healing background…", { duration: Infinity });
    try {
      // Engine 1 fires first (instant), Engine 2 fires in parallel inside
      // runLayerLift. We resolve once both finish.
      const result = await runLayerLift({
        renderUrl: imageUrl,
        box,
        userId,
        finish,
        colorName,
        vehicleYear,
        vehicleMake,
        vehicleModel,
        intent: "remove",
        toolType: "revision",
      });
      setStage("patching");

      const layer: LogoLayer = {
        id: `lift_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "extracted",
        sourceUrl: result.liftedAssetUrl,
        name: `Lift ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        origin: {
          xPct: result.origin.xPct + result.origin.wPct / 2,
          yPct: result.origin.yPct + result.origin.hPct / 2,
          wPct: result.origin.wPct,
          hPct: result.origin.hPct,
        },
        placement: null,
      };

      await onLifted(layer, result.healedBackgroundUrl);
      setStage("done");
      toast.success("Lifted and healed. Asset added to your layers.", { id: toastId, duration: 4000 });
      // Auto-close so the user sees the result on the canvas behind.
      setTimeout(() => onOpenChange(false), 600);
    } catch (err: any) {
      const msg = err?.message || String(err);
      const refunded = !!err?.refunded;
      // Partial success: Engine 1 (the lift) succeeded but Engine 2 (heal)
      // threw. Surface the lifted asset anyway and keep the original
      // background so the user doesn't lose their single-drag gesture.
      if (err?.partial && err?.liftedAssetUrl && imageUrl) {
        const partialLayer: LogoLayer = {
          id: `lift_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          kind: "extracted",
          sourceUrl: err.liftedAssetUrl,
          name: `Lift ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          origin: {
            xPct: err.origin.xPct + err.origin.wPct / 2,
            yPct: err.origin.yPct + err.origin.hPct / 2,
            wPct: err.origin.wPct,
            hPct: err.origin.hPct,
          },
          placement: null,
        };
        try {
          await onLifted(partialLayer, imageUrl);
        } catch { /* swallow caller errors so the toast still fires */ }
        setStage("done");
        setError(null);
        setDragRect(null);
        toast.warning(
          refunded
            ? "Lifted the element. Heal step failed — token refunded; background unchanged."
            : "Lifted the element. Heal step failed — background unchanged. Retry on a tighter selection if you need the heal.",
          { id: toastId, duration: 6500 },
        );
        setTimeout(() => onOpenChange(false), 800);
        return;
      }
      setStage("idle");
      setError(msg);
      setDragRect(null);
      toast.error(
        refunded
          ? "Heal step failed — your token was refunded. Try a tighter selection."
          : `LayerLift failed: ${msg}`,
        { id: toastId, duration: 7000 },
      );
    } finally {
      setBusy(false);
    }
  }

  function handleClear() {
    if (busy) return;
    setDragRect(null);
    setError(null);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] lg:max-w-6xl h-[90vh] flex flex-col p-4 bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wand2 className="w-5 h-5 text-cyan-400" />
            LayerLift
            {viewLabel && (
              <span className="text-sm font-normal text-zinc-400 ml-1">— {viewLabel}</span>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-cyan-300 font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              Lift element + heal background in one drag
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Production method picker — drives downstream vectorize behavior
            for everything lifted in this session. Rendered only when the
            parent wires onProductionMethodChange so old call sites stay
            unchanged. Sits above the helper bar so the operator sees the
            mode before they drag, plus a one-line constraint summary. */}
        {onProductionMethodChange && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <ProductionMethodPicker
              value={productionMethod}
              onChange={onProductionMethodChange}
            />
            <p className="text-[10px] text-zinc-500 mt-2 leading-snug">
              {productionMethod === "cut" ? (
                <>
                  <span className="text-pink-300 font-semibold">Manufacture Film Cut:</span>{" "}
                  Lifted layers will be vectorized as single-color plotter paths.
                  Gradients, halftones, and photographic detail get flattened — plan
                  the lift around solid shapes for clean cuts.
                </>
              ) : (
                <>
                  <span className="text-cyan-300 font-semibold">Print &amp; Cut:</span>{" "}
                  Full creative freedom — gradients, photographic detail, and
                  unlimited colors are preserved through vectorize as a multi-layer
                  SVG with a die-cut contour.
                </>
              )}
            </p>
          </div>
        )}

        {/* Helper bar */}
        <div className="flex items-center gap-2 text-[11px] text-zinc-400 px-1">
          <span>Drag a box around the element to lift.</span>
          <span className="text-zinc-600">·</span>
          <span>Engine 1 extracts it as a draggable layer.</span>
          <span className="text-zinc-600">·</span>
          <span>Engine 2 heals the wrap surface underneath.</span>
        </div>

        {imageUrl ? (
          <div className="relative flex-1 min-h-[400px] rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
            <div
              ref={containerRef}
              className="relative w-full h-full"
              style={{ cursor: busy ? "wait" : "crosshair", touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* Source image, letterboxed. No crossOrigin on the <img> —
                  the canvas slice goes through a separate fetch() in
                  precise-erase-composite.ts, and crossOrigin here was the
                  silent-failure cause when the bucket's CORS preflight
                  blocked anonymous credentialled loads (modal opened but
                  the artboard never rendered). */}
              <img
                ref={imgRef}
                src={imageUrl}
                alt={viewLabel || "render"}
                onLoad={() => { setImgLoaded(true); setImgError(null); }}
                onError={() => {
                  setImgError("Couldn't load the artboard image. Save a panel or 2D proof as the job artboard first, then reopen LayerLift.");
                  setImgLoaded(false);
                }}
                draggable={false}
                style={{
                  position: "absolute",
                  left: imgRectInStage.x,
                  top: imgRectInStage.y,
                  width: imgRectInStage.w,
                  height: imgRectInStage.h,
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />

              {/* Glassmorphism selection rectangle — real CSS backdrop-blur */}
              {dragRect && dragRect.width > 0 && dragRect.height > 0 && (
                <div
                  className={cn(
                    "absolute pointer-events-none rounded-md border-2 shadow-[0_0_24px_rgba(34,211,238,0.45)] transition-shadow",
                    busy
                      ? "border-cyan-300/90 bg-cyan-400/15"
                      : "border-cyan-300/90 bg-cyan-400/10",
                  )}
                  style={{
                    left: dragRect.x,
                    top: dragRect.y,
                    width: dragRect.width,
                    height: dragRect.height,
                    backdropFilter: "blur(6px) saturate(140%)",
                    WebkitBackdropFilter: "blur(6px) saturate(140%)",
                  }}
                >
                  {/* Corner accents for that "selection handle" feel */}
                  {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                    <span
                      key={corner}
                      className={cn(
                        "absolute w-3 h-3 border-cyan-200",
                        corner === "tl" && "top-0 left-0 border-t-2 border-l-2 rounded-tl-md",
                        corner === "tr" && "top-0 right-0 border-t-2 border-r-2 rounded-tr-md",
                        corner === "bl" && "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-md",
                        corner === "br" && "bottom-0 right-0 border-b-2 border-r-2 rounded-br-md",
                      )}
                    />
                  ))}
                  {/* Status chip while engines run */}
                  {busy && (
                    <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-cyan-400/40 text-[10px] text-cyan-200 font-medium whitespace-nowrap flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {stage === "lifting" ? "Lifting + healing…" : "Almost there…"}
                    </div>
                  )}
                </div>
              )}

              {/* Done overlay */}
              {stage === "done" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/90 text-white font-semibold shadow-lg">
                    <Check className="w-5 h-5" /> Lifted &amp; healed
                  </div>
                </div>
              )}

              {!imgLoaded && !imgError && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading image…
                </div>
              )}
              {imgError && (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                  <div className="flex items-start gap-2 text-sm text-red-300 max-w-md">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{imgError}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            No image selected
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 pt-1">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 mr-auto">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={handleClear} disabled={busy || !dragRect}>
              <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Clear box
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
