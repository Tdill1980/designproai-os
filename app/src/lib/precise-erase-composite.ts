/**
 * LayerLift compositor — client-side image operations for the LayerLift tool.
 *
 * LayerLift is a single user gesture (drag a glassmorphism box, or click for
 * SAM2) that fires TWO engines in parallel:
 *
 *   ENGINE 1 — THE LIFT (this file, client-only, deterministic):
 *     extractTransparentSlice(): mathematically copies the bbox pixels from
 *     the source render into a new transparent PNG. No AI, no hallucination,
 *     no token cost. Result is uploaded to wrap-files as an asset layer and
 *     spawned as a draggable layer on the canvas immediately.
 *
 *   ENGINE 2 — THE PATCH (this file + precise-erase edge fn, Gemini-backed):
 *     composeEraseMarker() paints a magenta semi-transparent overlay over
 *     the same bbox. The resulting composite is uploaded and sent to the
 *     precise-erase edge function, which prompts Gemini-3-pro-image-preview
 *     with a strict material-extension system prompt: "remove the magenta
 *     marker, continue the surrounding wrap material across that area".
 *     Gemini behaves as a clone-stamp rather than a creative artist.
 *
 * End result: the user drags one box and gets BOTH a draggable extracted
 * element AND a clean, healed background in one fluid motion.
 *
 * Why magenta as the marker: it's not a natural vehicle wrap color, so
 * Gemini won't confuse it with intended design content; the model reliably
 * treats it as a region to erase. This is the proven pattern from the
 * existing logo-placement mode in revise-render.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  keyBackgroundFromBorder,
  measureAlphaQuality,
  type AlphaQuality,
} from "@/lib/cut-to-shape";

const MARKER_RGBA = "rgba(255, 0, 200, 0.45)"; // semi-transparent magenta fill
const MARKER_STROKE = "rgba(255, 0, 200, 0.95)"; // saturated magenta outline
const MARKER_STROKE_WIDTH_PX = 6;

/** Bounding box in normalized image coordinates (0..1). */
export interface NormalizedBox {
  xPct: number; // left edge
  yPct: number; // top edge
  wPct: number; // width
  hPct: number; // height
}

async function urlToImageBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

/**
 * Paint a magenta semi-transparent rectangle over the bounding box on a
 * source render and return a PNG blob ready for upload. The canvas is
 * sized to the render's native pixel dimensions so coordinates land
 * exactly where the user drew them.
 */
export async function composeEraseMarker(
  renderUrl: string,
  box: NormalizedBox,
): Promise<Blob> {
  const bmp = await urlToImageBitmap(renderUrl);

  // Downscale the composite to a Gemini-friendly size before marking. A full
  // 4K input is a common cause of precise-erase returning NO_IMAGE (Gemini
  // declines the edit), which made the heal silently fail and leave the
  // original background in place. The healed output is still regenerated at
  // 4K/2K by the edge fn's imageConfig, so display quality is unaffected.
  const MAX_SIDE = 1600;
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const x = Math.round(box.xPct * w);
  const y = Math.round(box.yPct * h);
  const bw = Math.round(box.wPct * w);
  const bh = Math.round(box.hPct * h);

  ctx.fillStyle = MARKER_RGBA;
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = MARKER_STROKE;
  ctx.lineWidth = MARKER_STROKE_WIDTH_PX;
  ctx.strokeRect(
    x + MARKER_STROKE_WIDTH_PX / 2,
    y + MARKER_STROKE_WIDTH_PX / 2,
    Math.max(0, bw - MARKER_STROKE_WIDTH_PX),
    Math.max(0, bh - MARKER_STROKE_WIDTH_PX),
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
      0.92,
    );
  });
}

/**
 * Paint a magenta semi-transparent overlay following an arbitrary alpha mask
 * (e.g. a SAM2 mask URL). Useful when the user clicked a single point and
 * we want to preserve the precise pixel boundary instead of a coarse bbox.
 *
 * The mask is expected to be a PNG where white (or non-transparent) = the
 * region to mark, black/transparent = preserve. Mask is resampled to fit
 * the source render canvas.
 */
