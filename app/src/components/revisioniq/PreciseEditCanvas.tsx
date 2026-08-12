/**
 * PreciseEditCanvas — Click-to-edit overlay for RevisionStudioIQ Precise Edit mode.
 *
 * Two interaction modes:
 *   1. Click — sends a point to segment-click (SAM2) → returns a pixel-perfect
 *              mask of whatever panel/decal/text block was clicked.
 *   2. Box   — user drags a rectangle → we generate a filled rectangular mask
 *              client-side and send it as manualMaskBase64 (SAM2 bypassed).
 *
 * Once a mask is ready, the component shows a prompt input. Submitting calls
 * revise-render-masked (Flux.1 Fill Pro) to edit ONLY inside the mask — pixels
 * outside stay bit-identical to the input.
 *
 * Usage:
 *   <PreciseEditCanvas
 *     imageUrl={heroUrl}
 *     onSave={(newUrl) => persistToView(newUrl)}
 *     onClose={() => setDialogOpen(false)}
 *   />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Line, Ellipse, Arrow, Circle, Image as KonvaImage } from "react-konva";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, MousePointer2, Square, Undo2, Info, Spline, Eraser, Move, PenLine } from "lucide-react";
import { runLayerLift, isRemovalIntent, type NormalizedBox } from "@/lib/precise-erase-composite";
import {
  bboxFromPoints,
  boxMaskBase64,
  strokeMaskBase64,
  cutlineMaskBase64,
  type Pt,
} from "@/lib/markup-mask";
import type { LogoLayer, LogoPlacement } from "@/types/revision-logo";

type Mode = "click" | "box" | "markup";

// MarkupIQ — draw-on-the-render tools. CutLine is the headline tool: the
// customer draws the neon-teal line where the wrap should end and the masked
// pipeline repaints ONLY beyond it, so it can never wipe the whole front again.
type MarkupTool = "cutline" | "delete" | "move" | "pen";

// CutLine renders in neon teal so it's unmistakable against any wrap.
const CUTLINE_TEAL = "#00F5D4";
const DELETE_RED = "#FF3B5C";
const MOVE_AMBER = "#FFB020";
const PEN_CYAN = "#22D3EE";
const MASK_UPLOAD_TIMEOUT_MS = 30_000;
const MASK_RENDER_TIMEOUT_MS = 120_000;
const MASK_SAVE_TIMEOUT_MS = 30_000;

function withClientTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`)),
      timeoutMs,
    );
    Promise.resolve(operation).then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

interface Props {
  imageUrl: string;
  onSave: (newRenderUrl: string) => void | Promise<void>;
  onClose: () => void;
  // Optional source render context — passed through to revise-render-masked so
  // its wrap-aware prompt builder knows the base material/finish to fill with.
  finish?: string | null;
  colorName?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  // Which interaction mode the canvas opens in. Inline usage defaults to "box".
  defaultMode?: Mode;
  // Hide the Cancel button (inline usage has its own collapse control).
  hideCancel?: boolean;
  // When provided (with userId), a REMOVAL prompt on a box selection routes
  // through the LayerLift heal engine (precise-erase + composite-back) instead
  // of Flux Fill: the background self-heals cleanly AND the removed element is
  // handed back as a draggable layer for the LayerStrip. Additive/other prompts
  // still use the standard masked-edit path.
  userId?: string | null;
  onElementLifted?: (layer: LogoLayer, healedBgUrl: string) => void;
}

function useHtmlImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = src;
  }, [src]);
  return img;
}

export function PreciseEditCanvas({
  imageUrl,
  onSave,
  onClose,
  finish,
  colorName,
  vehicleMake,
  vehicleModel,
  defaultMode = "click",
  hideCancel = false,
  userId,
  onElementLifted,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 500 });
  const img = useHtmlImage(imageUrl);

  const [mode, setMode] = useState<Mode>(defaultMode);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [maskPreviewDataUrl, setMaskPreviewDataUrl] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [prompt, setPrompt] = useState("");

  // Box-draw state
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [tempRect, setTempRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Normalized (0-1) box of the current box selection — used to route a
  // removal prompt through the LayerLift heal+lift engine.
  const [selectedBox, setSelectedBox] = useState<NormalizedBox | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // ── MarkupIQ state (mode === "markup") ──────────────────────────────────
  // All mark geometry is stored in NORMALIZED image coords (0..1) so it stays
  // correct across resizes; we convert to/from stage pixels at the edges.
  const [markupTool, setMarkupTool] = useState<MarkupTool>("cutline");
  const [drawingMark, setDrawingMark] = useState(false);
  const [activePts, setActivePts] = useState<Pt[]>([]); // live drag path
  // CutLine: the drawn line + the tapped side to clear.
  const [cutLine, setCutLine] = useState<Pt[] | null>(null);
  const [cutTap, setCutTap] = useState<Pt | null>(null);
  // Delete (X): scribble path (for drawing) + its bbox region.
  const [deletePts, setDeletePts] = useState<Pt[] | null>(null);
  const [deleteBox, setDeleteBox] = useState<NormalizedBox | null>(null);
  // Move (circle + arrow): circled element bbox + destination vector.
  const [moveBox, setMoveBox] = useState<NormalizedBox | null>(null);
  const [moveArrow, setMoveArrow] = useState<{ from: Pt; to: Pt } | null>(null);
  // Pen (sketch): one or more freehand strokes.
  const [penStrokes, setPenStrokes] = useState<Pt[][]>([]);
  // Shared prompt for the markup tools (CutLine / Pen use it; Delete / Move
  // are self-describing).
  const [markupPrompt, setMarkupPrompt] = useState("");

  // Fit the stage to the natural aspect of the loaded image, capped to container.
  const imageAspect = img ? img.width / img.height : 16 / 10;
  const scaledSize = useMemo(() => {
    const maxW = stageSize.width;
    const maxH = stageSize.height;
    const w = Math.min(maxW, maxH * imageAspect);
    const h = w / imageAspect;
    return { width: w, height: h, offsetX: (maxW - w) / 2, offsetY: (maxH - h) / 2 };
  }, [stageSize, imageAspect]);

  useEffect(() => {
    if (!containerRef.current) return;
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
  }, []);

  // Stage-pixel ⇄ normalized-image coordinate conversion. All MarkupIQ geometry
  // lives in normalized (0..1) space; these bridge to/from the Konva stage.
  function stageToNorm(pos: { x: number; y: number }): Pt {
    return {
      x: Math.max(0, Math.min(1, (pos.x - scaledSize.offsetX) / scaledSize.width)),
      y: Math.max(0, Math.min(1, (pos.y - scaledSize.offsetY) / scaledSize.height)),
    };
  }
  // Flatten normalized points into the [x0,y0,x1,y1,…] array Konva lines want.
  function normToStageFlat(pts: Pt[]): number[] {
    const out: number[] = [];
    for (const p of pts) {
      out.push(scaledSize.offsetX + p.x * scaledSize.width, scaledSize.offsetY + p.y * scaledSize.height);
    }
    return out;
  }

  function clearMarkup() {
    setDrawingMark(false);
    setActivePts([]);
    setCutLine(null);
    setCutTap(null);
    setDeletePts(null);
    setDeleteBox(null);
    setMoveBox(null);
    setMoveArrow(null);
    setPenStrokes([]);
  }

  // Reset any in-progress mask when the user toggles mode
  useEffect(() => {
    setMaskUrl(null);
    setMaskPreviewDataUrl(null);
    setSelectedBox(null);
    clearMarkup();
  }, [mode]);

  // Switching markup tools clears in-progress marks so tools never blend.
  useEffect(() => {
    clearMarkup();
  }, [markupTool]);

  // ─────────────────────────────────────────────────────────────────────────
  // Click mode → segment-click (SAM2)
  // ─────────────────────────────────────────────────────────────────────────
  async function handleClickPoint(stageX: number, stageY: number) {
    if (!img) return;
    // Translate stage coords → image-normalized (0-1) coords
    const relX = (stageX - scaledSize.offsetX) / scaledSize.width;
    const relY = (stageY - scaledSize.offsetY) / scaledSize.height;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return;

    setSegmenting(true);
    try {
      const { data, error } = await supabase.functions.invoke("segment-click", {
        body: {
          imageUrl,
          clickX: relX,
          clickY: relY,
          imageWidth: img.width,
          imageHeight: img.height,
        },
      });
      if (error) throw error;
      if (!data?.maskUrl) throw new Error("Segment returned no mask");

      setMaskUrl(data.maskUrl);
      setMaskPreviewDataUrl(data.maskUrl); // same URL works for preview
      toast.success("Region selected. Now describe the edit.");
    } catch (err: any) {
      console.error("[PreciseEdit] segment error:", err);
      toast.error(`Could not segment region: ${err.message || err}`);
    } finally {
      setSegmenting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Box mode → build a filled-rect mask PNG client-side
  // ─────────────────────────────────────────────────────────────────────────
  async function handleBoxFinalize(rect: { x: number; y: number; width: number; height: number }) {
    if (!img) return;
    // Translate stage-space rect → image-pixel rect
    const x = ((rect.x - scaledSize.offsetX) / scaledSize.width) * img.width;
    const y = ((rect.y - scaledSize.offsetY) / scaledSize.height) * img.height;
    const w = (rect.width / scaledSize.width) * img.width;
    const h = (rect.height / scaledSize.height) * img.height;

    // Capture the normalized box so a removal prompt can route through the
    // LayerLift heal+lift engine (clean self-heal + draggable element back).
    setSelectedBox({
      xPct: Math.max(0, Math.min(1, x / img.width)),
      yPct: Math.max(0, Math.min(1, y / img.height)),
      wPct: Math.max(0, Math.min(1, w / img.width)),
      hPct: Math.max(0, Math.min(1, h / img.height)),
    });

    // Render a black PNG with a white rect at the masked area
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#FFF";
    ctx.fillRect(x, y, w, h);
    const base64 = canvas.toDataURL("image/png").split(",")[1];

    setSegmenting(true);
    try {
      const { data, error } = await supabase.functions.invoke("segment-click", {
        body: { manualMaskBase64: base64 },
      });
      if (error) throw error;
      if (!data?.maskUrl) throw new Error("Mask upload returned no URL");
      setMaskUrl(data.maskUrl);
      setMaskPreviewDataUrl(canvas.toDataURL("image/png"));
      toast.success("Region selected. Now describe the edit.");
    } catch (err: any) {
      toast.error(`Mask upload failed: ${err.message || err}`);
    } finally {
      setSegmenting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stage mouse handlers
  // ─────────────────────────────────────────────────────────────────────────
  function onMouseDown(e: any) {
    if (segmenting || rendering) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    if (mode === "markup") {
      markDown(pos);
    } else if (mode === "click") {
      handleClickPoint(pos.x, pos.y);
    } else {
      setDrawing(true);
      setDrawStart(pos);
      setTempRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    }
  }

  function onMouseMove(e: any) {
    if (mode === "markup") {
      const pos = e.target.getStage()?.getPointerPosition();
      if (pos) markMove(pos);
      return;
    }
    if (!drawing || !drawStart) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setTempRect({
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      width: Math.abs(pos.x - drawStart.x),
      height: Math.abs(pos.y - drawStart.y),
    });
  }

  function onMouseUp() {
    if (mode === "markup") {
      markUp();
      return;
    }
    if (!drawing || !tempRect) {
      setDrawing(false);
      setDrawStart(null);
      setTempRect(null);
      return;
    }
    if (tempRect.width > 10 && tempRect.height > 10) {
      handleBoxFinalize(tempRect);
    }
    setDrawing(false);
    setDrawStart(null);
    setTempRect(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Removal → LayerLift heal + lift engine (clean self-heal + draggable element)
  // ─────────────────────────────────────────────────────────────────────────
  function buildLiftedLayer(
    sourceUrl: string,
    origin: NormalizedBox,
    placement: LogoPlacement | null = null,
  ): LogoLayer {
    return {
      id: `lift_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kind: "extracted",
      sourceUrl,
      name: `Lift ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      origin: {
        xPct: origin.xPct + origin.wPct / 2,
        yPct: origin.yPct + origin.hPct / 2,
        wPct: origin.wPct,
        hPct: origin.hPct,
      },
      placement,
    };
  }

  // Remove + self-heal the boxed element and drop it into the LayerStrip. When
  // `placement` is supplied (the Move tool), the lifted element is pre-placed at
  // the arrow's destination so it reappears in its new spot; otherwise it comes
  // back unplaced (draggable) for the Delete tool / box-removal path.
  async function handleRemoveAndLift(box?: NormalizedBox, placement: LogoPlacement | null = null) {
    const target = box || selectedBox;
    if (!target) {
      toast.error("Select the layer region first. No edit was started.");
      return;
    }
    if (!userId || !onElementLifted) {
      toast.error(
        "The layered editor is not ready. Reopen the design and retry. No AI edit was started.",
        { duration: 12000 },
      );
      return;
    }
    setRendering(true);
    const toastId = toast.loading(placement ? "Moving + healing…" : "Removing + healing…");
    try {
      const result = await runLayerLift({
        renderUrl: imageUrl,
        box: target,
        userId,
        finish,
        colorName,
        vehicleMake,
        vehicleModel,
        intent: "remove",
        toolType: "revision",
      });
      onElementLifted(buildLiftedLayer(result.liftedAssetUrl, result.origin, placement), result.healedBackgroundUrl);
      await onSave(result.healedBackgroundUrl);
      toast.success(placement ? "Moved, healed & added to your layers." : "Removed, healed & added to your layers.", { id: toastId });
      onClose();
    } catch (err: any) {
      // Partial success: the element was lifted but the heal failed. Surface
      // the draggable element anyway and leave the background unchanged.
      if (err?.partial && err?.liftedAssetUrl && err?.origin) {
        if (placement) {
          toast.error(
            "The old location could not be healed, so nothing was moved or saved. Retry the move.",
            { id: toastId, duration: 12000 },
          );
          return;
        }
        onElementLifted(buildLiftedLayer(err.liftedAssetUrl, err.origin, placement), imageUrl);
        toast.warning("Element lifted & added to layers. Heal step failed — background unchanged.", { id: toastId, duration: 6000 });
        onClose();
        return;
      }
      console.error("[PreciseEdit] remove+lift error:", err);
      toast.error(`Remove failed: ${err?.message || err}`, { id: toastId });
    } finally {
      setRendering(false);
    }
  }

  // ── MarkupIQ pointer handlers ───────────────────────────────────────────
  function markDown(pos: { x: number; y: number }) {
    if (busy) return;
    const np = stageToNorm(pos);
    // CutLine waiting for the "which side" tap → this click sets it.
    if (markupTool === "cutline" && cutLine && !cutTap) {
      setCutTap(np);
      return;
    }
    setDrawingMark(true);
    setActivePts([np]);
  }

  function markMove(pos: { x: number; y: number }) {
    if (!drawingMark) return;
    setActivePts((prev) => [...prev, stageToNorm(pos)]);
  }

  function markUp() {
    if (!drawingMark) return;
    setDrawingMark(false);
    const pts = activePts;
    setActivePts([]);
    if (pts.length === 0) return;
    if (markupTool === "cutline") {
      if (pts.length >= 2) {
        setCutLine(pts);
        setCutTap(null);
      }
    } else if (markupTool === "delete") {
      setDeletePts(pts);
      setDeleteBox(bboxFromPoints(pts));
    } else if (markupTool === "move") {
      if (!moveBox) setMoveBox(bboxFromPoints(pts));
      else setMoveArrow({ from: pts[0], to: pts[pts.length - 1] });
    } else if (markupTool === "pen") {
      setPenStrokes((prev) => [...prev, pts]);
    }
  }

  // ── MarkupIQ apply — every tool resolves to a mask / lifted region so the
  // edit is pixel-locked to the marked area. ──────────────────────────────
  async function uploadMaskAndEdit(maskBase64: string, editPrompt: string) {
    setRendering(true);
    try {
      const { data: segData, error: segErr } = await withClientTimeout(
        supabase.functions.invoke("segment-click", {
          body: { manualMaskBase64: maskBase64 },
        }),
        MASK_UPLOAD_TIMEOUT_MS,
        "Mask upload",
      );
      if (segErr) throw segErr;
      if (!segData?.maskUrl) throw new Error("Mask upload returned no URL");
      const { data, error } = await withClientTimeout(
        supabase.functions.invoke("revise-render-masked", {
          body: {
            imageUrl,
            maskUrl: segData.maskUrl,
            prompt: editPrompt,
            finish: finish || undefined,
            colorName: colorName || undefined,
            vehicleMake: vehicleMake || undefined,
            vehicleModel: vehicleModel || undefined,
          },
        }),
        MASK_RENDER_TIMEOUT_MS,
        "Masked edit",
      );
      if (error) throw error;
      if (!data?.renderUrl) throw new Error("Edit returned no image");
      await withClientTimeout(
        Promise.resolve(onSave(data.renderUrl)),
        MASK_SAVE_TIMEOUT_MS,
        "Saving the edited revision",
      );
      toast.success("Edit applied.");
      onClose();
    } catch (err: any) {
      console.error("[MarkupIQ] edit error:", err);
      const detail = err?.message || String(err);
      const timedOut = /timed out after/i.test(detail);
      const saveTimedOut = /^Saving the edited revision timed out/i.test(detail);
      toast.error(
        timedOut
          ? saveTimedOut
            ? `${detail}. Refresh to check whether the revision saved before retrying.`
            : `${detail}. The original image remains active; retry once or reopen the editor.`
          : `Edit failed: ${detail}`,
        { duration: timedOut ? 12000 : 6000 },
      );
    } finally {
      setRendering(false);
    }
  }

  async function handleApplyMarkup() {
    if (!img) return;
    if (markupTool === "cutline") {
      if (!cutLine || !cutTap) {
        toast.error("Draw the cut line, then tap the side to clear.");
        return;
      }
      const maskBase64 = cutlineMaskBase64(cutLine, cutTap, img.width, img.height);
      if (!maskBase64) {
        toast.error("Couldn't read the cut line — redraw it across the panel and tap the side to clear.");
        return;
      }
      const editPrompt =
        markupPrompt.trim() ||
        `Remove the wrap from this area and restore the vehicle's clean factory ${finish || "gloss"} body paint — a smooth, unwrapped body panel with no graphics, stripes, logos, or text, matching the surrounding factory bodywork.`;
      await uploadMaskAndEdit(maskBase64, editPrompt);
      return;
    }
    if (markupTool === "pen") {
      if (!penStrokes.length) {
        toast.error("Sketch on the render first.");
        return;
      }
      if (!markupPrompt.trim()) {
        toast.error("Describe what to do with the sketched area.");
        return;
      }
      // Union every stroke into one mask.
      const allPts = penStrokes.flat();
      const maskBase64 =
        penStrokes.length === 1
          ? strokeMaskBase64(penStrokes[0], img.width, img.height)
          : boxMaskBase64(bboxFromPoints(allPts), img.width, img.height);
      await uploadMaskAndEdit(maskBase64, markupPrompt.trim());
      return;
    }
    if (markupTool === "delete") {
      if (!deleteBox) {
        toast.error("Scribble over the thing to delete.");
        return;
      }
      if (!userId || !onElementLifted) {
        toast.error(
          "Delete requires the signed-in layered editor. Reopen the design and retry. No AI edit was started.",
          { duration: 12000 },
        );
        return;
      }
      await handleRemoveAndLift(deleteBox);
      return;
    }
    if (markupTool === "move") {
      if (!moveBox || !moveArrow) {
        toast.error("Circle the element, then drag an arrow to where it should go.");
        return;
      }
      if (!userId || !onElementLifted) {
        toast.error("Move isn't available here — try the Delete tool to remove it instead.");
        return;
      }
      const placement: LogoPlacement = {
        xPct: moveArrow.to.x,
        yPct: moveArrow.to.y,
        size: "md",
        sizePercent: Math.max(0.05, Math.min(0.5, moveBox.wPct)),
        rotationDeg: 0,
      };
      await handleRemoveAndLift(moveBox, placement);
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Submit to revise-render-masked
  // ─────────────────────────────────────────────────────────────────────────
  async function handleApplyEdit() {
    if (!prompt.trim()) {
      toast.error("Describe the edit.");
      return;
    }
    // Removal on a box selection → clean self-heal + lift the element into the
    // LayerStrip via the precise-erase engine. This works straight off the
    // drawn box (no mask round-trip needed), so it runs before the maskUrl
    // guard. Additive/other prompts fall through to the standard masked edit.
    if (onElementLifted && userId && selectedBox && isRemovalIntent(prompt)) {
      await handleRemoveAndLift();
      return;
    }
    if (!maskUrl) {
      toast.error("Select a region first.");
      return;
    }
    setRendering(true);
    try {
      const { data, error } = await supabase.functions.invoke("revise-render-masked", {
        body: {
          imageUrl,
          maskUrl,
          prompt: prompt.trim(),
          finish: finish || undefined,
          colorName: colorName || undefined,
          vehicleMake: vehicleMake || undefined,
          vehicleModel: vehicleModel || undefined,
        },
      });
      if (error) throw error;
      if (!data?.renderUrl) throw new Error("Edit returned no image");
      await onSave(data.renderUrl);
      toast.success("Edit applied.");
      onClose();
    } catch (err: any) {
      console.error("[PreciseEdit] render error:", err);
      toast.error(`Edit failed: ${err.message || err}`);
    } finally {
      setRendering(false);
    }
  }

  function handleClearMask() {
    setMaskUrl(null);
    setMaskPreviewDataUrl(null);
    setSelectedBox(null);
  }

  const busy = segmenting || rendering;
  // A region is ready to prompt against once a box is drawn (box mode) or a
  // mask has uploaded (click mode). Box mode enables the prompt immediately.
  const regionReady = !!maskUrl || !!selectedBox;

  // ── MarkupIQ derived UI state ───────────────────────────────────────────
  const anyMarks = !!cutLine || !!deleteBox || !!moveBox || penStrokes.length > 0;
  const markupReady =
    markupTool === "cutline"
      ? !!cutLine && !!cutTap
      : markupTool === "delete"
        ? !!deleteBox
        : markupTool === "move"
          ? !!moveBox && !!moveArrow
          : penStrokes.length > 0; // pen
  // CutLine's prompt is optional (defaults to factory paint); Pen requires one.
  const markupPromptRequired = markupTool === "pen";
  const markupHint =
    markupTool === "cutline"
      ? cutLine
        ? cutTap
          ? "Ready — apply, or type what the cleared area should become"
          : "Now tap the side of the line to clear"
        : "Draw the line where the wrap should end"
      : markupTool === "delete"
        ? deleteBox
          ? "Ready — apply to remove it"
          : "Scribble over the thing to delete"
        : markupTool === "move"
          ? moveBox
            ? moveArrow
              ? "Ready — apply to move it"
              : "Drag an arrow to where it should go"
            : "Circle the element to move"
          : penStrokes.length // pen
            ? "Sketched — describe what to do with it, then apply"
            : "Sketch on the render";

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Mode toggle + reset */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={mode === "click" ? "default" : "outline"}
          onClick={() => setMode("click")}
          disabled={busy}
          title="Click any panel or decal and the AI auto-selects it, then describe the change."
        >
          <MousePointer2 className="w-4 h-4 mr-1" />
          Click panel
        </Button>
        <Button
          size="sm"
          variant={mode === "box" ? "default" : "outline"}
          onClick={() => setMode("box")}
          disabled={busy}
          title="Drag a rectangle around the area you want to edit, then describe the change."
        >
          <Square className="w-4 h-4 mr-1" />
          Box select
        </Button>
        <Button
          size="sm"
          variant={mode === "markup" ? "default" : "outline"}
          onClick={() => setMode("markup")}
          disabled={busy}
          className={mode === "markup" ? "" : "border-teal-500/40 text-teal-300 hover:text-teal-200"}
          title="MarkupIQ — draw the cut line / X / circle directly on the render"
        >
          <Spline className="w-4 h-4 mr-1" />
          MarkupIQ
        </Button>
        {maskUrl && (
          <Button size="sm" variant="ghost" onClick={handleClearMask} disabled={busy}>
            <Undo2 className="w-4 h-4 mr-1" />
            Clear region
          </Button>
        )}
        {mode === "markup" && anyMarks && (
          <Button size="sm" variant="ghost" onClick={clearMarkup} disabled={busy}>
            <Undo2 className="w-4 h-4 mr-1" />
            Clear marks
          </Button>
        )}
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
        >
          <Info className="w-3.5 h-3.5" />
          What does this tool do?
        </button>
        <div className="ml-auto text-xs text-zinc-400">
          {segmenting && "Finding region..."}
          {!segmenting && mode === "click" && !maskUrl && "Click the part to edit"}
          {!segmenting && mode === "box" && !maskUrl && "Drag a box around the area"}
          {!segmenting && mode !== "markup" && maskUrl && "Ready — describe the edit below"}
          {!segmenting && mode === "markup" && markupHint}
        </div>
      </div>

      {/* Tool explainer — toggled by the "What does this tool do?" link */}
      {showInfo && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5 text-xs text-zinc-300 leading-relaxed">
          <p className="font-semibold text-cyan-300 mb-1">Precision Editor — point &amp; prompt</p>
          <p>
            <span className="font-medium text-white">1.</span> Mark exactly where to edit: <span className="text-white">Click panel</span> to auto-select what you click, or <span className="text-white">Box select</span> to drag a rectangle around it.
          </p>
          <p>
            <span className="font-medium text-white">2.</span> Type what you want in the prompt below (e.g. &ldquo;remove the logo&rdquo;, &ldquo;add a chrome accent&rdquo;).
          </p>
          <p className="mt-1">
            <span className="font-medium text-white">Removing</span> a logo or text <span className="text-white">self-heals the background</span> automatically and drops the removed element into your <span className="text-white">Layers</span> — so you can drag it to a new spot, resize it, or download it as a transparent hi-res PNG. Only the marked area changes; the rest of the design stays exactly as-is.
          </p>
        </div>
      )}

      {/* MarkupIQ tool row — draw directly on the render. Each tool shows a
          hover tooltip box explaining what it does. */}
      {mode === "markup" && (
        <TooltipProvider delayDuration={150}>
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              {
                id: "cutline",
                label: "CutLine",
                icon: Spline,
                color: "text-teal-300 border-teal-500/50",
                tip: "Draw the neon-teal line where the wrap should END, then tap the side to clear. Only that side repaints — to clean factory paint by default, or type 'matte black', 'gloss black', etc. The rest of the vehicle stays locked.",
              },
              {
                id: "delete",
                label: "Delete (X)",
                icon: Eraser,
                color: "text-red-300 border-red-500/50",
                tip: "Scribble over a logo, phone number, or graphic to remove it. The wrap behind it self-heals and the removed piece drops into your Layers (draggable & downloadable).",
              },
              {
                id: "move",
                label: "Move",
                icon: Move,
                color: "text-amber-300 border-amber-500/50",
                tip: "Circle the element you want to move, then drag an arrow to its new spot. It lifts the element, heals the old location, and re-places it where the arrow points.",
              },
              {
                id: "pen",
                label: "Pen",
                icon: PenLine,
                color: "text-cyan-300 border-cyan-500/50",
                tip: "Freehand-mark any area, then describe the change below (e.g. 'add a blue flame here', 'make this carbon fiber'). Only the area you mark changes.",
              },
            ] as const).map((t) => {
              const Icon = t.icon;
              const active = markupTool === t.id;
              return (
                <Tooltip key={t.id}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => setMarkupTool(t.id)}
                      disabled={busy}
                      className={active ? "" : t.color}
                    >
                      <Icon className="w-4 h-4 mr-1" />
                      {t.label}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
                    <p className="font-semibold mb-0.5">{t.label}</p>
                    {t.tip}
                  </TooltipContent>
                </Tooltip>
              );
            })}
            <span className="ml-1 text-[11px] text-zinc-500">
              {markupTool === "cutline" && "Draw where the wrap ends · tap the side to clear — only that area repaints, the rest is locked"}
              {markupTool === "delete" && "Scribble over a logo/graphic to remove + self-heal"}
              {markupTool === "move" && "Circle an element, then arrow it to a new spot"}
              {markupTool === "pen" && "Freehand-mark an area, then describe the change"}
            </span>
          </div>
        </TooltipProvider>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-[400px] rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950"
        style={{ cursor: busy ? "wait" : mode === "click" ? "pointer" : "crosshair" }}
      >
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onTouchStart={onMouseDown}
          onTouchMove={onMouseMove}
          onTouchEnd={onMouseUp}
        >
          <Layer>
            {img && (
              <KonvaImage
                image={img}
                x={scaledSize.offsetX}
                y={scaledSize.offsetY}
                width={scaledSize.width}
                height={scaledSize.height}
                listening={false}
              />
            )}
          </Layer>
          <Layer>
            {/* Live box-drawing rectangle */}
            {tempRect && tempRect.width > 0 && tempRect.height > 0 && (
              <Rect
                x={tempRect.x}
                y={tempRect.y}
                width={tempRect.width}
                height={tempRect.height}
                stroke="#22d3ee"
                strokeWidth={2}
                dash={[6, 3]}
                fill="rgba(34, 211, 238, 0.15)"
                listening={false}
              />
            )}

            {/* ── MarkupIQ marks ─────────────────────────────────────── */}
            {mode === "markup" && (
              <>
                {/* Live drag stroke in the active tool's color */}
                {activePts.length > 1 && (
                  <Line
                    points={normToStageFlat(activePts)}
                    stroke={
                      markupTool === "delete" ? DELETE_RED : markupTool === "move" ? MOVE_AMBER : markupTool === "pen" ? PEN_CYAN : CUTLINE_TEAL
                    }
                    strokeWidth={markupTool === "cutline" ? 4 : 3}
                    lineCap="round"
                    lineJoin="round"
                    tension={markupTool === "cutline" ? 0 : 0.4}
                    shadowColor={markupTool === "cutline" ? CUTLINE_TEAL : undefined}
                    shadowBlur={markupTool === "cutline" ? 12 : 0}
                    listening={false}
                  />
                )}

                {/* CutLine — committed neon-teal line + tapped-side marker */}
                {cutLine && (
                  <Line
                    points={normToStageFlat(cutLine)}
                    stroke={CUTLINE_TEAL}
                    strokeWidth={4}
                    lineCap="round"
                    lineJoin="round"
                    shadowColor={CUTLINE_TEAL}
                    shadowBlur={14}
                    listening={false}
                  />
                )}
                {cutTap && (
                  <Circle
                    x={scaledSize.offsetX + cutTap.x * scaledSize.width}
                    y={scaledSize.offsetY + cutTap.y * scaledSize.height}
                    radius={10}
                    fill="rgba(0, 245, 212, 0.25)"
                    stroke={CUTLINE_TEAL}
                    strokeWidth={2}
                    listening={false}
                  />
                )}

                {/* Delete — red scribble + its bbox */}
                {deletePts && deletePts.length > 1 && (
                  <Line points={normToStageFlat(deletePts)} stroke={DELETE_RED} strokeWidth={3} lineCap="round" lineJoin="round" tension={0.4} listening={false} />
                )}
                {deleteBox && (
                  <Rect
                    x={scaledSize.offsetX + deleteBox.xPct * scaledSize.width}
                    y={scaledSize.offsetY + deleteBox.yPct * scaledSize.height}
                    width={deleteBox.wPct * scaledSize.width}
                    height={deleteBox.hPct * scaledSize.height}
                    stroke={DELETE_RED}
                    strokeWidth={2}
                    dash={[6, 3]}
                    listening={false}
                  />
                )}

                {/* Move — amber circle around the element + destination arrow */}
                {moveBox && (
                  <Ellipse
                    x={scaledSize.offsetX + (moveBox.xPct + moveBox.wPct / 2) * scaledSize.width}
                    y={scaledSize.offsetY + (moveBox.yPct + moveBox.hPct / 2) * scaledSize.height}
                    radiusX={(moveBox.wPct / 2) * scaledSize.width}
                    radiusY={(moveBox.hPct / 2) * scaledSize.height}
                    stroke={MOVE_AMBER}
                    strokeWidth={2.5}
                    dash={[6, 4]}
                    listening={false}
                  />
                )}
                {moveArrow && (
                  <Arrow
                    points={normToStageFlat([moveArrow.from, moveArrow.to])}
                    stroke={MOVE_AMBER}
                    fill={MOVE_AMBER}
                    strokeWidth={3}
                    pointerLength={12}
                    pointerWidth={12}
                    listening={false}
                  />
                )}

                {/* Pen — cyan freehand strokes */}
                {penStrokes.map((s, i) => (
                  <Line key={i} points={normToStageFlat(s)} stroke={PEN_CYAN} strokeWidth={3} lineCap="round" lineJoin="round" tension={0.4} listening={false} />
                ))}
              </>
            )}
          </Layer>
        </Stage>

        {/* Mask preview overlay — cyan-tinted */}
        {maskPreviewDataUrl && (
          <img
            src={maskPreviewDataUrl}
            alt="Selected region"
            className="absolute pointer-events-none mix-blend-screen opacity-60"
            style={{
              left: scaledSize.offsetX,
              top: scaledSize.offsetY,
              width: scaledSize.width,
              height: scaledSize.height,
              filter: "drop-shadow(0 0 0 rgb(34, 211, 238))",
            }}
          />
        )}

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-cyan-400 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              {segmenting ? "Segmenting region..." : "Applying edit..."}
            </div>
          </div>
        )}
      </div>

      {/* ── MarkupIQ footer ── */}
      {mode === "markup" ? (
        <div className="flex flex-col gap-2 flex-shrink-0">
          {(markupTool === "cutline" || markupTool === "pen") && markupReady && (
            <div className="flex flex-wrap gap-1.5">
              {(markupTool === "cutline"
                ? [
                    { label: "Factory paint", text: "" },
                    { label: "Matte black", text: "Repaint this area in smooth factory matte black body paint — no wrap, no graphics." },
                    { label: "Gloss black", text: "Repaint this area in smooth factory gloss black body paint — no wrap, no graphics." },
                  ]
                : [
                    { label: "Add chrome accent", text: "Add a sleek chrome accent here" },
                    { label: "Matte black", text: "Change this area to matte black" },
                    { label: "Remove", text: "Remove everything here and continue the wrap" },
                  ]
              ).map((p) => (
                <Button key={p.label} size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setMarkupPrompt(p.text)} disabled={busy}>
                  {p.label}
                </Button>
              ))}
            </div>
          )}
          {(markupTool === "cutline" || markupTool === "pen") && (
            <Textarea
              value={markupPrompt}
              onChange={(e) => setMarkupPrompt(e.target.value)}
              placeholder={
                markupTool === "cutline"
                  ? "Optional — what the cleared area becomes (default: factory paint). e.g. 'matte black', 'leave bare metal'"
                  : "Describe the change for the sketched area (e.g. 'add a blue flame', 'make this carbon fiber')"
              }
              disabled={busy}
              rows={2}
              className="resize-none"
            />
          )}
          <div className="flex items-center gap-2 justify-end">
            {anyMarks && (
              <Button variant="ghost" onClick={clearMarkup} disabled={busy} className="text-zinc-400 hover:text-white">
                <Undo2 className="w-4 h-4 mr-1" />
                Clear marks
              </Button>
            )}
            {!hideCancel && (
              <Button variant="outline" onClick={onClose} disabled={rendering}>
                Cancel
              </Button>
            )}
            <Button
              onClick={handleApplyMarkup}
              disabled={!markupReady || (markupPromptRequired && !markupPrompt.trim()) || busy}
              className="bg-teal-500 hover:bg-teal-400 text-black font-semibold"
            >
              {rendering ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {markupTool === "cutline" ? "Apply CutLine" : markupTool === "delete" ? "Apply Delete" : markupTool === "move" ? "Apply Move" : "Apply Sketch"}
            </Button>
          </div>
        </div>
      ) : (
        /* Prompt + actions. regionReady = a box was drawn OR a mask finished
           uploading. We enable the prompt as soon as the box exists so you can
           type the edit immediately after drawing, without waiting on the
           mask round-trip. */
        <div className="flex flex-col gap-2 flex-shrink-0">
          {regionReady && (
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Glass panel", text: "Add a frosted glassmorphism panel here" },
                { label: "Matte black", text: "Change this panel to matte black" },
                { label: "Carbon fiber", text: "Replace with carbon fiber texture" },
                { label: "Remove", text: "Remove everything here and continue the wrap" },
              ].map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => setPrompt(p.text)}
                  disabled={busy}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={regionReady ? "Describe the edit (e.g. 'remove the logo', 'change this panel to matte black', 'remove the phone number')" : "Draw a box or click a panel first"}
            disabled={!regionReady || busy}
            rows={2}
            className="resize-none"
          />
          <div className="flex gap-2 justify-end">
            {!hideCancel && (
              <Button variant="outline" onClick={onClose} disabled={rendering}>
                Cancel
              </Button>
            )}
            <Button onClick={handleApplyEdit} disabled={!regionReady || !prompt.trim() || busy}>
              {rendering ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Apply edit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
