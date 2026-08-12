import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, Download, LayoutGrid, CheckCircle2, AlertTriangle, RefreshCw, Layers, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  urlToImageBitmap, boxExtract, uploadLogoAsset, uploadCleanBackground,
} from "@/lib/logo-composite";

/**
 * TwoDProofArtboard — "2D Proof → Artboard (R4)"
 *
 * One click turns an APPROVED 2D proof into a print-ready ARTBOARD of flat
 * rectangle panels — the Summit / Cadillac ESV gold-standard layout:
 *
 *   1. For EACH side panel, send the 2D proof + that side's real-world inches
 *      to flat-panel-openai. It recreates ONLY that side's wrap design as a
 *      clean, straight-on, edge-to-edge FLAT rectangle (no vehicle, no wheels)
 *      and (optionally) 4x-upscales it to print resolution. Each returned file
 *      is itself a print-ready per-panel deliverable.
 *   2. Compose every flat rectangle onto ONE artboard sheet — actual relative
 *      sizing, per-panel dimension labels, a header (vehicle / order / finish /
 *      coverage), and a DIMENSION REFERENCE + PRODUCTION NOTES legend.
 *
 * Everything here reuses already-deployed functions (flat-panel-openai +
 * upscale-production-panel). The artboard sheet itself is composed in the
 * browser, so no edge function is added or changed.
 */

// ── Side-key mapping ────────────────────────────────────────────────
// flat-panel-openai knows these side keys (PANEL_INCHES). We normalise each
// job panel id/label down to one of them so it picks the right orientation
// and the right region of the multi-view proof.
const SIDE_ALIASES: Array<{ test: RegExp; key: string }> = [
  { test: /front.?bumper/i, key: "front_bumper" },
  { test: /rear.?bumper/i, key: "rear_bumper" },
  { test: /driver/i, key: "driver_side" },
  { test: /passenger/i, key: "passenger_side" },
  { test: /hood/i, key: "hood" },
  { test: /roof|top/i, key: "roof" },
  { test: /rear|trunk|tailgate|back/i, key: "rear" },
  { test: /front/i, key: "front" },
  { test: /side/i, key: "driver_side" },
];

function sideKeyFor(panel: { id?: string; label?: string }): string {
  const hay = `${panel.id || ""} ${panel.label || ""}`;
  for (const a of SIDE_ALIASES) if (a.test.test(hay)) return a.key;
  return "driver_side";
}

const FINISHES = ["Gloss", "Satin", "Matte"];

export interface ArtboardPanel {
  id?: string;
  label?: string;
  widthInches?: number;
  heightInches?: number;
  mirrored?: boolean;
}

type PanelStatus = "idle" | "working" | "done" | "error";
// Sub-stage shown under a panel while the automatic complex step runs.
type SubStatus = "flattening" | "lifting" | "upscaling" | undefined;

// A branding/graphic element lifted off a flattened side as a transparent PNG.
// Placement is normalized 0-1 (center-based) so it can be re-composited on the
// clean base at any resolution by LayerLift / the editor.
interface LiftedLayer {
  url: string;          // transparent-PNG layer in storage
  type: string;         // logo | text | phone | url | graphic
  label: string;
  xPct: number; yPct: number; wPct: number; hPct: number;
}

interface PanelState {
  key: string;          // stable react key
  sideKey: string;      // flat-panel-openai side
  label: string;
  widthInches: number;
  heightInches: number;
  mirrored: boolean;
  status: PanelStatus;
  subStatus?: SubStatus;
  flatUrl?: string;     // composite-resolution flat panel (scaledUrl) — full design
  cleanUrl?: string;    // de-branded healed base (elements lifted off)
  upscaledUrl?: string; // highest-res (Real-ESRGAN 8×) print base
  liftedLayers?: LiftedLayer[]; // transparent-PNG overlays lifted off this side
  printUrl?: string;    // print-ready base (upscaled clean, else flat)
  error?: string;
}

