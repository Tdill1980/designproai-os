// deploy: panel-pro-extract — structural single extract (no forced aspect ratio) + 2" bleed
/**
 * panel-pro-extract — Panel Pro Extractor (deterministic structural 1:1)
 *
 * Takes a 3D vehicle wrap proof and produces ONE flat, head-on rectangular
 * print panel. There is NO slicing and no GENIE few-shot step — the per-side
 * extract is direct.
 *
 * The active path is mode "single": resolve the TRUE per-side print size
 * (vehicle_dimensions DB → CSV → GENIE standard — the SAME source the 2D proof
 * stamps) and inject the resolved Height×Width into the STRUCTURAL prompt at
 * temperature 0. The canvas aspectRatio is NOT forced — forcing it makes Gemini
 * regenerate to that shape and STRETCH the artwork (the F150-flag distortion).
 * The resolved ratio is returned only as a verification stat. Mode "bleed" then
 * adds the deterministic 2" exterior bleed (no AI).
 *
 * NOTE: the AI flatten is a stopgap, not the target. The real 1:1 path is
 * flat-first authoring + the geometric gridslice (panel-artboard-generator
 * step:"gridslice") — there is nothing to un-warp when the design is authored flat.
 *
 * POST /panel-pro-extract
 * {
 *   mode: "single" | "bleed",
 *   imageUrl: string,        // the 3D proof (render) to extract from   [required]
 *   widthInches?: number,    // override the resolved per-side width
 *   heightInches?: number,   // override the resolved per-side height
 *   view? / sideKey? / sideSize? / vehicleMake? / vehicleModel? / vehicleDims?,
 *   label?: string,          // panel label, e.g. "Driver Side"
 *   userId?: string,
 *   jobId?: string,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey, geminiKeyCount } from "../_shared/gemini-key-pool.ts";
import {
  uploadToStorage,
  getSignedUrl,
  getPublicUrl,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  toSupportedRatio,
  GEMINI_IMAGE_MODEL,
  SIDE_PANELS,
  ADDON_PANELS,
  ROOF_PANELS,
  lookupVehicle,
} from "../_shared/panelizer-os/constants.ts";

const MAX_FETCH_WIDTH = 4096; // full-res input so Gemini sees the real design detail (was 2048 — too soft for print; the source render is ~5504px)

/**
 * Resolve the panel size (inches) for a view/side.
 *
 * Priority:
 *   1. vehicleDims — dimensions already resolved by the GENIE Panelizer
 *      (panelizer-step-validate): the 1,600-row Supabase vehicle_dimensions
 *      table → CSV → trailer → Google Search grounding. The real print size
 *      for THIS vehicle, and the SAME source the 2D proof stamps.
 *   2. lookupVehicle(make, model) — embedded CSV only (no Google grounding).
 *   3. GENIE Universal Panelizer standard panel sizes.
 * (Explicit widthInches/heightInches in the request override all.)
 */
function dimsForView(key: string, v: any): { widthInches: number; heightInches: number } {
  if (key.includes("passenger") || key.includes("driver") || key === "side" || key.includes("left") || key.includes("right"))
    return { widthInches: v.bodyLengthInches, heightInches: v.bodyHeightInches };
  if (key.includes("hood")) return { widthInches: v.hoodWidthInches, heightInches: v.hoodLengthInches };
  if (key.includes("roof") || key.includes("top")) return { widthInches: v.roofWidthInches, heightInches: v.roofLengthInches };
  if (key.includes("rear") || key.includes("back")) return { widthInches: v.backWidthInches, heightInches: v.backHeightInches };
  if (key.includes("front")) return { widthInches: v.hoodWidthInches, heightInches: v.hoodLengthInches };
  return { widthInches: v.bodyLengthInches, heightInches: v.bodyHeightInches };
}

function resolvePanelSize(opts: {
  view?: string;
  sideKey?: string;
  sideSize?: string;
  roofSize?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleDims?: any;
}): { widthInches: number; heightInches: number; source: string } {
  const key = (opts.sideKey || opts.view || "").toLowerCase();

  // ── 1. GENIE-resolved dimensions (1,600-row DB + Google grounding) ──
  if (opts.vehicleDims && Number(opts.vehicleDims.bodyLengthInches) > 0) {
    const d = dimsForView(key, opts.vehicleDims);
    return { ...d, source: `genie:${opts.vehicleDims.source || "validate"}` };
  }

  // ── 2. Embedded CSV lookup (no Google fallback) ──
  if (opts.vehicleMake && opts.vehicleModel) {
    const v = lookupVehicle(opts.vehicleMake, opts.vehicleModel);
    const d = dimsForView(key, v);
    return { ...d, source: `csv:${v.source}` };
  }

  // ── 3. GENIE standard panels (fallback) ──
  const sideSize = opts.sideSize || "medium";
  const roofSize = opts.roofSize || "medium";
  const pick = (p: { widthInches: number; heightInches: number }) => ({
    widthInches: p.widthInches, heightInches: p.heightInches, source: "genie-standard",
  });
  if (key.includes("passenger") || key.includes("driver") || key === "side" || key.includes("left") || key.includes("right")) {
    return pick(SIDE_PANELS[sideSize] || SIDE_PANELS.medium);
  }
  if (key.includes("hood")) return pick(ADDON_PANELS.hood);
  if (key.includes("roof") || key.includes("top")) return pick(ROOF_PANELS[roofSize] || ROOF_PANELS.medium);
  if (key.includes("rear") || key.includes("back")) return pick(ADDON_PANELS.rear);
  if (key.includes("front")) return pick(ADDON_PANELS.frontBumper);
  return pick(SIDE_PANELS.medium);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Auto-crop to the wrapped DESIGN region.
 *
 * Studio renders put the vehicle in a big gray room with a reflective floor.
 * Feeding that whole scene to Gemini makes it isolate + de-warp + flatten all at
 * once, so it gives up and draws a generic version of the design. By hand in
 * Gemini Studio the fix was a TIGHT crop of just the wrapped body — that's what
 * this does automatically.
 *
 * The wrap artwork is vividly colored (saturated reds/blues/etc.) while the studio
 * is near-neutral gray. We find the bounding box of strongly-saturated pixels and
 * crop to it (plus a margin). That naturally drops the floor, walls, glass and
 * wheels and leaves the painted body the model should reproduce.
 */
async function cropToDesign(imageBytes: Uint8Array): Promise<{ boxed: Uint8Array; w: number; h: number }> {
  const img = await Image.decode(imageBytes);
  const W = img.width, H = img.height;

  let minX = W, minY = H, maxX = 0, maxY = 0, hits = 0;
  const step = Math.max(1, Math.round(Math.min(W, H) / 500)); // subsample for speed
  for (let y = 1; y <= H; y += step) {
    for (let x = 1; x <= W; x += step) {
      const px = img.getPixelAt(x, y);
      const r = (px >> 24) & 0xff, g = (px >> 16) & 0xff, b = (px >> 8) & 0xff;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      // Saturated AND bright enough to be wrap artwork, not gray studio/shadow.
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat > 0.45 && max > 70) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        hits++;
      }
    }
  }

  // If we didn't find a clear colored region, fall back to the full frame.
  if (hits < 30 || maxX <= minX || maxY <= minY) {
    const encoded = new Uint8Array(await img.encode());
    return { boxed: encoded, w: W, h: H };
  }

  // Margin so we don't shave the edge of the artwork.
  const mx = Math.round(W * 0.04), my = Math.round(H * 0.04);
  const x0 = Math.max(0, minX - mx);
  const y0 = Math.max(0, minY - my);
  const x1 = Math.min(W, maxX + mx);
  const y1 = Math.min(H, maxY + my);
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);

  const cropped = img.clone().crop(x0, y0, cw, ch);
  console.log(`[PANEL-PRO-EXTRACT] cropToDesign: ${W}×${H} -> ${cw}×${ch} @(${x0},${y0}) hits=${hits}`);
  const encoded = new Uint8Array(await cropped.encode());
  return { boxed: encoded, w: cw, h: ch };
}