export async function composeEraseMarkerFromMask(
  renderUrl: string,
  maskUrl: string,
): Promise<Blob> {
  const [renderBmp, maskBmp] = await Promise.all([
    urlToImageBitmap(renderUrl),
    urlToImageBitmap(maskUrl),
  ]);
  const w = renderBmp.width;
  const h = renderBmp.height;

  // Base canvas with the source render
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(renderBmp, 0, 0, w, h);
  renderBmp.close?.();

  // Off-screen canvas to colorize the mask as magenta
  const masked = document.createElement("canvas");
  masked.width = w;
  masked.height = h;
  const mctx = masked.getContext("2d")!;
  mctx.drawImage(maskBmp, 0, 0, w, h);
  // Replace white mask pixels with magenta using composite-in
  mctx.globalCompositeOperation = "source-in";
  mctx.fillStyle = "rgba(255, 0, 200, 0.55)";
  mctx.fillRect(0, 0, w, h);
  maskBmp.close?.();

  ctx.drawImage(masked, 0, 0);

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
      0.92,
    );
  });
}

/** Upload a composited (marker-overlayed) PNG to wrap-files Storage. */
export async function uploadEraseComposite(
  blob: Blob,
  userId: string,
): Promise<string> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `renders/${userId}/precise-erase-input/${ts}-${rand}.png`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Composite upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Blend-back: keep ONLY the boxed region from Gemini's healed output and
 * paste it onto the pristine original. Everything outside the box stays
 * pixel-identical to the original.
 *
 * Why this is required: precise-erase asks Gemini to regenerate the whole
 * 16:9 frame and trusts the prompt ("keep everything outside the marker
 * bit-identical") to preserve the rest. Image-generation models cannot
 * honor that — a full regeneration reconstructs the entire scene and
 * routinely wipes or alters the surrounding wrap design. Compositing the
 * heal back into the original only inside the selection makes the edit
 * truly local: the logo/text inside the box is removed and the wrap is
 * continued there, while the rest of the design is guaranteed untouched.
 *
 * A small feather (default 12px) is applied at the region edges so the
 * seam blends into the surrounding wrap material (which the operator's box
 * always overlaps, since they draw slightly larger than the element).
 */
export async function compositeHealedRegion(
  originalUrl: string,
  healedUrl: string,
  box: NormalizedBox,
  featherPx = 12,
): Promise<Blob> {
  const [orig, heal] = await Promise.all([
    urlToImageBitmap(originalUrl),
    urlToImageBitmap(healedUrl),
  ]);

  const W = orig.width;
  const H = orig.height;

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d")!;
  octx.drawImage(orig, 0, 0, W, H);
  orig.close?.();

  // Region in original pixels
  const rx = Math.round(box.xPct * W);
  const ry = Math.round(box.yPct * H);
  const rw = Math.max(1, Math.round(box.wPct * W));
  const rh = Math.max(1, Math.round(box.hPct * H));

  // Same region in the healed image's pixel space (healed may be a
  // different resolution — e.g. 4K — but it's the same 16:9 framing, so
  // normalized coords map 1:1).
  const hx = box.xPct * heal.width;
  const hy = box.yPct * heal.height;
  const hw = box.wPct * heal.width;
  const hh = box.hPct * heal.height;

  // Crop the healed region into a box-sized canvas at the original's
  // resolution for that region.
  const boxC = document.createElement("canvas");
  boxC.width = rw;
  boxC.height = rh;
  const bctx = boxC.getContext("2d")!;
  bctx.drawImage(heal, hx, hy, hw, hh, 0, 0, rw, rh);
  heal.close?.();

  // Feather the edges: a blurred white rect inset by featherPx, used as a
  // destination-in mask, fades the healed crop's border to transparent so
  // the paste blends into the original wrap instead of leaving a hard seam.
  const feather = Math.min(featherPx, Math.floor(Math.min(rw, rh) / 2) - 1);
  if (feather > 0) {
    bctx.globalCompositeOperation = "destination-in";
    bctx.filter = `blur(${feather}px)`;
    bctx.fillStyle = "#fff";
    bctx.fillRect(feather, feather, rw - feather * 2, rh - feather * 2);
    bctx.filter = "none";
    bctx.globalCompositeOperation = "source-over";
  }

  octx.drawImage(boxC, rx, ry);

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
      0.95,
    );
  });
}

/** Upload the blended (heal-composited-into-original) PNG to wrap-files. */
export async function uploadHealedComposite(
  blob: Blob,
  userId: string,
): Promise<string> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `renders/${userId}/precise-erase-healed/${ts}-${rand}.png`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Healed composite upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
  return urlData.publicUrl;
}

// ---------------------------------------------------------------------------
// ENGINE 1 — THE LIFT (pure client-side pixel slice)
// ---------------------------------------------------------------------------

/**
 * Sample the corner pixels of a slice (which sit on the surrounding wrap
 * material because the user always draws the bbox slightly larger than the
 * element they want to lift) and return the median wrap color in RGB.
 *
 * Using the median across 8 perimeter samples instead of one corner makes
 * the key robust to gradients, reflections, and lens grain.
 */
