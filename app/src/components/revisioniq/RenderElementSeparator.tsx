/**
 * RenderElementSeparator — RevisionIQ element removal.
 *
 * UX: User toggles "Remove Elements", draws a box around the text/logo on the
 * render, and everything inside the box is removed and placed in the layer
 * strip as a reusable layer.
 *
 * The lift is local pixel work: the boxed region is alpha-keyed against the
 * surrounding wrap in this tab and uploaded as a transparent PNG. It does NOT
 * repaint the render behind the element. A browser-repainted proof is an
 * unverified image that disagrees with the master the six print panels are cut
 * from, and the clean, logo-free base is already published by the server as the
 * de-logoed duplicate of that surface's panel.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Square, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { extractTransparentSlice, uploadLiftedAsset } from "@/lib/precise-erase-composite";
import type { LogoLayer } from "@/types/revision-logo";

/**
 * Downscale a (possibly 4K) render to a JPEG data URL capped at `maxSide`px on
 * the longest edge before we ship it to the edge function. The server decodes
 * the image with imagescript (pure-WASM, memory-hungry); handing it a full 4K
 * PNG made the Deno edge worker blow past its memory/CPU ceiling and die with
 * HTTP 546 ("Element removal failed: non-2xx") before ClipDrop ever ran. A
 * ~1400px source is plenty for the layer strip + clean-background display and
 * keeps the worker well under budget. Percent bbox coords are resolution-
 * independent, so the smaller source needs no coordinate changes.
 *
 * Returns null on any failure (CORS taint, decode error, no canvas) so the
 * caller can fall back to the original URL — no regression vs. prior behavior.
 */
async function downscaleRenderForRemoval(
  url: string,
  maxSide = 1400,
): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxSide ? maxSide / longest : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}

export interface RenderElementSeparatorHandle {
  /** True if removal mode is on (parent uses this to gate overlay capture). */
  isWandActive: () => boolean;
  /** Force removal mode off — used when the user arms a logo layer for
   *  placement so the two click-capturing modes don't fight over the render. */
  deactivate: () => void;
  /** Process a box selection on the current view's hero image. */
  handleBoxSelect: (x1Pct: number, y1Pct: number, x2Pct: number, y2Pct: number) => void;
}

interface RenderElementSeparatorProps {
  userId: string | null;
  currentViewKey: string | null;
  currentViewUrl: string | null;
  /** Called for every successfully extracted layer */
  onLayerExtracted: (
    viewKey: string,
    layer: LogoLayer,
    patchedBackgroundUrl: string,
  ) => void;
  /** Called whenever the removal mode toggles */
  onWandActiveChange?: (active: boolean) => void;
}

export const RenderElementSeparator = forwardRef<
  RenderElementSeparatorHandle,
  RenderElementSeparatorProps
>(function RenderElementSeparator(
  {
    userId,
    currentViewKey,
    currentViewUrl,
    onLayerExtracted,
    onWandActiveChange,
  },
  ref,
) {
  const [removeActive, setRemoveActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    onWandActiveChange?.(removeActive);
  }, [removeActive, onWandActiveChange]);

  useImperativeHandle(
    ref,
    () => ({
      isWandActive: () => removeActive && !isProcessing,
      deactivate: () => setRemoveActive(false),
      handleBoxSelect: (x1Pct: number, y1Pct: number, x2Pct: number, y2Pct: number) => {
        void runBoxExtract(x1Pct, y1Pct, x2Pct, y2Pct);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeActive, isProcessing, currentViewKey, currentViewUrl],
  );

  async function runBoxExtract(x1Pct: number, y1Pct: number, x2Pct: number, y2Pct: number) {
    if (!userId) {
      toast.error("Sign in required.");
      return;
    }
    if (!currentViewKey || !currentViewUrl) {
      toast.error("No view loaded.");
      return;
    }

    // Normalize the 2-point selection to a top-left origin + size bbox in
    // percent coords. The edge function will convert to pixels once it has
    // decoded the source image and learned its native width/height.
    const xPct = Math.min(x1Pct, x2Pct);
    const yPct = Math.min(y1Pct, y2Pct);
    const wPct = Math.abs(x2Pct - x1Pct);
    const hPct = Math.abs(y2Pct - y1Pct);

    if (wPct < 0.01 || hPct < 0.01) {
      toast.info("Selection too small — draw a bigger box around the element.");
      return;
    }

    setIsProcessing(true);
    try {
      // Ship a downscaled source so the edge worker doesn't OOM (HTTP 546)
      // decoding a full 4K render. Falls back to the original URL if the
      // browser can't read/resize the image (e.g. CORS taint).
      const sourceImage =
        (await downscaleRenderForRemoval(currentViewUrl)) || currentViewUrl;

      // BOXED LIFT, LOCALLY. This used to hand the box to a heal service that
      // returned two images: a transparent cutout AND a repainted background
      // with the element erased. The repaint is the part that cannot exist
      // here -- a browser-repainted proof is an unverified image that disagrees
      // with the master the six print panels are cut from, and every generative
      // heal this product has shipped left a visible smear.
      //
      // The cutout is kept, because it is pure pixel work: the slice is
      // alpha-keyed against the surrounding wrap in this tab. The clean,
      // logo-free base it used to be paired with is the de-logoed panel the
      // server publishes for that surface.
      const { blob } = await extractTransparentSlice(sourceImage, { xPct, yPct, wPct, hPct });
      const transparentPngUrl = await uploadLiftedAsset(blob, userId);
      const bbox = { xPct, yPct, wPct, hPct };

      const layer: LogoLayer = {
        id: `box_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "extracted",
        sourceUrl: transparentPngUrl,
        name: `Element ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        origin: {
          xPct: bbox.xPct + bbox.wPct / 2,
          yPct: bbox.yPct + bbox.hPct / 2,
          wPct: bbox.wPct,
          hPct: bbox.hPct,
        },
        placement: null,
      };

      // No healed background. The clean, logo-free base for this surface is
      // the de-logoed panel the server publishes -- see the note above.
      onLayerExtracted(currentViewKey, layer, null);
      toast.success("Element lifted and saved to layers.");
    } catch (err) {
      console.error("[RenderElementSeparator] box extract failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Element removal failed: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Square className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-bold">Remove Elements</span>
      </div>
      <p className="text-[11px] text-zinc-500">
        Draw a box around any text or logo on the render to remove it. The element goes to your layer strip for repositioning.
      </p>

      <Button
        size="sm"
        variant={removeActive ? "default" : "outline"}
        className={
          removeActive
            ? "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400"
            : "border-zinc-600 text-zinc-300 hover:bg-zinc-800"
        }
        onClick={() => setRemoveActive((v) => !v)}
        disabled={!currentViewUrl || isProcessing}
      >
        {isProcessing ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <Square className="w-3.5 h-3.5 mr-1.5" />
        )}
        {isProcessing ? "Removing..." : removeActive ? "Drawing Mode On" : "Remove Elements"}
      </Button>

      {removeActive && (
        <div className="flex items-start gap-2 rounded-md bg-blue-500/10 border border-blue-500/30 p-2 text-[10px] text-blue-300">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Click and drag a rectangle over the text or logo you want to remove. Release to confirm.
          </span>
        </div>
      )}
    </div>
  );
});