// flipH / flipV — in-place mirrors used to build the true mirror-bleed border.
function flipH(im: any): void {
  const w = im.width, h = im.height, bmp = im.bitmap;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < (w >> 1); x++) {
      const i = row + x * 4, j = row + (w - 1 - x) * 4;
      for (let k = 0; k < 4; k++) { const t = bmp[i + k]; bmp[i + k] = bmp[j + k]; bmp[j + k] = t; }
    }
  }
}
function flipV(im: any): void {
  const w = im.width, h = im.height, bmp = im.bitmap, rb = w * 4;
  const tmp = new Uint8Array(rb);
  for (let y = 0; y < (h >> 1); y++) {
    const top = y * rb, bot = (h - 1 - y) * rb;
    tmp.set(bmp.subarray(top, top + rb));
    bmp.copyWithin(top, bot, bot + rb);
    bmp.set(tmp, bot);
  }
}

/** Draw a bright box (rectangle outline) around the design, inset from the edges. */
async function drawBox(imageBytes: Uint8Array): Promise<{ boxed: Uint8Array; w: number; h: number }> {
  const img = await Image.decode(imageBytes);
  const w = img.width;
  const h = img.height;

  // Box hugs the image perimeter (~1% in) — framing the FULL proof edge-to-edge,
  // exactly how it's cropped by hand: the design fills right to the box.
  const inset = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;

  // Dark frame to match the hand-cropped box (thin border at the edge).
  const FRAME = 0x111111ff;
  const THICKNESS = Math.max(4, Math.round(Math.min(w, h) * 0.006));

  for (let t = 0; t < THICKNESS; t++) {
    // top + bottom edges
    for (let px = x0; px <= x1; px++) {
      const topY = y0 + t;
      const botY = y1 - t;
      if (topY >= 1 && topY <= h) img.setPixelAt(px + 1, topY + 1, FRAME);
      if (botY >= 1 && botY <= h) img.setPixelAt(px + 1, botY + 1, FRAME);
    }
    // left + right edges
    for (let py = y0; py <= y1; py++) {
      const leftX = x0 + t;
      const rightX = x1 - t;
      if (leftX >= 1 && leftX <= w) img.setPixelAt(leftX + 1, py + 1, FRAME);
      if (rightX >= 1 && rightX <= w) img.setPixelAt(rightX + 1, py + 1, FRAME);
    }
  }

  const encoded = new Uint8Array(await img.encode());
  return { boxed: encoded, w, h };
}

/**
 * addBleed — add a clean 2" exterior bleed to a flat panel WITHOUT distorting it.
 *
 * CRITICAL: the design's own aspect ratio is PRESERVED — it is never stretched to
 * the GENIE per-side W×H. Forcing the GENIE rectangle corrupted the artwork when
 * the resolved dimensions were off (stretched stripes/patterns). The extracted
 * design's true proportions are the source of truth here; exact print sizing is the
 * job of the downstream deterministic gridslice, not this preview panel.
 *
 * The panel is upscaled to 4K on its long side (aspect-preserving), then a uniform
 * bleed is edge-extended outward (a 1px border strip scaled into the margin) so the
 * artwork continues past the trim with no blank/solid edge. The bleed pixel size is
 * a best-effort 2" derived from the long-axis px-per-inch; if the GENIE dims are
 * missing/unreasonable it falls back to a sane ~3% margin. Either way the design is
 * NEVER distorted.
 */