function sampleWrapColor(imageData: ImageData): { r: number; g: number; b: number } {
  const { data, width, height } = imageData;
  const samples: Array<[number, number, number]> = [];
  const points: Array<[number, number]> = [
    [1, 1],
    [Math.floor(width / 2), 1],
    [width - 2, 1],
    [1, Math.floor(height / 2)],
    [width - 2, Math.floor(height / 2)],
    [1, height - 2],
    [Math.floor(width / 2), height - 2],
    [width - 2, height - 2],
  ];
  for (const [x, y] of points) {
    const idx = (y * width + x) * 4;
    samples.push([data[idx], data[idx + 1], data[idx + 2]]);
  }
  // Median per channel
  const sorted = (i: number) => [...samples].sort((a, b) => a[i] - b[i]);
  const med = (i: number) => sorted(i)[Math.floor(samples.length / 2)][i];
  return { r: med(0), g: med(1), b: med(2) };
}

/**
 * Knock alpha to 0 on every pixel within Euclidean color distance `tolerance`
 * of the wrap color, then feather the resulting alpha edge by 1px so the
 * cutout doesn't look stamped on.
 *
 * Tolerance ~25 (out of 255) works for typical "logo on flat gloss/matte
 * panel" — black logos on near-black wrap is the edge case where the user
 * should manually retry with a tighter box.
 */
function alphaKeyByWrapColor(
  imageData: ImageData,
  wrap: { r: number; g: number; b: number },
  tolerance = 28,
): ImageData {
  const out = new ImageData(imageData.width, imageData.height);
  const src = imageData.data;
  const dst = out.data;
  const tol2 = tolerance * tolerance;
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    const dr = r - wrap.r;
    const dg = g - wrap.g;
    const db = b - wrap.b;
    const d2 = dr * dr + dg * dg + db * db;
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    if (d2 < tol2) {
      // Full transparency for definite wrap-color pixels
      dst[i + 3] = 0;
    } else if (d2 < tol2 * 2) {
      // Soft feather band for near-matches so the edge isn't aliased
      const t = (d2 - tol2) / tol2;
      dst[i + 3] = Math.round(src[i + 3] * Math.min(1, t));
    } else {
      dst[i + 3] = src[i + 3];
    }
  }
  return out;
}

/**
 * Copy the exact pixels inside the bbox out of the source render and return
 * an alpha-cleaned transparent PNG. No AI, no model calls, no token cost.
 *
 * Pipeline:
 *   1. Crop bbox into an offscreen canvas
 *   2. Read pixels, sample corner perimeter for the wrap color
 *   3. Alpha-key every pixel within tolerance of that color → transparent
 *   4. Re-encode as PNG
 *
 * The returned blob is ready to use as a draggable layer with a real
 * transparent background — no wrap pixels bleeding around the edges.
 */
export async function extractTransparentSlice(
  renderUrl: string,
  box: NormalizedBox,
  options?: { alphaTolerance?: number; alphaClean?: boolean },
): Promise<{
  blob: Blob;
  widthPx: number;
  heightPx: number;
  /** Measured alpha distribution — null when the alpha key was skipped/failed.
   *  Callers gate on `isCutToShape(cutQuality)` so a ghosted rectangle is an
   *  honest gap instead of an unusable Logo Pack asset. */
  cutQuality: AlphaQuality | null;
}> {
  const bmp = await urlToImageBitmap(renderUrl);
  const sw = Math.max(1, Math.round(box.wPct * bmp.width));
  const sh = Math.max(1, Math.round(box.hPct * bmp.height));
  const sx = Math.round(box.xPct * bmp.width);
  const sy = Math.round(box.yPct * bmp.height);

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close?.();

  const alphaClean = options?.alphaClean !== false; // default ON
  let cutQuality: AlphaQuality | null = null;
  if (alphaClean) {
    try {
      const imageData = ctx.getImageData(0, 0, sw, sh);
      // BORDER FLOOD FILL, not a global median-colour match. The old key picked
      // ONE median perimeter colour and knocked out pixels within tolerance of
      // it; on the layered gradients every DesignPro wrap has, the far side of
      // the background sat outside that tolerance and stayed fully opaque — so
      // the "cut" kept a slab of wrap around the logo and plotted as a ghosted
      // rectangle. Filling inward from the border compares each step to its own
      // neighbour, so it tracks a gradient across the whole slice and still
      // stops dead at the logo's edge. See src/lib/cut-to-shape.ts.
      const keyed = keyBackgroundFromBorder(imageData, {
        tolerance: options?.alphaTolerance ?? 28,
      });
      cutQuality = measureAlphaQuality(keyed);
      const out = new ImageData(
        new Uint8ClampedArray(keyed.data),
        keyed.width,
        keyed.height,
      );
      ctx.clearRect(0, 0, sw, sh);
      ctx.putImageData(out, 0, 0);
    } catch (e) {
      // CORS-tainted canvas or tiny slice — fall back to raw crop without alpha key.
      console.warn("[LayerLift] alpha-key failed, returning raw slice:", (e as Error).message);
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/png",
      0.95,
    );
  });
  return { blob, widthPx: sw, heightPx: sh, cutQuality };
}