// Branding always lifted. On restyle jobs we ALSO lift "graphic" elements —
// the big focal-point artwork that adds depth — so the hero base stays clean
// and every layer that carries the design is independently editable.
const BRANDING_TYPES = new Set(["logo", "text", "phone", "url"]);

// Decode any URL to capped ImageData (≤maxDim long edge) for client-side
// extraction + FMM inpaint — keeps the canvas responsive on large panels.
async function urlToCappedImageData(url: string, maxDim = 2048): Promise<ImageData> {
  const bmp = await urlToImageBitmap(url);
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return ctx.getImageData(0, 0, w, h);
}

async function blobToImageData(blob: Blob, maxDim = 2048): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return ctx.getImageData(0, 0, w, h);
}

async function imageDataToBlob(img: ImageData): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png"),
  );
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string | null;
  proofUrl: string | null;
  panels: ArtboardPanel[] | null;
  vehicleName?: string;
  orderNumber?: string;
  finish?: string | null;
  coverageSqFt?: number | null;
  userId?: string | null;
  /** restyle → also lift big graphic/focal elements; commercial → branding only. */
  category?: "restyle" | "commercial" | string | null;
  /** Called after the artboard is saved as the job artboard so the parent can refetch. */
  onArtboardSaved?: (url: string) => void;
}

// Load an image with CORS enabled + cache-bust so the canvas never taints
// (a tainted canvas makes toBlob throw — same trick as reconstructPanelArtwork).
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = /^(blob:|data:)/.test(url)
      ? url
      : url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now();
  });
}

async function blobDownload(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(obj), 8000);
  } catch { window.open(url, "_blank"); }
}