async function addBleed(
  bytes: Uint8Array,
  widthInches: number,
  heightInches: number,
  bleedInches: number,
  userId: string,
  jobId: string,
): Promise<{ bleedUrl: string; fullW: number; fullH: number; trimW: number; trimH: number }> {
  const src = await Image.decode(bytes);
  const sW = src.width, sH = src.height;

  // Upscale on the long side, PRESERVING the design's own aspect (no stretch).
  // MEMORY-AWARE: a flat 4096 long edge on a near-square panel makes a huge canvas
  // (4096×3150 ≈ 13MP) that, with the bleed canvas + mirror clones, 546-OOMs the
  // 256MB worker. Cap total area ~9MP so wide panels stay 4096 but square panels
  // scale down enough to fit (e.g. hood/front/rear no longer crash).
  const longSide = Math.max(sW, sH), shortSide = Math.max(1, Math.min(sW, sH));
  const aspectLong = longSide / shortSide;
  const MAXPX = 5_000_000; // raised from 2M so WIDE sides keep a true 4096 long edge
                            // (a 4:1 side at 4096 ≈ 4.2MP). Square panels still cap
                            // lower via areaCap so the 256MB worker doesn't 546-OOM.
  // Do NOT upscale here — the 4K upscale is what 546-OOMs the worker on square
  // panels (hood/front/rear). Print resolution is the UPSCALER's job downstream;
  // this step only needs to add the bleed at working res. So cap to the smaller of
  // the source long edge and a ~4MP area budget (never grow the image).
  const areaCap = Math.round(Math.sqrt(MAXPX * aspectLong));
  const TARGET_LONG = Math.max(1, Math.min(longSide, 4096, areaCap));
  const scale = TARGET_LONG / longSide;
  const trimW = Math.max(8, Math.round(sW * scale));
  const trimH = Math.max(8, Math.round(sH * scale));
  const trim = src.resize(trimW, trimH); // aspect-preserving resize — does NOT distort

  // Uniform bleed in px. Derive a px-per-inch from the long axis vs the GENIE long
  // dimension (best effort — the dims may be off); fall back to ~3% of the long side
  // when dims are missing/unreasonable. A uniform border keeps the design undistorted.
  const longInch = Math.max(widthInches || 0, heightInches || 0);
  const longPx = Math.max(trimW, trimH);
  const ppi = longInch > 4 ? longPx / longInch : 0; // ignore absurdly small/zero dims
  // TRUE 5" bleed in px at this working resolution (no 6% clamp). Upper-bounded at
  // 1/3 of the short side so a tiny panel can't over-extend, but a real 5" band on
  // a full side easily fits.
  let bleedPx = ppi > 0 ? Math.round(bleedInches * ppi) : Math.round(longPx * 0.04);
  bleedPx = Math.max(6, Math.min(bleedPx, Math.round(Math.min(trimW, trimH) / 3)));

  const FW = trimW + 2 * bleedPx, FH = trimH + 2 * bleedPx;
  const canvas = new Image(FW, FH);
  canvas.composite(trim, bleedPx, bleedPx); // design centered
  // TRUE MIRROR BLEED: reflect the design's OWN edge band outward (print-shop
  // mirror bleed), so the artwork continues past the trim with no stretched strip
  // or smear. Matches the gridslice mirror-bleed engine.
  const bw = Math.min(bleedPx, trimW), bh = Math.min(bleedPx, trimH);
  const hStrip = (x0: number) => { const s = trim.clone().crop(x0, 0, bw, trimH); flipH(s); return s; };
  const vStrip = (y0: number) => { const s = trim.clone().crop(0, y0, trimW, bh); flipV(s); return s; };
  canvas.composite(hStrip(0), bleedPx - bw, bleedPx);            // left  edge mirrored
  canvas.composite(hStrip(trimW - bw), bleedPx + trimW, bleedPx); // right edge mirrored
  canvas.composite(vStrip(0), bleedPx, bleedPx - bh);            // top   edge mirrored
  canvas.composite(vStrip(trimH - bh), bleedPx, bleedPx + trimH); // bottom edge mirrored
  const corner = (x0: number, y0: number) => { const s = trim.clone().crop(x0, y0, bw, bh); flipH(s); flipV(s); return s; };
  canvas.composite(corner(0, 0), bleedPx - bw, bleedPx - bh);                       // 4 corners
  canvas.composite(corner(trimW - bw, 0), bleedPx + trimW, bleedPx - bh);
  canvas.composite(corner(0, trimH - bh), bleedPx - bw, bleedPx + trimH);
  canvas.composite(corner(trimW - bw, trimH - bh), bleedPx + trimW, bleedPx + trimH);

  const enc = new Uint8Array(await canvas.encode());
  const p = tempPath(userId, jobId, `panel-pro-bleed-${Date.now()}`);
  await uploadToStorage(p, enc, "image/png");
  return { bleedUrl: getPublicUrl(p), fullW: FW, fullH: FH, trimW, trimH };
}

// The deterministic structural extract relies ONLY on the actual photographed
// wrap pixels — no GENIE few-shot example images and no legacy "slice" steps. A
// generic example teaches a generic output; the real pixels keep the clone
// faithful to THIS vehicle's exact layout.

// The GOLD proofpanel prompt — the exact wording panel-artboard-generator
// step:"proofpanel" uses to build the proven 1:1 artboards (incl. the F150 flag).
// It de-warps the side's render off the curved body, preserving every color /
// gradient / shading and stripping ALL vehicle body lines. Run at temperature 0
// so Gemini REPRODUCES rather than reinvents (the fix for the generic-flag drift).
function goldPrompt(side: string): string {
  const s = side && side.trim() ? side.trim() : "vehicle";
  return `FLATTEN the ${s} wrap from this approved design into ONE flat, full-bleed rectangular PRINT PANEL: take the artwork off the vehicle's curved body and lay it out flat, edge to edge. KEEP the design's exact appearance — every color, gradient, internal shading, dimensional depth, metallic/gloss highlight, texture, graphic and piece of lettering exactly as shown, in the SAME positions. PRESERVE THE SCALE AND COVERAGE of every element as it sits on the body: if a color field, pattern or graphic covers the full height or a large area of the vehicle's side, it must cover that SAME proportion of the flat panel — do NOT shrink it into a smaller, neater, standard-sized version. The artwork's OWN light and shadow ARE the design — preserve them fully; do NOT simplify, posterize, cartoon-ify, wash them out, or substitute a generic/stock version of the design. REMOVE everything that belongs to the vehicle or the photo: the body, wheels, windows, glass, bumpers, trim, background/studio, glare, camera perspective, and ALL vehicle body lines, door seams, panel gaps, handle cutouts, wheel-arch curves and contour/edge shadows. Output ONLY the flat ${s} wrap artwork, as if printed on flat vinyl before application — no vehicle, no body lines, no background, no other views, no labels, no dimension lines, no white margins.`;
}

// Retry-agent rephrasings layered on top of the gold prompt — each round adds a
// short emphasis so it "edits how it asks" without abandoning the proven base.
const RETRY_EMPHASIS = [
  ``,
  ` Reproduce the SPECIFIC artwork on THIS vehicle exactly — same element placement and flow — not a standard/stock version.`,
  ` Match every star, stripe, graphic and color to the source positions precisely; copy, do not redesign.`,
  ` This must be a pixel-faithful flatten of the real wrap, not a clean idealized rendition.`,
  ` Keep 100% of the actual artwork in place; fill any removed area by continuing the SAME design.`,
];

// INPAINT-FILL prompt — used when the input is ALREADY the real wrap pixels
// (deterministically extracted from the render). Gemini must NOT redraw the
// design; it only patches the vehicle holes by cloning the surrounding artwork.
function fillPrompt(side: string): string {
  const s = side && side.trim() ? side.trim() : "vehicle";
  return `This image is the REAL ${s} wrap artwork lifted straight off the vehicle, with parts of the vehicle still showing through it: windows, glass, the side mirror, door handles, wheels/tires, body gaps and edges, and some studio background. KEEP every part of the EXISTING artwork EXACTLY as it is — do not redraw, restyle, recolor, move, straighten or re-interpret any of it; this is a CLONE, not a new design. ONLY paint over the non-artwork areas (the windows/glass, mirror, handles, wheels, body edges and background) by smoothly CONTINUING the SURROUNDING wrap pattern, colors and flow into them so the seam disappears. Extend the artwork to completely fill the rectangle edge to edge — no holes, no gaps, no vehicle parts, no background, no blank or solid areas. Output ONLY the cleaned flat artwork.`;
}