/** Upload a lifted asset (transparent PNG) to extracted-elements bucket. */
export async function uploadLiftedAsset(
  blob: Blob,
  userId: string,
): Promise<string> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${userId}/${ts}-${rand}.png`;
  // Use the extracted-elements bucket where the existing wand pipeline saves
  // assets, so LayerStrip and downstream QC artboard see them automatically.
  const { error } = await supabase.storage
    .from("extracted-elements")
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) {
    // Fallback to wrap-files if the dedicated bucket isn't provisioned in
    // this environment (e.g. local dev), so the lift still functions.
    const fbPath = `renders/${userId}/lifted-layers/${ts}-${rand}.png`;
    const fb = await supabase.storage
      .from("wrap-files")
      .upload(fbPath, blob, { contentType: "image/png", upsert: false });
    if (fb.error) throw new Error(`Lifted asset upload failed: ${fb.error.message}`);
    const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(fbPath);
    return urlData.publicUrl;
  }
  const { data: urlData } = supabase.storage.from("extracted-elements").getPublicUrl(path);
  return urlData.publicUrl;
}

// ---------------------------------------------------------------------------
// LayerLift orchestrator — fires Engine 1 + Engine 2 in parallel
// ---------------------------------------------------------------------------

export interface LayerLiftResult {
  /** Transparent PNG URL of the lifted element (Engine 1). */
  liftedAssetUrl: string;
  /** Original bbox in normalized coords (for the LogoLayer.origin field). */
  origin: NormalizedBox;
  /** Healed background URL with the region inpainted (Engine 2). */
  healedBackgroundUrl: string;
  /** True when Engine 2 refunded the user's token (Gemini failed). */
  refunded?: boolean;
}

export interface LayerLiftOpts {
  renderUrl: string;
  box: NormalizedBox;
  userId: string;
  /** Render context for the precise-erase prompt builder */
  finish?: string | null;
  colorName?: string | null;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  /** Optional user description ("the white stripes on the hood") woven into the Gemini prompt */
  userNote?: string;
  /** "remove" (default) | "replace" | "color-change" */
  intent?: "remove" | "replace" | "color-change";
  targetColor?: string;
  /** Tool that originated the lift, used for storage path */
  toolType?: string;
}

/**
 * Run both engines in parallel from a single bbox selection.
 *
 * Engine 1 (lift) is local — its failure is fatal and propagates. Engine 2
 * (precise-erase Gemini call) is flaky; when it fails we still surface the
 * lifted asset so the user's single-drag gesture isn't wasted. The thrown
 * error carries `partial: true` + `liftedAssetUrl` + `origin` so the caller
 * can keep the lift and skip the background heal.
 */
export async function runLayerLift(opts: LayerLiftOpts): Promise<LayerLiftResult> {
  const { renderUrl, box, userId, toolType = "revision" } = opts;

  const liftPromise = (async () => {
    const { blob } = await extractTransparentSlice(renderUrl, box);
    const url = await uploadLiftedAsset(blob, userId);
    return url;
  })();

  const patchPromise = (async () => {
    // NO HEAL. THE CLEAN BASE IS AUTHORED, NOT REPAIRED.
    //
    // This asked an in-house heal service to reconstruct the hole the lifted
    // element left and composite it back onto the original render. Every
    // generative heal this product has shipped left a permanent smear, which is
    // why the clean base has been an AUTHORED asset ever since -- and under
    // A.T.L.A.S. it is authored twice over: Call 11 publishes the de-logoed
    // duplicate of each panel, cut from the accepted master, hashed and bound
    // to it.
    //
    // Repainting a proof in the browser could not improve on that. It could
    // only produce an unverified image that disagrees with the master the
    // panels print from. So the lift still happens -- that is the useful half,
    // and it is pure pixel work -- and the caller is told there is no healed
    // background to pair with it.
    throw new Error(
      "There is no browser-side background heal. The clean, logo-free base is the de-logoed panel the server publishes for this surface.",
    );
  })();

  // allSettled — Engine 2 failure must NOT discard Engine 1's lifted asset.
  // The original implementation used Promise.all and lost the lift whenever
  // Gemini hiccuped, which is exactly the "edge fail / nothing works" UX.
  const [liftRes, patchRes] = await Promise.allSettled([liftPromise, patchPromise]);

  if (liftRes.status === "rejected") {
    const reason = liftRes.reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  if (patchRes.status === "rejected") {
    const reason = patchRes.reason as any;
    throw Object.assign(new Error(reason?.message || String(reason)), {
      refunded: !!reason?.refunded,
      partial: true,
      liftedAssetUrl: liftRes.value,
      origin: box,
    });
  }

  // Prefer ClipDrop's TRUE transparent cutout as the saved lifted PNG; fall back
  // to Engine 1's instant rectangular slice if ClipDrop didn't return one.
  const liftedAssetUrl = patchRes.value.transparentUrl || liftRes.value;
  return { liftedAssetUrl, origin: box, healedBackgroundUrl: patchRes.value.healedUrl };
}

/**
 * Detect whether a user-typed prompt is a removal request. The Magic Erase
 * mode auto-fires for removals; non-removals go through the standard
 * (Flux Fill, wrap-aware prompt) path.
 */
export function isRemovalIntent(prompt: string): boolean {
  const lower = (prompt || "").toLowerCase();
  return (
    /\b(remove|delete|erase|strip|clean off|take off|get rid of|no more|hide)\b/.test(lower) ||
    /\bno (stripes?|logos?|graphics?|text|decals?|patterns?)\b/.test(lower) ||
    /\bclean (it |the |this )?(up|out|panel)?\b/.test(lower)
  );
}

/**
 * Detect color-change intent like "change to red", "make it matte black".
 * Returns the captured color phrase or null.
 */
export function detectColorChange(prompt: string): string | null {
  const lower = (prompt || "").toLowerCase();
  const m =
    lower.match(/(?:change|make|turn|switch|paint|wrap)(?:\s+(?:it|this|the))?(?:\s+\w+)?\s+(?:to|into)\s+([a-z][a-z\s]{1,30}?)(?:[.,!?]|$)/) ||
    lower.match(/(?:change|make|turn|switch|paint|wrap)\s+(?:it|this)\s+([a-z][a-z\s]{1,30}?)(?:[.,!?]|$)/);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Vectorize — produce an SVG from a layer's transparent PNG
// ---------------------------------------------------------------------------

/**
 * Run a transparent-PNG layer through the working Vercel /api/vectorize-it
 * route (VTracer on Node, 1024MB Pro memory). The Supabase edge fn of the
 * same name proxies a dead droplet and never worked — we go straight to
 * Vercel here, which is same-origin from the SPA and needs no auth header.
 *
 * Trace presets — "logo" is best for the typical LayerLift case (extracted
 * graphic on transparent bg). "detailed" works too but produces more paths
 * which adds plotter cut time downstream.
 *
 * Returns the public URL of the saved SVG (stored in wrap-files bucket
 * under file-services/<userId>/<ts>/vectorized.svg per the Vercel route).
 */
export async function vectorizeLayer(opts: {
  fileUrl: string;
  fileName?: string;
  userId: string;
  traceMode?: "logo" | "detailed" | "silhouette" | "centerline";
  smoothing?: number;
  /** VTracer min_area — drops paths smaller than this many pixels. Higher
   *  values strip plotter-unfriendly noise. Default 4 (Print & Cut);
   *  bump to ~16 for Manufacture Film Cut. */
  minArea?: number;
}): Promise<{ svgUrl: string; pathCount?: number; colorLayers?: number }> {
  const resp = await fetch("/api/vectorize-it", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: opts.userId,
      file_url: opts.fileUrl,
      file_name: opts.fileName || "layer.png",
      trace_mode: opts.traceMode || "logo",
      smoothing: opts.smoothing ?? 1.0,
      min_area: opts.minArea ?? 4,
    }),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      detail = body?.error || body?.message || detail;
    } catch { /* ignore */ }
    throw new Error(`Vectorize failed: ${detail}`);
  }
  const data = await resp.json();
  // /api/vectorize-it returns { success, output_url, file_url, vector_stats, ... }
  const svgUrl: string | undefined =
    data?.output_url || data?.file_url || data?.svg_url || data?.url;
  if (!data?.success || !svgUrl) {
    throw new Error(data?.error || "Vectorize returned no SVG URL");
  }
  return {
    svgUrl,
    pathCount: data?.vector_stats?.path_count ?? data?.metrics?.path_count,
    colorLayers: data?.vector_stats?.color_layers ?? data?.metrics?.color_layers,
  };
}
