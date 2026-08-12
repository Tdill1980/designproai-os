/**
 * LayerStrip — RevisionIQ shared layer palette.
 *
 * Shows every layer (uploaded + extracted) for the current view as a clickable
 * thumbnail strip. Click a thumbnail to "arm" it for placement; the parent's
 * placement overlay then drops it on the next render click. Click the same
 * thumbnail again to disarm.
 *
 * Per-layer hover actions:
 *   - "Vectorize" — pipes the layer's transparent PNG through the working
 *     Vercel /api/vectorize-it route (VTracer) and stores the SVG URL on
 *     the layer so the Production Pack picks it up automatically.
 *   - X (delete) — removes the layer entirely.
 *
 * A small badge on each thumbnail tells uploaded layers (cyan U) from
 * extracted layers (amber E). Layers that have a placement on the current
 * view get a green dot indicator. Vectorized layers get a tiny SVG badge.
 */
import { useState } from "react";
import { X, Upload, Scissors, Loader2, FileCode2, Check, Download, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { LogoLayer } from "@/types/revision-logo";
import { vectorizeLayer } from "@/lib/precise-erase-composite";
import { supabase } from "@/integrations/supabase/client";
import {
  ProductionMethodPicker,
  vectorizeOptionsFor,
  type ProductionMethod,
} from "./ProductionMethodPicker";

interface LayerStripProps {
  layers: LogoLayer[];
  armedLayerId: string | null;
  onArm: (id: string | null) => void;
  /** Optional — one-tap "place on render": drops a not-yet-placed layer onto the
   *  render (at center, a clear new spot) and arms it so it's immediately
   *  draggable/resizable. Placed layers still toggle arm/disarm on tap. */
  onPlace?: (id: string) => void;
  onDelete: (id: string) => void;
  /** Optional — when provided, enables the per-layer Vectorize action. The
   *  callback receives the layer id and the new svgUrl so the parent can
   *  persist it onto the layer record. */
  userId?: string | null;
  onVectorized?: (layerId: string, svgUrl: string) => void;
  /** Production method that drives vectorize trace preset + smoothing.
   *  When provided alongside onProductionMethodChange, the strip renders
   *  a compact picker in its header. When omitted, defaults to "printed"
   *  (Print & Cut) — matches pre-picker behavior. */
  productionMethod?: ProductionMethod;
  onProductionMethodChange?: (value: ProductionMethod) => void;
}

export function LayerStrip({
  layers,
  armedLayerId,
  onArm,
  onPlace,
  onDelete,
  userId,
  onVectorized,
  productionMethod = "printed",
  onProductionMethodChange,
}: LayerStripProps) {
  const [vectorizingId, setVectorizingId] = useState<string | null>(null);

  // Download a layer's transparent PNG so it can be reused (e.g. as the
  // overlay element in Flat Panel Pro). Fetches the blob so the filename
  // sticks even though storage is a different origin.
  async function downloadLayer(layer: LogoLayer) {
    try {
      const res = await fetch(layer.sourceUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${layer.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("Element downloaded");
    } catch {
      try { await navigator.clipboard.writeText(layer.sourceUrl); toast.success("Download blocked — element URL copied instead"); }
      catch { window.open(layer.sourceUrl, "_blank"); }
    }
  }

  // High-res, transparency-preserving download for placing on the template.
  // AI-upscales the element (Real-ESRGAN may flatten alpha), then re-applies
  // the ORIGINAL alpha so the PNG stays transparent at high resolution.
  const [hiresId, setHiresId] = useState<string | null>(null);
  function loadImg(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = url;
    });
  }
  async function downloadLayerHiRes(layer: LogoLayer) {
    setHiresId(layer.id);
    const toastId = toast.loading("Upscaling element (keeping transparency)…");
    try {
      const { data, error } = await supabase.functions.invoke("upscale-production-panel", {
        body: { image_url: layer.sourceUrl, scale: 4 },
      });
      if (error) throw error;
      const hiUrl = data?.url || data?.upscaled_url || data?.image_url || data?.output_url;
      if (!hiUrl) throw new Error("upscaler returned no URL");

      const [hi, orig] = await Promise.all([loadImg(hiUrl), loadImg(layer.sourceUrl)]);
      const canvas = document.createElement("canvas");
      canvas.width = hi.naturalWidth;
      canvas.height = hi.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(hi, 0, 0);
      // Keep only the pixels the original element actually covered → transparency.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(orig, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";

      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png"),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${layer.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-hires.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`Hi-res transparent PNG (${canvas.width}×${canvas.height})`, { id: toastId, duration: 4000 });
    } catch (e: any) {
      toast.message("Hi-res upscale unavailable — downloading source transparent PNG instead", { id: toastId });
      await downloadLayer(layer);
    } finally {
      setHiresId(null);
    }
  }

  async function handleVectorize(layer: LogoLayer) {
    if (!userId) {
      toast.error("Sign in to vectorize.");
      return;
    }
    if (!onVectorized) return;
    setVectorizingId(layer.id);
    const { traceMode, smoothing, minArea } = vectorizeOptionsFor(productionMethod);
    const modeLabel = productionMethod === "cut" ? "Film Cut" : "Print & Cut";
    const toastId = toast.loading(`Vectorizing ${layer.name} for ${modeLabel}…`);
    try {
      const { svgUrl, pathCount, colorLayers } = await vectorizeLayer({
        fileUrl: layer.sourceUrl,
        fileName: `${layer.name || "layer"}.png`,
        userId,
        traceMode,
        smoothing,
        minArea,
      });
      onVectorized(layer.id, svgUrl);
      const detail = pathCount != null
        ? `${pathCount} paths · ${colorLayers ?? "?"} colors`
        : "SVG ready";
      toast.success(`Vectorized · ${detail}`, { id: toastId, duration: 4000 });
    } catch (err: any) {
      console.error("[LayerStrip] vectorize failed:", err);
      toast.error(`Vectorize failed: ${err?.message || "unknown error"}`, { id: toastId, duration: 7000 });
    } finally {
      setVectorizingId(null);
    }
  }

  if (layers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/40 p-3 text-center text-[11px] text-zinc-500">
        No layers yet. Upload a logo or use Separate Elements to peel one off the render.
      </div>
    );
  }

  const canVectorize = !!userId && !!onVectorized;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
          Layers ({layers.length})
        </span>
        {/* Production method picker — when wired by the parent, lives right
            on the LayerStrip header so the operator sees (and can flip) the
            mode that drives the per-layer Vectorize trace preset. */}
        {onProductionMethodChange && (
          <ProductionMethodPicker
            value={productionMethod}
            onChange={onProductionMethodChange}
            compact
          />
        )}
      </div>
      {/* Always-visible placement instruction — previously this was hidden
          whenever the Print & Cut picker rendered, leaving users with no hint
          for how to get a layer onto the render. */}
      <p className="text-[10px] text-cyan-400/90 font-medium">
        {armedLayerId
          ? "On the render: drag to move, corner handle to resize, top handle to rotate. Tap the layer again to lock it."
          : "Tap a layer to place it on the render, then drag to move and use the corner handle to make it smaller."}
      </p>
      <div className="flex flex-wrap gap-2">
        {layers.map((layer) => {
          const isArmed = layer.id === armedLayerId;
          const isPlaced = !!layer.placement;
          const isUploaded = layer.kind === "uploaded";
          const isVectorizing = vectorizingId === layer.id;
          const hasSvg = !!layer.svgUrl;
          return (
            <div
              key={layer.id}
              onClick={() => {
                // Unplaced layer: drop it on the render (at center) and arm it,
                // so it's instantly draggable/resizable on touch. Placed layer:
                // toggle arm/disarm so it can be re-grabbed or locked.
                if (!isPlaced && onPlace) onPlace(layer.id);
                else onArm(isArmed ? null : layer.id);
              }}
              className={cn(
                "relative group rounded-md border-2 cursor-pointer transition-all",
                isArmed
                  ? "border-cyan-400 ring-2 ring-cyan-400/40 bg-cyan-500/10"
                  : "border-zinc-700 bg-zinc-900 hover:border-zinc-500",
              )}
              title={
                !isPlaced
                  ? `Tap to place ${layer.name} on the render, then drag/resize it`
                  : `Tap to ${isArmed ? "lock" : "edit"} ${layer.name}`
              }
            >
              <div className="w-20 h-16 flex items-center justify-center bg-[conic-gradient(at_50%_50%,_#27272a_25%,_#1f1f24_25%_50%,_#27272a_50%_75%,_#1f1f24_75%)] bg-[length:8px_8px]">
                <img
                  src={layer.sourceUrl}
                  alt={layer.name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[9px] text-white text-center py-0.5 truncate px-1">
                {layer.name}
              </div>
              {/* Kind badge (uploaded vs extracted) */}
              <div
                className={cn(
                  "absolute top-1 left-1 w-4 h-4 rounded flex items-center justify-center",
                  isUploaded ? "bg-cyan-500" : "bg-amber-500",
                )}
                title={isUploaded ? "Uploaded" : "Extracted from render"}
              >
                {isUploaded ? (
                  <Upload className="w-2.5 h-2.5 text-black" />
                ) : (
                  <Scissors className="w-2.5 h-2.5 text-black" />
                )}
              </div>
              {/* SVG-ready badge */}
              {hasSvg && (
                <div
                  className="absolute top-1 left-6 w-4 h-4 rounded bg-emerald-500 flex items-center justify-center"
                  title="Vector (SVG) ready"
                >
                  <Check className="w-2.5 h-2.5 text-black" />
                </div>
              )}
              {isPlaced && (
                <div
                  className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400 ring-1 ring-green-300"
                  title="Placed on this view"
                />
              )}
              {/* Hover actions: Vectorize + Delete */}
              <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {canVectorize && !hasSvg && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleVectorize(layer);
                    }}
                    disabled={isVectorizing}
                    className="w-5 h-5 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center disabled:opacity-50"
                    title="Vectorize → SVG (cut-ready)"
                  >
                    {isVectorizing ? (
                      <Loader2 className="w-3 h-3 text-white animate-spin" />
                    ) : (
                      <FileCode2 className="w-3 h-3 text-white" />
                    )}
                  </button>
                )}
                {canVectorize && hasSvg && layer.svgUrl && (
                  <a
                    onClick={(e) => e.stopPropagation()}
                    href={layer.svgUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-5 h-5 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center"
                    title="Open SVG"
                  >
                    <FileCode2 className="w-3 h-3 text-white" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadLayer(layer);
                  }}
                  className="w-5 h-5 rounded-full bg-zinc-600 hover:bg-zinc-500 flex items-center justify-center"
                  title={`Download ${layer.name} (transparent PNG)`}
                >
                  <Download className="w-3 h-3 text-white" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadLayerHiRes(layer);
                  }}
                  disabled={hiresId === layer.id}
                  className="w-5 h-5 rounded-full bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center disabled:opacity-50"
                  title={`Download ${layer.name} hi-res transparent PNG (for the template)`}
                >
                  {hiresId === layer.id
                    ? <Loader2 className="w-3 h-3 text-white animate-spin" />
                    : <Maximize2 className="w-3 h-3 text-white" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(layer.id);
                  }}
                  className="w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center"
                  title={`Delete ${layer.name}`}
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