async function callGemini(
  boxedBase64: string,
  widthInches: number,
  heightInches: number,
  label: string,
  correction?: string,
  promptVariant = 0,
  fillMode = false,
): Promise<string | null> {
  // Gold proofpanel prompt + a per-round emphasis (retry agent) + validator fix.
  const emphasis = RETRY_EMPHASIS[Math.min(promptVariant, RETRY_EMPHASIS.length - 1)];
  const fixLine = correction ? ` ${correction}` : "";
  const prompt = fillMode ? `${fillPrompt(label)}${fixLine}` : `${goldPrompt(label)}${emphasis}${fixLine}`;
  const ratio = toSupportedRatio(`${Math.round(widthInches)}:${Math.round(heightInches)}`);

  // NOTE: few-shot AFTER examples are intentionally NOT injected here. A generic
  // example image teaches a generic output; relying on the actual photographed
  // pixels keeps the clone faithful to THIS vehicle's exact layout.
  const parts: any[] = [];
  parts.push({ inlineData: { mimeType: "image/png", data: boxedBase64 } });
  parts.push({ text: prompt });

  const contents = [{ role: "user", parts }];

  // ONE Gemini call per invoke. The client (Studio Board) owns the retry/rephrase
  // loop, so an internal multi-attempt loop here only stacks 70s calls and blows
  // past the worker wall-clock — that caused "Failed to send a request to the Edge
  // Function". Keep this to a single call so each invoke returns well under the limit.
  const MAX_ATTEMPTS = 1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const key = getGeminiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      console.log(`[PANEL-PRO-EXTRACT] ${GEMINI_IMAGE_MODEL} attempt ${attempt}/${MAX_ATTEMPTS}`);
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Match the proven proofpanel path: temperature 0 so Gemini REPRODUCES
          // the exact artwork instead of reinventing a generic version (the real
          // fix for the flag drift), 2K to stay under the 256MB worker limit, and
          // the panel aspect ratio so the flatten comes out the right shape.
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0,
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { imageSize: "4K", aspectRatio: ratio },
            },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.warn(`[PANEL-PRO-EXTRACT] ${resp.status}: ${errText.slice(0, 200)}`);
        if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
        return null;
      }

      const result = await resp.json();
      const parts = result?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part?.inlineData?.data) return part.inlineData.data;
      }
      console.warn(`[PANEL-PRO-EXTRACT] No image in response (attempt ${attempt})`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000));
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[PANEL-PRO-EXTRACT] ${err?.name === "AbortError" ? "Timeout" : "Error"} (attempt ${attempt}): ${err}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}

/**
 * Build the deterministic structural prompt — the exact wording that boxes the
 * design to the resolved print rectangle, then cleans + fills it 1:1. The
 * resolved Height/Width inches are injected so the rectangle is the TRUE per-side
 * size (same source the 2D proof stamps), making the panel a literal 1:1.
 */
function structuralPrompt(widthInches: number, heightInches: number, sideKey = "panel", sourceIsProof = false, proofTile = false): string {
  const H = Math.round(heightInches);
  const W = Math.round(widthInches);
  const side = String(sideKey || "panel").replace(/[_-]+/g, " ").toUpperCase();
  const source = proofTile
    ? `The FIRST attached image is the ${side} view tile cropped from the canonical APPROVED 2D production proof — it contains ONLY this side and is the sole authority for artwork content, exact words, spelling, and numbers. Use its complete artwork; never borrow artwork from any other side and never correct or replace its text from a secondary reference.`
    : sourceIsProof
    ? `The FIRST attached image is the canonical APPROVED flat all-sides 2D production proof and is the sole authority for artwork content, exact words, spelling, and numbers. Locate ONLY the panel labeled or visually identified as ${side}. Never use the driver-side artwork for another named panel and never correct or replace proof text from a secondary reference.`
    : `The attached image is the approved ${side} source view.`;
  const extent = /driver|passenger|side/.test(side.toLowerCase())
    ? "Keep the whole side from the very front to the very rear."
    : `Keep the complete ${side} artwork on all four edges; do not substitute, mirror, or borrow artwork from another panel.`;
  return `${source} Extract ${side} into ONE flat rectangular print panel at a ${W}:${H} proportion. ${extent} Remove glare and vehicle geometry while preserving the exact design, colors, logos, text, scale, and layout belonging to ${side}. The artwork must FILL 100% of the rectangular canvas edge to edge — where the vehicle has windows, glass, sunroof, mirrors, wheel arches, or panel cutouts, CONTINUE the surrounding wrap artwork seamlessly across that area (a print panel is solid vinyl; glass and openings are never printed). Where wheel arches would notch the lower band, continue that band STRAIGHT across — no arch-shaped cutouts. Never duplicate or mirror a focal element (a face, photo, logo, or lettering block) to fill space — each focal element appears exactly ONCE, positioned as in the source, and empty areas are filled by extending the surrounding background pattern. Never leave white corners, dark glass regions, or any vehicle-shaped silhouette — the output is a full solid rectangle of wrap artwork only: no vehicle, ruler, dimension lines, measurements, labels, border, or blank margins.`;
}

/**
 * geminiEditStep — ONE conversational image edit (the Studio one-shot flow).
 * Feeds an image + a single instruction at temperature 0 so Gemini performs just
 * that operation and PRESERVES the rest of the image. By default no aspectRatio
 * (forcing a ratio makes it regenerate, which stretches the artwork) — callers
 * pass only { imageSize } so the edit keeps the input's own proportions.
 */