export function TwoDProofArtboard({
  open, onOpenChange, jobId, proofUrl, panels,
  vehicleName, orderNumber, finish, coverageSqFt, userId, category, onArtboardSaved,
}: Props) {
  const isRestyle = (category || "restyle") !== "commercial";
  const [items, setItems] = useState<PanelState[]>([]);
  const [finishSel, setFinishSel] = useState(finish && FINISHES.includes(finish) ? finish : "Gloss");
  // Artboard-First complex step: lift logos/text/graphics off each side as
  // transparent PNGs (our internal precise-erase tool, no Canva/ChatGPT) and
  // 8× upscale the clean base to the highest resolution. Default ON.
  const [autoFinish, setAutoFinish] = useState(true);
  const [proof, setProof] = useState(proofUrl || "");
  // Default OFF for the artboard pass: a native gpt-image-1 panel is plenty to
  // SEE the artboard, and skipping the 4x Real-ESRGAN step per side keeps the
  // whole batch fast. Tick it on when generating the final print-res files.
  const [upscale, setUpscale] = useState(false);
  const [running, setRunning] = useState(false);
  const [composing, setComposing] = useState(false);
  const [artboardPreview, setArtboardPreview] = useState<string | null>(null);
  const [artboardBlob, setArtboardBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportingPrint, setExportingPrint] = useState(false);
  const [printReady, setPrintReady] = useState<Record<string, string>>({}); // panel key → print-ready (2" bleed) url
  const cancelled = useRef(false);

  // Seed one panel-state per job panel whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setProof(proofUrl || "");
    setArtboardPreview(null);
    setArtboardBlob(null);
    const seeded: PanelState[] = (panels || [])
      .filter((p) => (p.widthInches || 0) > 0 && (p.heightInches || 0) > 0)
      .map((p, i) => ({
        key: `${p.id || p.label || "panel"}_${i}`,
        sideKey: sideKeyFor(p),
        label: (p.label || p.id || `Panel ${i + 1}`).toString(),
        widthInches: p.widthInches!,
        heightInches: p.heightInches!,
        mirrored: !!p.mirrored,
        status: "idle",
      }));
    setItems(seeded);
  }, [open, proofUrl, panels]);

  const allDone = items.length > 0 && items.every((i) => i.status === "done");
  const anyDone = items.some((i) => i.status === "done");

  // ── Step 1: flatten every side from the 2D proof ──────────────────
  async function flattenOne(it: PanelState): Promise<PanelState> {
    const isSide = /side|driver|passenger/.test(it.sideKey);
    const { data, error } = await renderClient.functions.invoke("flat-panel-openai", {
      body: {
        imageUrl: proof,
        side: it.sideKey,
        finish: finishSel,
        upscale,
        noWheels: isSide, // sides cross wheel wells — reconstruct over them
        widthIn: it.widthInches,
        heightIn: it.heightInches,
      },
    });
    if (error) return { ...it, status: "error", error: error.message || "edge error" };
    if (!data?.success) return { ...it, status: "error", error: data?.error || "generation failed" };
    return {
      ...it,
      status: "done",
      flatUrl: data.scaledUrl || data.url,
      printUrl: data.url || data.scaledUrl,
      error: undefined,
    };
  }

  // ── Complex step (internal, no Canva/ChatGPT) ─────────────────────
  // Auto-detect branding (+ big graphic/focal elements on restyle), lift each
  // off the flattened side as a TRANSPARENT PNG with our precise-erase tool
  // (boxExtract → FMM inpaint heal), chaining the heal so every element is
  // removed from ONE clean base. Returns the de-branded base + the layers.
  async function autoLiftSide(flatUrl: string): Promise<{ cleanUrl: string; layers: LiftedLayer[] } | null> {
    if (!userId) return null;
    let raw: Array<{ type: string; label: string; bounding_box: { x: number; y: number; width: number; height: number } }> = [];
    try {
      const { data, error } = await renderClient.functions.invoke("extract-logo-elements", {
        body: { job_id: jobId, approved_render_url: flatUrl, concept_json: null },
      });
      if (error) return null;
      raw = (data?.elements || []) as typeof raw;
    } catch { return null; }

    const wanted = raw
      .filter((e) => e.bounding_box && e.bounding_box.width > 0 && e.bounding_box.height > 0)
      .filter((e) => BRANDING_TYPES.has(e.type) || (isRestyle && e.type === "graphic"));
    if (wanted.length === 0) return null;

    let imgData = await urlToCappedImageData(flatUrl);
    const W = imgData.width, H = imgData.height;
    const layers: LiftedLayer[] = [];
    for (const el of wanted) {
      const b = el.bounding_box;
      const x1 = Math.max(0, Math.min(1, b.x));
      const y1 = Math.max(0, Math.min(1, b.y));
      const x2 = Math.max(0, Math.min(1, b.x + b.width));
      const y2 = Math.max(0, Math.min(1, b.y + b.height));
      const res = await boxExtract(imgData, x1, y1, x2, y2);
      if (!res) continue;
      try {
        const layerUrl = await uploadLogoAsset(res.extractedBlob, userId, "layer");
        layers.push({
          url: layerUrl, type: el.type, label: el.label,
          xPct: (res.bbox.x + res.bbox.w / 2) / W,
          yPct: (res.bbox.y + res.bbox.h / 2) / H,
          wPct: res.bbox.w / W,
          hPct: res.bbox.h / H,
        });
        // Heal feeds forward so the next element is lifted from the cleaned base.
        imgData = await blobToImageData(res.patchedSourceBlob);
      } catch { /* one layer failing must not abort the side */ }
      URL.revokeObjectURL(res.extractedPreviewUrl);
    }
    if (layers.length === 0) return null;
    const cleanUrl = await uploadCleanBackground(await imageDataToBlob(imgData), userId);
    return { cleanUrl, layers };
  }

  // Real-ESRGAN 8× max — the engine clamps to its safe GPU cap and reports the
  // achieved scale; on ANY failure we return null and keep the input.
  async function upscaleHighest(url: string): Promise<string | null> {
    try {
      const { data, error } = await renderClient.functions.invoke("upscale-production-panel", {
        body: { image_url: url, scale: 8 },
      });
      if (error || !data?.success) return null;
      return data.upscaled_url || null;
    } catch { return null; }
  }

  const patchItem = (key: string, patch: Partial<PanelState>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  // Full per-side pipeline: flatten → (auto) lift transparent PNGs → (auto) 8× upscale.
  async function processOne(it: PanelState): Promise<PanelState> {
    patchItem(it.key, { status: "working", subStatus: "flattening", error: undefined });
    const flat = await flattenOne(it);
    if (flat.status === "error") return { ...flat, subStatus: undefined };
    let out: PanelState = { ...flat };
    let base = flat.flatUrl!;

    if (autoFinish && userId) {
      patchItem(it.key, { ...out, subStatus: "lifting" });
      try {
        const lifted = await autoLiftSide(flat.flatUrl!);
        if (lifted) {
          out = { ...out, cleanUrl: lifted.cleanUrl, liftedLayers: lifted.layers };
          base = lifted.cleanUrl;
        }
      } catch { /* lift is best-effort; fall back to the full flat */ }

      patchItem(it.key, { ...out, subStatus: "upscaling" });
      const up = await upscaleHighest(base);
      if (up) out = { ...out, upscaledUrl: up, printUrl: up };
    }
    return { ...out, status: "done", subStatus: undefined };
  }

  const runFlatten = async (onlyKey?: string) => {
    if (!proof) { toast.error("No 2D proof to flatten — paste a proof URL first."); return; }
    cancelled.current = false;
    setRunning(true);
    setArtboardPreview(null);
    setArtboardBlob(null);
    try {
      const queue = items.filter((i) => (onlyKey ? i.key === onlyKey : i.status !== "done"));
      // Run every side's full pipeline (flatten → lift → upscale) in PARALLEL.
      // Each side streams its sub-status + result back into the grid as it
      // resolves, so a ~6-side batch finishes in one heavy pass instead of a
      // sequential crawl.
      await Promise.all(queue.map(async (target) => {
        if (cancelled.current) return;
        const result = await processOne(target);
        setItems((prev) => prev.map((i) => i.key === target.key ? result : i));
        if (result.status === "error") toast.error(`${result.label}: ${result.error}`);
      }));
    } finally {
      setRunning(false);
    }
  };

  // ── Step 2: compose the artboard sheet in the browser ─────────────
  // Produces a TRUE 21:9 print-ready artboard that mirrors the Summit /
  // Ridgeline gold standard: each side drawn as a clean RECTANGLE at its real
  // aspect ratio, laid out in two balanced columns, with a dimension label
  // ("DRIVER SIDE: 173" × 60.5"") centered under each panel. The per-panel
  // print files (with 2" bleed) are exported separately by
  // exportPrintReadyPanels(); the artboard itself shows panels at TRIM size so
  // the labels read true to the gold-standard sheet.
  const composeArtboard = async () => {
    const ready = items.filter((i) => i.status === "done" && i.flatUrl);
    if (ready.length === 0) { toast.error("Flatten the panels first."); return; }
    setComposing(true);
    try {
      const BLEED = 2; // inches — added to each per-panel print file on export

      // ── 21:9 canvas ────────────────────────────────────────────────
      const ASPECT = 21 / 9;
      const CANVAS_W = 4200;
      const CANVAS_H = Math.round(CANVAS_W / ASPECT); // 1800 → exact 21:9
      const PAD = 70;
      const HEADER_H = 150;
      const LABEL_H = 50;   // px reserved under each panel for its dimension line
      const PANEL_GAP = 40; // px vertical gap between stacked panels
      const COL_GAP_IN = 14;

      // ── Two-column assignment (matches the gold-standard sheet) ─────
      // LEFT: driver / passenger / front bumper / front.  RIGHT: hood / roof /
      // rear / rear bumper. If one column ends up empty (e.g. sides only),
      // rebalance by moving the back half over so the sheet stays even.
      const LEFT_SET = new Set(["driver_side", "passenger_side", "front_bumper", "front"]);
      let left = ready.filter((p) => LEFT_SET.has(p.sideKey));
      let right = ready.filter((p) => !LEFT_SET.has(p.sideKey));
      if (left.length === 0 || right.length === 0) {
        const all = [...ready];
        const half = Math.ceil(all.length / 2);
        left = all.slice(0, half);
        right = all.slice(half);
      }

      const colWidthIn = (col: PanelState[]) =>
        col.reduce((m, p) => Math.max(m, p.widthInches), 0);
      const colHeightIn = (col: PanelState[]) =>
        col.reduce((s, p) => s + p.heightInches, 0);
      const colExtraPx = (col: PanelState[]) =>
        col.length * (LABEL_H + PANEL_GAP);

      const leftWIn = colWidthIn(left);
      const rightWIn = colWidthIn(right);
      const layoutWIn = leftWIn + rightWIn + (left.length && right.length ? COL_GAP_IN : 0);

      const availW = CANVAS_W - PAD * 2;
      const availH = CANVAS_H - HEADER_H - PAD;

      // px-per-inch scale that fits BOTH the width and the taller column.
      const sW = layoutWIn > 0 ? availW / layoutWIn : 1;
      const sHleft = left.length ? (availH - colExtraPx(left)) / Math.max(1, colHeightIn(left)) : Infinity;
      const sHright = right.length ? (availH - colExtraPx(right)) / Math.max(1, colHeightIn(right)) : Infinity;
      const scale = Math.max(1, Math.min(sW, sHleft, sHright));

      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // ── Header ──────────────────────────────────────────────────────
      const title = `${(vehicleName || "VEHICLE").toUpperCase()} — WRAP PRODUCTION ARTBOARD`;
      const sub = orderNumber ? `Order ${orderNumber}` : "";
      ctx.fillStyle = "#111111";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.font = "700 44px Oswald, Arial, sans-serif";
      ctx.fillText(title, PAD, PAD);
      ctx.font = "500 24px Inter, Arial, sans-serif";
      ctx.fillStyle = "#444";
      const specLine = [
        sub,
        `Finish: ${finishSel}`,
        coverageSqFt ? `Coverage: ${coverageSqFt} sq ft` : "",
      ].filter(Boolean).join("   |   ");
      ctx.fillText(specLine, PAD, PAD + 56);
      ctx.fillStyle = "#0EA5E9";
      ctx.font = "600 20px Inter, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        `ALL PANELS @ ACTUAL SIZE  ·  300 DPI  ·  CMYK  ·  ${BLEED}" BLEED PER PANEL`,
        CANVAS_W - PAD, PAD + 8,
      );
      ctx.textAlign = "left";
      ctx.strokeStyle = "#E5E5E5";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PAD, HEADER_H - 10); ctx.lineTo(CANVAS_W - PAD, HEADER_H - 10); ctx.stroke();

      // ── Draw one column ─────────────────────────────────────────────
      const blockWpx = layoutWIn * scale;
      const startX = Math.round((CANVAS_W - blockWpx) / 2);
      const leftColX = startX;
      const rightColX = startX + (leftWIn + (left.length && right.length ? COL_GAP_IN : 0)) * scale;

      const drawColumn = async (col: PanelState[], colX: number, colWIn: number) => {
        const colWpx = colWIn * scale;
        const blockH = colHeightIn(col) * scale + colExtraPx(col);
        let curY = HEADER_H + Math.max(0, (availH - blockH) / 2); // vertically center
        for (const p of col) {
          const pW = Math.max(2, Math.round(p.widthInches * scale));
          const pH = Math.max(2, Math.round(p.heightInches * scale));
          const x = Math.round(colX + (colWpx - pW) / 2); // center panel in its column
          const y = Math.round(curY);
          try {
            const img = await loadImage(p.flatUrl!);
            ctx.save();
            if (p.mirrored) {
              ctx.translate(x + pW, y);
              ctx.scale(-1, 1);
              ctx.drawImage(img, 0, 0, pW, pH);
            } else {
              ctx.drawImage(img, x, y, pW, pH);
            }
            ctx.restore();
          } catch {
            ctx.fillStyle = "#EAEAEA";
            ctx.fillRect(x, y, pW, pH);
          }
          // crisp trim outline
          ctx.strokeStyle = "#1a1a1a";
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 1.5, y + 1.5, pW - 3, pH - 3);
          // dimension label — gold-standard format: "DRIVER SIDE: 173" × 60.5""
          ctx.fillStyle = "#111";
          ctx.font = "700 26px Oswald, Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            `${p.label.toUpperCase()}: ${p.widthInches}" × ${p.heightInches}"`,
            x + pW / 2, y + pH + 12,
          );
          ctx.textAlign = "left";
          curY = y + pH + LABEL_H + PANEL_GAP;
        }
      };

      await drawColumn(left, leftColX, leftWIn);
      if (right.length) await drawColumn(right, rightColX, rightWIn);

      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png"),
      );
      setArtboardBlob(blob);
      setArtboardPreview(URL.createObjectURL(blob));
      toast.success(`21:9 artboard composed (${CANVAS_W}×${CANVAS_H})`);
    } catch (e: any) {
      toast.error(`Compose failed: ${e?.message || e}`);
    } finally {
      setComposing(false);
    }
  };

  // Auto-compose once every panel is flattened.
  useEffect(() => {
    if (allDone && !artboardBlob && !composing) composeArtboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  const saveAsArtboard = async () => {
    if (!artboardBlob || !jobId) return;
    setSaving(true);
    try {
      const path = `artboards/${jobId}/artboard.png`;
      const { error: upErr } = await supabase.storage
        .from("wrap-files")
        .upload(path, artboardBlob, { contentType: "image/png", upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 3600);

      // Patch concept_json so the page can find it + mark fresh.
      const { data: jobRow } = await supabase
        .from("panelizer_jobs" as any)
        .select("concept_json")
        .eq("id", jobId)
        .maybeSingle();
      const cj = (jobRow as any)?.concept_json || {};
      await supabase.from("panelizer_jobs" as any).update({
        artboard_storage_path: path,
        concept_json: {
          ...cj,
          artboard_source: "2d_proof_r4",
          artboard_stale: false,
          artboard_regenerated_at: new Date().toISOString(),
          r4_panel_files: items
            .filter((i) => i.printUrl || i.flatUrl)
            .map((i) => ({
              side: i.sideKey, label: i.label,
              url: i.upscaledUrl || i.printUrl || i.flatUrl,
              flat_url: i.flatUrl || null,
              clean_url: i.cleanUrl || null,
              upscaled_url: i.upscaledUrl || null,
              lifted_layers: i.liftedLayers || [],
              widthInches: i.widthInches, heightInches: i.heightInches,
            })),
          // Artboard-First: every transparent-PNG element lifted off each side,
          // flattened into one list so LayerLift / the editor can re-place them.
          r4_lifted_layers: items.flatMap((i) =>
            (i.liftedLayers || []).map((l) => ({ side: i.sideKey, ...l }))),
        },
      }).eq("id", jobId);

      toast.success("Saved as job artboard");
      if (signed?.signedUrl) onArtboardSaved?.(signed.signedUrl);
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Step 3: duplicate each flattened side → individual PRINT-READY file with
  //    2" bleed (deterministic sharp exporter, no AI), saved to storage + the job.
  const exportPrintReadyPanels = async () => {
    const ready = items.filter((i) => i.status === "done" && (i.printUrl || i.flatUrl));
    if (ready.length === 0) { toast.error("Flatten the panels first."); return; }
    setExportingPrint(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in first.");
      const files: any[] = [];
      for (const it of ready) {
        try {
          // Print base = highest-res clean panel (8× upscaled, de-branded) when
          // the complex step ran, else the upscaled/flat panel. Lifted layers
          // ship alongside as transparent PNGs (Artboard-First: clean base +
          // editable overlays), recorded below.
          const baseUrl = it.upscaledUrl || it.cleanUrl || it.printUrl || it.flatUrl;
          const res = await fetch("/api/export-flat-panel", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              image_url: baseUrl,
              width_inches: it.widthInches,
              height_inches: it.heightInches,
              bleed_inches: 2,                 // 2" bleed on all sides
              dpi: 150,
              view_name: it.sideKey,
              order_number: orderNumber,
              user_id: userId || undefined,
              fit_mode: "cover",
              format: "png",
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.success) { toast.error(`${it.label}: ${data?.error || `export ${res.status}`}`); continue; }
          setPrintReady((p) => ({ ...p, [it.key]: data.url }));
          files.push({
            side: it.sideKey, label: it.label, url: data.url,
            widthInches: it.widthInches, heightInches: it.heightInches,
            bleedInches: 2, dpi: data.effective_dpi || 150,
            pixel_width: data.pixel_width, pixel_height: data.pixel_height,
            base_kind: it.upscaledUrl ? "upscaled_clean" : it.cleanUrl ? "clean" : "flat",
            clean_url: it.cleanUrl || null,
            upscaled_url: it.upscaledUrl || null,
            lifted_layers: it.liftedLayers || [],
          });
        } catch (e: any) {
          toast.error(`${it.label}: ${e?.message || e}`);
        }
      }
      // Persist the print-ready (2" bleed) panel files on the job.
      if (jobId && files.length) {
        try {
          const { data: jobRow } = await supabase
            .from("panelizer_jobs" as any).select("concept_json").eq("id", jobId).maybeSingle();
          const cj = (jobRow as any)?.concept_json || {};
          await supabase.from("panelizer_jobs" as any).update({
            concept_json: { ...cj, r4_print_panels: files, r4_print_bleed_inches: 2, r4_print_at: new Date().toISOString() },
          }).eq("id", jobId);
        } catch { /* non-fatal — files are already in storage */ }
      }
      if (files.length) {
        toast.success(`Exported ${files.length} print-ready panel${files.length === 1 ? "" : "s"} @ 2" bleed`);
        onArtboardSaved?.("print-panels");
      }
    } catch (e: any) {
      toast.error(e?.message || "Print export failed");
    } finally {
      setExportingPrint(false);
    }
  };

  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) cancelled.current = true; onOpenChange(v); }}>
      <DialogContent className="max-w-5xl max-h-[94vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-cyan-500" />
            2D Proof → Artboard (R4)
          </DialogTitle>
        </DialogHeader>

        {/* Source proof */}
        <div className="space-y-2">
          <Label className="text-xs">2D Proof URL</Label>
          <Input
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            placeholder="Paste the approved 2D proof URL"
            className="h-9 text-xs"
          />
          {proof ? (
            <img src={proof} alt="2D proof" className="w-full max-h-56 object-contain rounded border border-border bg-black/5" />
          ) : (
            <p className="text-xs text-muted-foreground">No 2D proof on this job yet — generate one first, or paste a URL.</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 border-y border-border py-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Finish</span>
            <Select value={finishSel} onValueChange={setFinishSel}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{FINISHES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
            title="Lift logos/text (and big graphic/focal elements on restyle jobs) off each side as transparent PNGs with our internal precise-erase tool, then Real-ESRGAN 8× upscale the clean base to the highest resolution.">
            <input type="checkbox" checked={autoFinish} onChange={(e) => setAutoFinish(e.target.checked)} />
            <Wand2 className="w-3.5 h-3.5 text-fuchsia-500" />
            Auto-lift elements → transparent PNG + 8× upscale {isRestyle ? "(restyle: incl. graphics)" : ""}
          </label>
          <Button
            size="sm"
            className="gap-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white ml-auto"
            onClick={() => runFlatten()}
            disabled={running || composing || !proof || items.length === 0}
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {running ? `Processing ${doneCount}/${items.length}…` : "Generate panels from 2D proof"}
          </Button>
        </div>

        {/* Panel grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((it) => (
            <div key={it.key} className="border border-border rounded-lg p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{it.label}</span>
                {it.status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                {it.status === "working" && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />}
                {it.status === "error" && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
              </div>
              <p className="text-[10px] text-muted-foreground">{it.widthInches}" × {it.heightInches}"</p>
              {it.status === "working" && it.subStatus && (
                <p className="text-[10px] font-medium text-cyan-600 capitalize">
                  {it.subStatus === "flattening" ? "Flattening from proof…"
                    : it.subStatus === "lifting" ? "Lifting elements → transparent PNG…"
                    : "8× upscaling clean base…"}
                </p>
              )}
              <div className="aspect-video rounded bg-black/5 overflow-hidden flex items-center justify-center">
                {it.flatUrl
                  ? <img src={it.flatUrl} alt={it.label} className="w-full h-full object-contain" />
                  : <span className="text-[10px] text-muted-foreground">{it.status === "error" ? "failed" : "—"}</span>}
              </div>
              {it.error && <p className="text-[10px] text-red-500 line-clamp-2">{it.error}</p>}
              {it.status === "done" && (
                <div className="flex flex-wrap gap-1">
                  {it.upscaledUrl && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">8× upscaled</span>
                  )}
                  {it.liftedLayers && it.liftedLayers.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 font-semibold inline-flex items-center gap-0.5">
                      <Layers className="w-2.5 h-2.5" /> {it.liftedLayers.length} lifted
                    </span>
                  )}
                </div>
              )}
              {it.liftedLayers && it.liftedLayers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {it.liftedLayers.map((l, li) => (
                    <button
                      key={li}
                      type="button"
                      title={`${l.type}: ${l.label} — click to download transparent PNG`}
                      onClick={() => blobDownload(l.url, `${(orderNumber || "panel")}_${it.sideKey}_layer-${li + 1}.png`)}
                      className="w-9 h-9 rounded border border-border bg-[repeating-conic-gradient(#ddd_0_25%,#fff_0_50%)] bg-[length:8px_8px] overflow-hidden"
                    >
                      <img src={l.url} alt={l.label} className="w-full h-full object-contain" />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 flex-1 text-[10px] gap-1"
                  onClick={() => runFlatten(it.key)} disabled={running || composing}>
                  <RefreshCw className="w-3 h-3" /> {it.status === "done" ? "Redo" : "Run"}
                </Button>
                {it.printUrl && (
                  <Button size="sm" variant="outline" className="h-7 flex-1 text-[10px] gap-1"
                    onClick={() => blobDownload(it.printUrl!, `${(orderNumber || "panel")}_${it.sideKey}.png`)}>
                    <Download className="w-3 h-3" /> File
                  </Button>
                )}
                {printReady[it.key] && (
                  <Button size="sm" variant="outline" className="h-7 flex-1 text-[10px] gap-1 border-fuchsia-300 text-fuchsia-700"
                    onClick={() => blobDownload(printReady[it.key], `${(orderNumber || "panel")}_${it.sideKey}_2in-bleed.png`)}>
                    <Download className="w-3 h-3" /> Print 2&quot;
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Compose + result */}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="gap-1.5"
            onClick={composeArtboard} disabled={!anyDone || composing || running}>
            {composing ? <Loader2 className="w-4 h-4 animate-spin" /> : <LayoutGrid className="w-4 h-4" />}
            Compose artboard
          </Button>
          {artboardPreview && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => artboardBlob && blobDownload(URL.createObjectURL(artboardBlob), `${orderNumber || "artboard"}_artboard.png`)}>
                <Download className="w-4 h-4" /> Download artboard
              </Button>
              <Button size="sm" className="gap-1.5 bg-emerald-600 text-white"
                onClick={saveAsArtboard} disabled={saving || !jobId}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save as job artboard
              </Button>
            </>
          )}
          <Button size="sm" className="gap-1.5 bg-fuchsia-600 text-white"
            onClick={exportPrintReadyPanels} disabled={!anyDone || exportingPrint || running || composing}>
            {exportingPrint ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export print files (2&quot; bleed)
          </Button>
        </div>

        {artboardPreview && (
          <img src={artboardPreview} alt="Composed artboard" className="w-full rounded border border-border" />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default TwoDProofArtboard;