async function geminiEditStep(
  imageB64: string,
  instruction: string,
  opts: { aspectRatio?: string; imageSize?: string; refs?: Array<{ b64: string; caption: string }> } = {},
): Promise<string | null> {
  const imageConfig: Record<string, string> = { imageSize: opts.imageSize || "2K" };
  if (opts.aspectRatio) imageConfig.aspectRatio = opts.aspectRatio;
  const refParts = (opts.refs || []).flatMap((ref) => [
    { text: ref.caption },
    { inlineData: { mimeType: "image/png", data: ref.b64 } },
  ]);
  // Up to 3 attempts: Gemini intermittently returns TEXT only (finishReason
  // NO_IMAGE) — a re-roll usually yields the image.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const key = getGeminiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [
              { inlineData: { mimeType: "image/png", data: imageB64 } },
              { text: instruction },
              ...refParts,
            ] }],
            generationConfig: {
              temperature: 0.0,
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig,
            },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);
      if (!resp.ok) {
        console.warn(`[PPX-STEP] ${resp.status} (attempt ${attempt}): ${(await resp.text().catch(()=>"")).slice(0,160)}`);
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        return null;
      }
      // STREAM-SCAN the response instead of resp.json() — the 546 killer on
      // hard tiles (live E2E 2026-07-27, B-52 hood): Gemini 3 Pro Image
      // attaches its interim "thinking" images to the response, so the JSON
      // can carry SEVERAL images and parsing it whole blows the 256MB worker
      // no matter what final imageSize was requested. Scanning the byte
      // stream for "data":"…" runs and keeping only the LAST one bounds
      // memory at ~one image regardless of how many the model emitted.
      // (base64 payloads contain no quotes/escapes, so quote-terminated
      // scanning is exact.)
      const reader = resp.body?.getReader();
      let lastData = "";
      if (reader) {
        const dec = new TextDecoder();
        let tail = "";            // carry-over across chunk boundaries
        let inData = false;
        let cur = "";
        const MARK = '"data": "';
        const MARK2 = '"data":"';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let s = tail + dec.decode(value, { stream: true });
          tail = "";
          let i = 0;
          while (i < s.length) {
            if (inData) {
              const q = s.indexOf('"', i);
              if (q === -1) { cur += s.slice(i); i = s.length; }
              else { cur += s.slice(i, q); lastData = cur; cur = ""; inData = false; i = q + 1; }
            } else {
              const m1 = s.indexOf(MARK, i);
              const m2 = s.indexOf(MARK2, i);
              const m = (m1 === -1) ? m2 : (m2 === -1 ? m1 : Math.min(m1, m2));
              if (m === -1) { tail = s.slice(Math.max(i, s.length - 12)); i = s.length; }
              else { inData = true; i = m + (m === m1 && m1 !== -1 ? MARK.length : MARK2.length); }
            }
          }
        }
      }
      if (lastData.length > 1000) return lastData;
      console.warn(`[PPX-STEP] no image in streamed response (attempt ${attempt})`);
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
      return null;
    } catch (e: any) {
      clearTimeout(timer);
      console.warn(`[PPX-STEP] ${e?.name === "AbortError" ? "timeout" : e} (attempt ${attempt})`);
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
      return null;
    }
  }
  return null;
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── SINGLE mode — the exact Studio one-prompt flow ────────────────
  // Tight-crop the render, then ONE Gemini edit with the customer's exact
  // wording. Reproduces the accepted Studio driver-side panel.
  // Body: { mode:"single", imageUrl, prompt?, userId?, jobId? }
  try {
    const peek = req.method === "POST" ? await req.clone().json().catch(() => ({})) : {};

    // ── BLEED mode — conform the clean panel to the GENIE rectangle + 2" bleed ─
    // Deterministic (no Gemini): stretch the edge-to-edge design to the exact
    // GENIE Universal Panelizer per-side W×H and add a true 2" exterior bleed.
    // This is the FINAL shape of the one clean panel file we keep.
    // Body: { mode:"bleed", imageUrl, widthInches?/heightInches? | vehicleDims/
    //         sideKey/view, bleedInches?, userId?, jobId? }
    if (peek?.mode === "bleed") {
      const imageUrl: string = peek.imageUrl || "";
      if (!imageUrl) return jsonResponse({ error: "imageUrl required" }, 400);
      const userId: string = peek.userId || "anonymous";
      const jobId: string = peek.jobId || `bleed-${Date.now()}`;
      const resolved = resolvePanelSize({
        view: peek.view, sideKey: peek.sideKey, sideSize: peek.sideSize, roofSize: peek.roofSize,
        vehicleMake: peek.vehicleMake, vehicleModel: peek.vehicleModel, vehicleDims: peek.vehicleDims,
      });
      const widthInches = Number(peek.widthInches) || resolved.widthInches;
      const heightInches = Number(peek.heightInches) || resolved.heightInches;
      const bleedInches = Number(peek.bleedInches) || 2;
      let fetchUrl = imageUrl;
      if (imageUrl.includes("/storage/v1/object/")) {
        fetchUrl = imageUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=2048&resize=contain&quality=95`;
      }
      let r = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok && fetchUrl !== imageUrl) r = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return jsonResponse({ error: `fetch ${r.status}` }, 400);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const { bleedUrl } = await addBleed(bytes, widthInches, heightInches, bleedInches, userId, jobId);
      return jsonResponse({ success: true, mode: "bleed", url: bleedUrl, panelUrl: bleedUrl, widthInches, heightInches, bleedInches, sizeSource: resolved.source });
    }

    // ── mode:"qccheck" — the per-panel QC gate (roadmap #4: no silent slop).
    // Cheap Flash text verdict comparing a produced panel against its design
    // reference (the proof tile or proof). The caller (flatMasterSheet ladder)
    // only lands a panel whose verdict passes; a fail falls to the next
    // producer, then an honest gap. Body: { mode:"qccheck", panelUrl, refUrl,
    // sourceProofUrl?, side? } → { success, pass, checks:{...}, reason }
    if (peek?.mode === "qccheck") {
      if (!hasGeminiKey()) return jsonResponse({ error: "No GOOGLE_AI_API_KEY configured" }, 500);
      const panelUrl: string = peek.panelUrl || "";
      const refUrl: string = peek.refUrl || "";
      const sourceProofUrl: string = peek.sourceProofUrl || "";
      if (!panelUrl || !refUrl) return jsonResponse({ error: "panelUrl and refUrl required" }, 400);
      const qcSide = String(peek.side || "panel");
      // The approved 2D proof surface in refUrl plus the optional full form of
      // that same proof are the sole authority for both design and text. A
      // pre-proof vehicle render may contain a typo or earlier lockup; accepting
      // it as an override rejected faithful FRONT output and could approve text
      // the customer never approved.
      const fetchSmall = async (u: string): Promise<{ b64: string; mime: string } | null> => {
        let fu = u;
        if (u.includes("/storage/v1/object/")) {
          fu = u.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=1600&resize=contain&quality=80`;
        }
        let rr = await fetch(fu, { signal: AbortSignal.timeout(15_000) });
        if (!rr.ok && fu !== u) rr = await fetch(u, { signal: AbortSignal.timeout(15_000) });
        if (!rr.ok) return null;
        return { b64: uint8ArrayToBase64(new Uint8Array(await rr.arrayBuffer())), mime: rr.headers.get("content-type") || "image/png" };
      };
      const [panelImg, refImg, proofImg] = await Promise.all([
        fetchSmall(panelUrl),
        fetchSmall(refUrl),
        sourceProofUrl && sourceProofUrl !== refUrl ? fetchSmall(sourceProofUrl) : Promise.resolve(null),
      ]);
      if (!panelImg || !refImg) return jsonResponse({ success: false, error: "qccheck fetch failed" }, 400);
      const qcPrompt = `Image 1 is a produced ${qcSide} print PANEL (full-bleed flat wrap artwork). Image 2 is its cropped surface from the customer-approved 2D PROOF.${proofImg ? " Image 3 is that same full customer-approved 2D PROOF, provided only to clarify proof-wide text such as the design name/header and text visible elsewhere on the same approved sheet." : ""} The approved proof images are the ONLY source of truth for design and text. Never correct them from an earlier vehicle render, artboard, common spelling, or outside knowledge. Judge the panel strictly:
1. design_match — the panel's artwork (colors, motifs, layout) is clearly the same design as the approved proof's ${qcSide} area, not a different or reinvented design.
2. text_ok — every confidently readable company name / tagline / phone number on the panel is spelled exactly as in the approved proof${proofImg ? " (use Image 3 only to clarify Image 2, because both are the same approved artifact)" : ""} (true also when the approved proof surface legitimately carries no text). A changed digit, omitted letter, substituted word, or added text fails. If text is too small or blurry to read CONFIDENTLY in the proof images, do not invent what it says and do not fail solely on an uncertain OCR guess.
3. full_bleed — artwork fills the entire rectangle: no blank margins, no vehicle-shaped silhouette or wheel-arch cutouts. A white/light field is a FAILURE only when the reference does NOT show it there — the approved design's own white/light body color is valid printable artwork. Mirrored artwork at the outer edges is the print BLEED — expected, never a failure.
4. no_vehicle_or_sheet — the panel is FLAT ARTWORK ONLY. Fail this check if ANY vehicle element is visible: wheels, tires, wheel arches, windows or window openings, windshield, mirrors, door seams or handles, cab/bed silhouette, bumpers, grilles, manufacturer badges or emblems (Ford/Chevy/etc.), or a recognizable photo of a vehicle — and fail it for proof-sheet content (titles, dimension lines, labels, multiple vehicle views). When unsure whether something is a vehicle element, FAIL this check — a wrong panel must never ship.
5. layout_match — every focal logo, wordmark, text block, and distinctive graphic appears the same number of times and at approximately the same relative size, order, arrangement, and location on the ${qcSide} surface as Image 2. Fail if anything is enlarged, shrunk, recentered, restacked, duplicated, omitted, moved to a different region, or borrowed from another surface. A small front/rear branding strip must remain a small strip; turning it into a large centered lockup is always a failure.
Respond ONLY with JSON: {"design_match":bool,"text_ok":bool,"full_bleed":bool,"no_vehicle_or_sheet":bool,"layout_match":bool,"reason":"<short>"} `;
      try {
        // ROTATE the key pool on 429/5xx — several sides' judges fire
        // concurrently at build time, and a single-key single-shot 429'd the
        // whole verdict (live 07-28: the three concurrent judges all landed
        // "unavailable" while the two solo ones passed). Same pattern as the
        // worker's field-QC loop.
        let resp: Response | null = null;
        for (let k = 0; k < Math.max(1, geminiKeyCount()); k++) {
          resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [
                  { text: qcPrompt },
                  { inlineData: { mimeType: panelImg.mime, data: panelImg.b64 } },
                  { inlineData: { mimeType: refImg.mime, data: refImg.b64 } },
                  ...(proofImg ? [{ inlineData: { mimeType: proofImg.mime, data: proofImg.b64 } }] : []),
                ] }],
                generationConfig: {
                  temperature: 0,
                  maxOutputTokens: 300,
                  responseMimeType: "application/json",
                  thinkingConfig: { thinkingBudget: 0 },
                },
              }),
              signal: AbortSignal.timeout(30_000),
            },
          );
          if (resp.ok) break;
          if (resp.status !== 429 && resp.status < 500) break; // real error — don't burn the pool
          await new Promise((r) => setTimeout(r, 800 * (k + 1)));
        }
        if (!resp || !resp.ok) return jsonResponse({ success: false, error: `qccheck gemini ${resp?.status ?? "no response"}` }, 502);
        const j = await resp.json();
        const txt = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "{}";
        let checks: Record<string, unknown> = {};
        try { checks = JSON.parse(txt.replace(/```json|```/g, "").trim()); } catch { checks = {}; }
        const pass = checks.design_match === true && checks.text_ok === true &&
                     checks.full_bleed === true && checks.no_vehicle_or_sheet === true &&
                     checks.layout_match === true;
        return jsonResponse({ success: true, mode: "qccheck", pass, checks, reason: checks.reason || "" });
      } catch (e) {
        // A broken judge returns unknown; the caller quarantines the panel
        // fail-closed rather than promoting an unverified artifact.
        return jsonResponse({ success: false, error: `qccheck threw: ${String(e)}` }, 502);
      }
    }

    if (peek?.mode === "single") {
      if (!hasGeminiKey()) return jsonResponse({ error: "No GOOGLE_AI_API_KEY configured" }, 500);
      const imageUrl: string = peek.imageUrl || "";
      if (!imageUrl) return jsonResponse({ error: "imageUrl required" }, 400);
      const userId: string = peek.userId || "anonymous";
      const jobId: string = peek.jobId || `single-${Date.now()}`;

      // Resolve the TRUE per-side print size (vehicle_dimensions DB → CSV → GENIE
      // standard) — the SAME source the 2D proof stamps — and inject it into the
      // structural prompt + the locked aspect canvas so the panel is a literal 1:1.
      const resolved = resolvePanelSize({
        view: peek.view, sideKey: peek.sideKey, sideSize: peek.sideSize, roofSize: peek.roofSize,
        vehicleMake: peek.vehicleMake, vehicleModel: peek.vehicleModel, vehicleDims: peek.vehicleDims,
      });
      const widthInches = Number(peek.widthInches) || resolved.widthInches;
      const heightInches = Number(peek.heightInches) || resolved.heightInches;
      const ratio = toSupportedRatio(widthInches, heightInches);
      const sideHint = String(peek.sideKey || peek.view || peek.label || "panel").toLowerCase();
      const sourceIsProof = peek.sourceIsProof === true;
      const proofTile = peek.proofTile === true;
      const prompt: string = structuralPrompt(widthInches, heightInches, sideHint, sourceIsProof, proofTile);

      // Optional hi-res lockup/detail reference (the branded artboard). The 1K
      // proof's small tiles carry ~250px of lettering — below legibility — so
      // without a reference the extract hallucinates the tagline (live 07-27:
      // "Family & Cosmetic Dentistry" → "Tuning & Executive Dentarcy"). Fetched
      // small (1600px) so it never threatens the worker budget; best-effort.
      // It is a visual sharpness/style aid only: the approved proof remains the
      // sole content authority because the driver artboard can predate or
      // conflict with the final proof (Copper Canyon: 555 vs approved 565).
      let lockupRef: { b64: string; caption: string } | undefined;
      // Defensive surface boundary: the current lockup reference is the
      // continuous DRIVER artboard. Even if a stale caller sends it for another
      // panel, do not put those pixels into that generation request. Prompt
      // wording alone did not stop the model from importing a giant driver
      // lockup into FRONT.
      const isDriverSide = /\bdriver\b/.test(sideHint) && !/\bpassenger\b/.test(sideHint);
      const lockupRefUrl: string = isDriverSide ? (peek.lockupRefUrl || "") : "";
      if (lockupRefUrl) {
        try {
          let refFetch = lockupRefUrl;
          if (lockupRefUrl.includes("/storage/v1/object/")) {
            refFetch = lockupRefUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=1600&resize=contain&quality=85`;
          }
          let rr = await fetch(refFetch, { signal: AbortSignal.timeout(15_000) });
          if (!rr.ok && refFetch !== lockupRefUrl) rr = await fetch(lockupRefUrl, { signal: AbortSignal.timeout(15_000) });
          if (rr.ok) {
            lockupRef = {
              b64: uint8ArrayToBase64(new Uint8Array(await rr.arrayBuffer())),
              caption: "NON-AUTHORITATIVE VISUAL DETAIL AID. The customer-approved 2D proof images are the sole authority for which artwork appears and for every exact word, spelling, and number. Use this image only to sharpen colors, logo shapes, font styling, and glyph edges that agree with the approved proof. If its text conflicts with or adds to the approved proof, ignore it completely: never correct, replace, or import words or digits from this image.",
            };
          }
        } catch { /* extract proceeds without the reference */ }
      }

      let fetchUrl = imageUrl;
      if (imageUrl.includes("/storage/v1/object/")) {
        fetchUrl = imageUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=${MAX_FETCH_WIDTH}&resize=contain&quality=90`;
      }
      let r = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok && fetchUrl !== imageUrl) r = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return jsonResponse({ error: `fetch ${r.status}` }, 400);
      const raw = new Uint8Array(await r.arrayBuffer());

      // noCrop: the caller is CHAINING steps (the client orchestrates the Studio
      // multi-turn flow as 3 separate single-call invokes, so each stays under the
      // worker wall-clock). On steps 2+ the input is ALREADY the cropped, edited
      // intermediate — re-cropping it on saturation would shave the artwork and
      // boxing it would re-draw a frame, so feed it straight through.
      const noCrop = peek.noCrop === true || sourceIsProof;
      const isTopDown = /roof|top|hood|detail|overhead/.test(sideHint);

      let primary: Uint8Array;
      if (noCrop) {
        primary = raw;
      } else {
        // SIDE views flatten faithfully from a TIGHT CROP only. Drawing a box
        // around a side makes A.C.E. treat it as a framed picture to redraw — it
        // comes back as a cartoon/illustration (the regression). Only TOP-DOWN
        // views (roof/hood) actually benefit from the box, because the saturation
        // crop alone leaves A.C.E. unsure where the panel is.
        const { boxed } = await cropToDesign(raw);
        primary = isTopDown ? (await drawBox(boxed)).boxed : boxed;
      }

      // Do NOT force an aspectRatio — forcing a ratio makes Gemini REGENERATE the
      // canvas to that shape, which STRETCHES the artwork (this is what distorted
      // the F150 flag). Let geminiEditStep preserve the input's own proportions so
      // the edit stays a faithful clone. The resolved ratio is still returned as a
      // verification stat for the Studio Board cards, just not handed to Gemini.
      // (The AI flatten path is a dead end regardless — flat-first authoring +
      // geometric gridslice is the real fix; this only stops the active distortion.)
      // Try the tight crop first; if A.C.E. returns no image, fall back to the full
      // uncropped frame.
      // 4K for WIDE sides only. A near-square side at 4K is ~12MP (vs ~4MP for
      // a wide strip) and the decode/encode of that response deterministically
      // 546'd the worker (live E2E 2026-07-27: hood/roof/rear failed every
      // attempt while driver/front passed). 2K on near-square sides is NOT a
      // quality cut — physically smaller panels at 2K carry MORE pixels per
      // printed inch than the driver side at 4K (hood 2048px/86" ≈ 24 PPI vs
      // driver 4096px/222" ≈ 18 PPI).
      const _ar = (widthInches > 0 && heightInches > 0)
        ? Math.max(widthInches, heightInches) / Math.min(widthInches, heightInches) : 2;
      // Near-square sides: 1K, not 2K — even 2K + fail-fast still 546'd
      // hood/roof/rear on some proofs (E2E runs 3-5, 2026-07-27) while the
      // same call passed on a different proof hours earlier: the response payload
      // varies by CONTENT (Gemini 3 Pro Image emits interim images while
      // reasoning on hard tiles), so the only reliable ceiling is a decisively
      // smaller output. Honest economics: the source tile on the 1K proof is
      // ~300px — the extract is a clean 1K repaint of it, and print resolution
      // comes from the Topaz leg downstream, not this working image.
      // The full approved proof is authoritative context for text the side
      // tile cannot resolve (for example FRONT's company name can be clarified
      // by the proof header). The artboard, when present, follows it only as a
      // non-authoritative visual-detail aid.
      let approvedProofRef: { b64: string; caption: string } | undefined;
      const sourceProofUrl: string = peek.sourceProofUrl || "";
      if (sourceProofUrl && sourceProofUrl !== imageUrl) {
        try {
          let proofFetch = sourceProofUrl;
          if (sourceProofUrl.includes("/storage/v1/object/")) {
            proofFetch = sourceProofUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=1600&resize=contain&quality=90`;
          }
          let rr = await fetch(proofFetch, { signal: AbortSignal.timeout(15_000) });
          if (!rr.ok && proofFetch !== sourceProofUrl) rr = await fetch(sourceProofUrl, { signal: AbortSignal.timeout(15_000) });
          if (rr.ok) {
            approvedProofRef = {
              b64: uint8ArrayToBase64(new Uint8Array(await rr.arrayBuffer())),
              caption: "AUTHORITATIVE FULL CUSTOMER-APPROVED 2D PROOF. This is the same approved artifact as the primary side tile. Use it to clarify proof-wide text such as the design name/header and other occurrences on this sheet. Never take text from the non-authoritative artboard when it conflicts with this proof.",
            };
          }
        } catch { /* the side tile remains authoritative */ }
      }
      const refs = [approvedProofRef, lockupRef].filter(
        (ref): ref is { b64: string; caption: string } => !!ref,
      );
      const cfg = { imageSize: _ar < 2 ? "1K" : "4K", refs };
      let out = await geminiEditStep(uint8ArrayToBase64(primary), prompt, cfg);
      // IN-WORKER FALLBACK ONLY for non-proof sources. On sourceIsProof the
      // fallback input IS the same bytes (noCrop), so the second pass adds no
      // new information — but running two full edit passes in ONE worker is
      // what deterministically 546'd hood/roof/rear (live E2E 2026-07-27:
      // first pass returns NO_IMAGE on the small tiles, the fallback pass then
      // blows the 256MB budget). Fail fast instead: the master-sheet builder
      // retries in a FRESH worker, where a retry actually has headroom.
      if (!out && !sourceIsProof) {
        const fallback = noCrop ? raw : (isTopDown ? (await drawBox(raw)).boxed : raw);
        out = await geminiEditStep(uint8ArrayToBase64(fallback), prompt, cfg);
      }
      if (!out) return jsonResponse({ success: false, error: "single-step edit failed" }, 502);
      const p = tempPath(userId, jobId, `panel-pro-single-${Date.now()}`);
      await uploadToStorage(p, base64ToUint8Array(out), "image/png");
      const url = getPublicUrl(p);
      return jsonResponse({
        success: true, mode: "single", panelUrl: url, url,
        widthInches, heightInches, aspectRatio: ratio, sizeSource: resolved.source,
      });
    }
  } catch (_e) { /* fall through to normal flow */ }

  try {
    if (!hasGeminiKey()) {
      return jsonResponse({ error: "No GOOGLE_AI_API_KEY configured" }, 500);
    }

    const body = await req.json();
    const imageUrl: string = body.imageUrl || "";
    const label: string = body.label || "";
    const userId: string = body.userId || "anonymous";
    const jobId: string = body.jobId || `ppx-${Date.now()}`;

    // Panel size: explicit inches win; otherwise resolve from ACTUAL vehicle
    // dimensions (make+model), falling back to GENIE standard panels.
    const resolved = resolvePanelSize({
      view: body.view, sideKey: body.sideKey,
      sideSize: body.sideSize, roofSize: body.roofSize,
      vehicleMake: body.vehicleMake, vehicleModel: body.vehicleModel,
      vehicleDims: body.vehicleDims,
    });
    const widthInches: number = Number(body.widthInches) || resolved.widthInches;
    const heightInches: number = Number(body.heightInches) || resolved.heightInches;

    if (!imageUrl) return jsonResponse({ error: "imageUrl is required" }, 400);

    const start = Date.now();
    console.log(`[PANEL-PRO-EXTRACT] ${label || "panel"} | ${widthInches}"×${heightInches}" (${resolved.source}) | ${imageUrl.slice(0, 80)}`);

    // ── 1. Fetch the proof (memory-safe via Supabase image transform) ──
    let fetchUrl = imageUrl;
    if (imageUrl.includes("/storage/v1/object/")) {
      fetchUrl = imageUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") +
        `?width=${MAX_FETCH_WIDTH}&resize=contain&quality=85`;
    }
    let imgResp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgResp.ok && fetchUrl !== imageUrl) {
      imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    }
    if (!imgResp.ok) return jsonResponse({ error: `Fetch failed: HTTP ${imgResp.status}` }, 400);
    const proofBytes = new Uint8Array(await imgResp.arrayBuffer());
    console.log(`[PANEL-PRO-EXTRACT] Fetched proof: ${(proofBytes.byteLength / 1024).toFixed(0)} KB`);

    // ── 2. Prepare the input image ──
    // fillMode: the caller already passed the deterministically-extracted REAL
    // wrap pixels — feed them as-is so Gemini only inpaints the vehicle holes.
    // Otherwise auto-crop to just the wrapped design (drop floor/walls/wheels).
    const fillMode = body.fillMode === true || body.mode === "fill";
    const { boxed, w, h } = fillMode
      ? { boxed: proofBytes, w: 0, h: 0 }
      : await cropToDesign(proofBytes);
    console.log(`[PANEL-PRO-EXTRACT] ${fillMode ? "fill-mode input (no crop)" : "Cropped input"}: ${w}×${h}`);

    // Debug: return just the cropped input (no Gemini) so the crop can be inspected.
    const boxedBase64 = uint8ArrayToBase64(boxed);
    if (body.debugCrop) {
      const dbgPath = tempPath(userId, jobId, `crop-debug-${Date.now()}`);
      await uploadToStorage(dbgPath, boxed, "image/png");
      return jsonResponse({ success: true, debugCrop: true, cropUrl: getPublicUrl(dbgPath), w, h });
    }

    // ── 3. Ask Gemini to fill the rectangle ──
    const panelBase64 = await callGemini(boxedBase64, widthInches, heightInches, label, body.correction, Number(body.promptVariant) || 0, fillMode);
    if (!panelBase64) {
      return jsonResponse({ success: false, error: "Gemini failed to generate the flat panel" }, 422);
    }

    // ── 4. Upload result + return signed URL ──
    const panelBytes = base64ToUint8Array(panelBase64);
    const safeLabel = (body.sideKey || label || "panel").replace(/\s+/g, "-").toLowerCase();
    const outPath = tempPath(userId, jobId, `panel-pro-${safeLabel}-${Date.now()}`);
    await uploadToStorage(outPath, panelBytes, "image/png");
    const publicUrl = getPublicUrl(outPath);
    const signedUrl = await getSignedUrl(outPath).catch(() => publicUrl);

    console.log(`[PANEL-PRO-EXTRACT] ✓ Done in ${Date.now() - start}ms (${(panelBytes.byteLength / 1024).toFixed(0)} KB)`);

    return jsonResponse({
      success: true,
      panelUrl: publicUrl,    // public — safe to persist into the job
      signedUrl,
      storagePath: outPath,
      label,
      sideKey: body.sideKey || null,
      view: body.view || null,
      widthInches,
      heightInches,
      sizeSource: resolved.source,
      ms: Date.now() - start,
    });
  } catch (err: any) {
    console.error("[PANEL-PRO-EXTRACT] Error:", err);
    return jsonResponse({ error: err?.message || "Extraction failed" }, 500);
  }
});
