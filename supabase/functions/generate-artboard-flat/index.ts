/**
 * generate-artboard-flat — Deterministic flat artboard generator
 *
 * No AI. No hallucination. Just:
 *   1. Pull real panel dimensions (from request, job record, or vehicle DB).
 *   2. For each panel pick the matching 3D render view.
 *   3. Scale-fit that view into a rectangle sized to the panel's real inches.
 *   4. Compose all rectangles on one canvas with dimension labels.
 *   5. Flatten to PNG, upload, update job → status=pending_qc.
 *
 * Mirrors the request/response shape of generate-artboard-simple so the
 * frontend can swap between them with a single function-name change.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "wrap-files";
const BLEED = 2;
const MAX_TILE_INCHES = 59;
const OVERLAP_INCHES = 1.0;
// Production sheet aspect. Long trailer/box sides (180"+) laid out at scale
// were cramped into the old 16:9 (2048×1152) sheet; a 21:9 container gives the
// width those layouts need. Canvas is sized to the true total panel inches at a
// fixed px/in, then padded to 21:9 and clamped for the 256MB Edge runtime.
const SHEET_ASPECT = 21 / 9;
const MAX_CANVAS_W = 2520; // 2520×1080 @ 21:9 ≈ 2.7MP — safe under 256MB
const BASE_PX_PER_IN = 12; // nominal scale used to size the canvas to content
const OUTER_PAD = 64;
const GAP_BETWEEN_PANELS = 48;
const ROW_GAP = 72;
const LABEL_H = 56;
const TEXT_SCALE = 4;
const BG_COLOR = 0xFFFFFFFF;
const OUTLINE_COLOR = 0x222222FF;
const TEXT_COLOR = 0x111111FF;
const PLACEHOLDER_COLOR = 0xE5E5E5FF;

interface PanelDim {
  label: string;
  panelKey: string;
  widthInches: number;
  heightInches: number;
  widthWithBleed?: number;
  heightWithBleed?: number;
  mirrored?: boolean;
}

// ── Panel grouping ──────────────────────────────────────────────────

function groupPanels(panels: PanelDim[]): PanelDim[][] {
  const sides: PanelDim[] = [];
  const mids: PanelDim[] = [];
  const bumpers: PanelDim[] = [];
  const others: PanelDim[] = [];
  for (const p of panels) {
    const name = `${p.label} ${p.panelKey}`.toLowerCase();
    if (/side|driver|passenger/.test(name)) sides.push(p);
    else if (/bumper/.test(name)) bumpers.push(p);
    else if (/hood|rear|roof|top|trunk|tailgate/.test(name)) mids.push(p);
    else others.push(p);
  }
  const rows = [sides, [...mids, ...others], bumpers].filter((r) => r.length > 0);
  return rows;
}

// ── View picker ─────────────────────────────────────────────────────

function pickViewUrl(panel: PanelDim, views: Record<string, string>): { url: string; mirror: boolean } | null {
  const name = `${panel.label} ${panel.panelKey}`.toLowerCase();
  const priority: string[] = [];
  let mirror = false;

  if (/driver/.test(name)) priority.push("driver-side", "side", "passenger-side");
  else if (/passenger/.test(name)) {
    priority.push("passenger-side", "side", "driver-side");
    if (!views["passenger-side"]) mirror = true;
  } else if (/hood/.test(name)) priority.push("hood_detail", "front");
  else if (/front.?bumper/.test(name)) priority.push("front");
  else if (/rear.?bumper/.test(name)) priority.push("rear");
  else if (/roof|top/.test(name)) priority.push("roof", "top");
  else if (/rear|trunk|tailgate/.test(name)) priority.push("rear");
  else priority.push("side", "driver-side", "front");

  for (const v of [...priority, "side", "driver-side", "front", "rear", "close-up"]) {
    if (views[v]) return { url: views[v], mirror };
  }
  return null;
}

// ── HTTP fetch → Uint8Array ─────────────────────────────────────────

// Rewrite a Supabase Storage object URL to the image-transform endpoint so the
// SERVER returns a pre-downscaled thumbnail. This is the fix for the 546 OOM:
// the proof per-side panels are 4K PNGs, and decoding several of them in
// imagescript on the 256MB Edge runtime crashes the worker. Fetching a ~512px
// thumbnail means Image.decode never sees more than ~1MB. Non-storage/external
// URLs pass through unchanged. (Same transform path used by panel-extract-v2.)
function toThumbUrl(url: string, w: number): string {
  if (!url || !url.includes("/storage/v1/object/")) return url;
  const rendered = url.replace("/storage/v1/object/", "/storage/v1/render/image/");
  const sep = rendered.includes("?") ? "&" : "?";
  // width + height + resize=contain is mandatory: a width-only transform is
  // served as a cover-crop against a default tall frame (the "vertical
  // sliver" bug), which distorts every panel pasted on the artboard.
  return `${rendered}${sep}width=${w}&height=${w}&resize=contain&quality=75`;
}

async function fetchBytes(url: string, maxBytes = 0): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      console.warn(`[FLAT] fetch ${url.slice(0, 60)}... -> ${r.status}`);
      return null;
    }
    // Decode budget: the transform endpoint refuses very large sources, and
    // the raw fallback can be a 50MB+ Topaz print file — decoding one of
    // those is an instant 546 on the 256MB worker. Placeholder beats crash.
    const len = Number(r.headers.get("content-length") || 0);
    if (maxBytes > 0 && len > maxBytes) {
      console.warn(`[FLAT] skip ${url.slice(0, 60)}... — ${len}B over decode budget`);
      await r.body?.cancel();
      return null;
    }
    return new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    console.warn(`[FLAT] fetch error: ${(e as Error).message}`);
    return null;
  }
}

// imagescript@1.2.15 has no Image.flip() — mirror horizontally in-place on the
// raw RGBA bitmap (passenger-side panels are mirrored driver-side views).
function mirrorH(img: Image): void {
  const w = img.width, h = img.height, bmp = img.bitmap;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w >> 1; x++) {
      const i = row + x * 4, j = row + (w - 1 - x) * 4;
      for (let k = 0; k < 4; k++) {
        const t = bmp[i + k];
        bmp[i + k] = bmp[j + k];
        bmp[j + k] = t;
      }
    }
  }
}

// ── Bitmap font (4x5, reused pattern from panelizer-step-template) ──

const FONT_4X5: Record<string, number[]> = {
  A: [0b0110, 0b1001, 0b1111, 0b1001, 0b1001],
  B: [0b1110, 0b1001, 0b1110, 0b1001, 0b1110],
  C: [0b0111, 0b1000, 0b1000, 0b1000, 0b0111],
  D: [0b1110, 0b1001, 0b1001, 0b1001, 0b1110],
  E: [0b1111, 0b1000, 0b1110, 0b1000, 0b1111],
  F: [0b1111, 0b1000, 0b1110, 0b1000, 0b1000],
  G: [0b0111, 0b1000, 0b1011, 0b1001, 0b0111],
  H: [0b1001, 0b1001, 0b1111, 0b1001, 0b1001],
  I: [0b1110, 0b0100, 0b0100, 0b0100, 0b1110],
  J: [0b0001, 0b0001, 0b0001, 0b1001, 0b0110],
  K: [0b1001, 0b1010, 0b1100, 0b1010, 0b1001],
  L: [0b1000, 0b1000, 0b1000, 0b1000, 0b1111],
  M: [0b1001, 0b1111, 0b1111, 0b1001, 0b1001],
  N: [0b1001, 0b1101, 0b1111, 0b1011, 0b1001],
  O: [0b0110, 0b1001, 0b1001, 0b1001, 0b0110],
  P: [0b1110, 0b1001, 0b1110, 0b1000, 0b1000],
  Q: [0b0110, 0b1001, 0b1001, 0b1010, 0b0101],
  R: [0b1110, 0b1001, 0b1110, 0b1010, 0b1001],
  S: [0b0111, 0b1000, 0b0110, 0b0001, 0b1110],
  T: [0b1111, 0b0100, 0b0100, 0b0100, 0b0100],
  U: [0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
  V: [0b1001, 0b1001, 0b1001, 0b0110, 0b0110],
  W: [0b1001, 0b1001, 0b1111, 0b1111, 0b1001],
  X: [0b1001, 0b1001, 0b0110, 0b1001, 0b1001],
  Y: [0b1001, 0b1001, 0b0110, 0b0100, 0b0100],
  Z: [0b1111, 0b0001, 0b0110, 0b1000, 0b1111],
  "0": [0b0110, 0b1001, 0b1001, 0b1001, 0b0110],
  "1": [0b0100, 0b1100, 0b0100, 0b0100, 0b1110],
  "2": [0b0110, 0b1001, 0b0010, 0b0100, 0b1111],
  "3": [0b1110, 0b0001, 0b0110, 0b0001, 0b1110],
  "4": [0b1001, 0b1001, 0b1111, 0b0001, 0b0001],
  "5": [0b1111, 0b1000, 0b1110, 0b0001, 0b1110],
  "6": [0b0111, 0b1000, 0b1110, 0b1001, 0b0110],
  "7": [0b1111, 0b0001, 0b0010, 0b0100, 0b0100],
  "8": [0b0110, 0b1001, 0b0110, 0b1001, 0b0110],
  "9": [0b0110, 0b1001, 0b0111, 0b0001, 0b1110],
  '"': [0b1010, 0b1010, 0b0000, 0b0000, 0b0000],
  " ": [0b0000, 0b0000, 0b0000, 0b0000, 0b0000],
  ".": [0b0000, 0b0000, 0b0000, 0b0000, 0b0100],
  "-": [0b0000, 0b0000, 0b1111, 0b0000, 0b0000],
  x: [0b0000, 0b1001, 0b0110, 0b1001, 0b0000],
  "(": [0b0010, 0b0100, 0b0100, 0b0100, 0b0010],
  ")": [0b0100, 0b0010, 0b0010, 0b0010, 0b0100],
  "/": [0b0001, 0b0010, 0b0100, 0b1000, 0b0000],
  "+": [0b0000, 0b0100, 0b1110, 0b0100, 0b0000],
  "#": [0b1010, 0b1111, 0b1010, 0b1111, 0b1010],
};

function textWidth(text: string, scale: number): number {
  return text.length * 5 * scale;
}

function drawText(img: Image, startX: number, startY: number, text: string, color: number, scale = 1) {
  let cx = startX;
  for (const ch of text) {
    const glyph = FONT_4X5[ch.toUpperCase()] || FONT_4X5[ch] || FONT_4X5[" "];
    if (!glyph) {
      cx += 5 * scale;
      continue;
    }
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 4; col++) {
        if (glyph[row] & (1 << (3 - col))) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + col * scale + sx;
              const py = startY + row * scale + sy;
              if (px >= 0 && px < img.width && py >= 0 && py < img.height) {
                img.setPixelAt(px + 1, py + 1, color);
              }
            }
          }
        }
      }
    }
    cx += 5 * scale;
  }
}

function drawRectOutline(img: Image, x: number, y: number, w: number, h: number, color: number, thickness: number) {
  for (let t = 0; t < thickness; t++) {
    for (let px = x; px < x + w; px++) {
      const topY = y + t;
      const botY = y + h - 1 - t;
      if (px >= 0 && px < img.width) {
        if (topY >= 0 && topY < img.height) img.setPixelAt(px + 1, topY + 1, color);
        if (botY >= 0 && botY < img.height) img.setPixelAt(px + 1, botY + 1, color);
      }
    }
    for (let py = y; py < y + h; py++) {
      const leftX = x + t;
      const rightX = x + w - 1 - t;
      if (py >= 0 && py < img.height) {
        if (leftX >= 0 && leftX < img.width) img.setPixelAt(leftX + 1, py + 1, color);
        if (rightX >= 0 && rightX < img.width) img.setPixelAt(rightX + 1, py + 1, color);
      }
    }
  }
}

function fillRect(img: Image, x: number, y: number, w: number, h: number, color: number) {
  for (let py = y; py < y + h && py < img.height; py++) {
    for (let px = x; px < x + w && px < img.width; px++) {
      if (px >= 0 && py >= 0) img.setPixelAt(px + 1, py + 1, color);
    }
  }
}

// ── Panel helpers ───────────────────────────────────────────────────

function autoSplitPanels(panels: PanelDim[]): PanelDim[] {
  const out: PanelDim[] = [];
  for (const p of panels) {
    const isSide = /side|driver|passenger/i.test(p.label) || /side|driver|passenger/i.test(p.panelKey);
    if (isSide && p.heightInches > MAX_TILE_INCHES) {
      const upperH = MAX_TILE_INCHES;
      const lowerH = Math.round((p.heightInches - MAX_TILE_INCHES + OVERLAP_INCHES) * 10) / 10;
      out.push({
        ...p,
        label: `${p.label} - Panel 1 (Upper)`,
        panelKey: `${p.panelKey}-panel1`,
        heightInches: upperH,
      });
      out.push({
        ...p,
        label: `${p.label} - Panel 2 (Lower)`,
        panelKey: `${p.panelKey}-panel2`,
        heightInches: lowerH,
      });
    } else {
      out.push({ ...p, heightInches: Math.min(p.heightInches, 59.5) });
    }
  }
  return out;
}

// ── Layout + compose ────────────────────────────────────────────────

/**
 * Strip vehicle body (tires, ground, studio) from a render view via ClipDrop remove-background.
 * Returns cleaned PNG bytes or null on failure.
 */
async function clipdropRemoveBg(imageBytes: Uint8Array): Promise<Uint8Array | null> {
  const apiKey = Deno.env.get("CLIPDROP_API_KEY");
  if (!apiKey) {
    console.warn("[FLAT] CLIPDROP_API_KEY not set — skipping background removal");
    return null;
  }

  try {
    const formData = new FormData();
    formData.append("image_file", new Blob([imageBytes], { type: "image/png" }), "input.png");

    const resp = await fetch("https://clipdrop-api.co/remove-background/v1", {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.warn(`[FLAT] ClipDrop remove-bg failed: ${resp.status}`);
      return null;
    }

    return new Uint8Array(await resp.arrayBuffer());
  } catch (e) {
    console.warn(`[FLAT] ClipDrop error: ${(e as Error).message}`);
    return null;
  }
}

async function composeArtboard(panels: PanelDim[], views: Record<string, string>, approvedRenderUrl: string): Promise<Uint8Array> {
  // Pre-fetch + decode every unique view ONCE.
  const viewCache = new Map<string, Image>();
  const uniqueUrls = new Set<string>();
  for (const url of Object.values(views)) {
    if (url) uniqueUrls.add(url);
  }
  if (uniqueUrls.size === 0 && approvedRenderUrl) uniqueUrls.add(approvedRenderUrl);

  // NOTE: ClipDrop remove-bg is disabled here — it causes OOM (546) on the
  // 256MB Edge Runtime when combined with multiple 4K images + canvas composition.
  // Background cleanup happens as a separate QC step ("Fill Panels" button)
  // which runs in its own function with its own memory budget.

  // Fetch and decode views ONE AT A TIME to stay under 256MB memory.
  // Each 4K PNG decodes to ~50MB in memory. Cap the total number of cached
  // views AND downscale aggressively — when both limits trip (a ton of
  // unique 4K views), decode spikes compound and the worker crashes, which
  // surfaces to the caller as an nginx 502.
  const MAX_VIEWS_CACHED = 7;
  // 800px keeps a 190"-wide side panel legible on the sheet; 7 views cached
  // at 800² RGBA ≈ 18MB, far inside the 256MB worker budget.
  const MAX_CACHE_DIM = 800;
  let cached = 0;
  for (const url of uniqueUrls) {
    if (cached >= MAX_VIEWS_CACHED) {
      console.warn(`[FLAT] Skipping remaining views — cache cap ${MAX_VIEWS_CACHED} reached`);
      break;
    }
    // Fetch a server-downscaled thumbnail first (prevents the 4K-decode OOM);
    // fall back to the original URL only if the transform endpoint fails AND
    // the original is small enough to decode safely.
    let bytes = await fetchBytes(toThumbUrl(url, MAX_CACHE_DIM));
    if (!bytes) bytes = await fetchBytes(url, 8_000_000);
    if (!bytes) continue;
    try {
      let img = await Image.decode(bytes);
      if (img.width > MAX_CACHE_DIM || img.height > MAX_CACHE_DIM) {
        const scale = MAX_CACHE_DIM / Math.max(img.width, img.height);
        img = img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
      }
      viewCache.set(url, img);
      cached++;
    } catch (e) {
      console.warn(`[FLAT] decode failed: ${(e as Error).message}`);
    }
  }

  const rows = groupPanels(panels);

  // Compute natural row dimensions in inches (including bleed, gaps).
  const rowDims = rows.map((row) => {
    let totalW = 0;
    let maxH = 0;
    for (const p of row) {
      const wb = p.widthInches + BLEED * 2;
      const hb = p.heightInches + BLEED * 2;
      totalW += wb;
      if (hb > maxH) maxH = hb;
    }
    const gapInInches = ((row.length - 1) * GAP_BETWEEN_PANELS) / 20;
    totalW += gapInInches;
    return { totalW, maxH, panels: row };
  });

  const naturalW = Math.max(...rowDims.map((r) => r.totalW));
  const naturalH = rowDims.reduce((s, r) => s + r.maxH, 0);
  const labelAllowance = (LABEL_H + ROW_GAP) * rowDims.length;

  // Size the canvas to the TRUE total panel inches, then pad to 21:9 and clamp.
  let cw = Math.round(naturalW * BASE_PX_PER_IN) + OUTER_PAD * 2;
  let ch = Math.round(naturalH * BASE_PX_PER_IN) + labelAllowance + OUTER_PAD * 2;
  // Expand the deficient axis to hit the 21:9 sheet aspect (content stays centered).
  if (cw / ch < SHEET_ASPECT) cw = Math.round(ch * SHEET_ASPECT);
  else ch = Math.round(cw / SHEET_ASPECT);
  // Clamp the long edge for the 256MB Edge runtime (21:9 ⇒ width is the long edge).
  if (cw > MAX_CANVAS_W) {
    cw = MAX_CANVAS_W;
    ch = Math.round(cw / SHEET_ASPECT);
  }

  const availW = cw - OUTER_PAD * 2;
  const availH = ch - OUTER_PAD * 2 - labelAllowance;
  const scale = Math.min(availW / naturalW, availH / naturalH);
  console.log(`[FLAT] Layout: canvas=${cw}×${ch} (21:9), naturalW=${naturalW.toFixed(1)}", naturalH=${naturalH.toFixed(1)}", scale=${scale.toFixed(2)}px/in, rows=${rows.length}`);

  const canvas = new Image(cw, ch);
  canvas.fill(BG_COLOR);

  let curY = OUTER_PAD;
  for (const row of rowDims) {
    const rowPxW = row.totalW * scale;
    const rowPxH = row.maxH * scale;
    let curX = Math.round((cw - rowPxW) / 2);

    for (const panel of row.panels) {
      const pW = Math.max(1, Math.round((panel.widthInches + BLEED * 2) * scale));
      const pH = Math.max(1, Math.round((panel.heightInches + BLEED * 2) * scale));

      const picked = pickViewUrl(panel, views);
      let pasted = false;
      if (picked) {
        const src = viewCache.get(picked.url);
        if (src) {
          // Aspect-preserving fit (contain), centered in the panel box. A raw
          // resize(pW, pH) stretches the art whenever the source aspect
          // differs from the box even slightly — combined with the sliver
          // thumbnails this was the "distorted like crazy" artboard.
          const fit = Math.min(pW / src.width, pH / src.height);
          const fw = Math.max(1, Math.round(src.width * fit));
          const fh = Math.max(1, Math.round(src.height * fit));
          const work = src.clone();
          work.resize(fw, fh);
          if (picked.mirror || panel.mirrored) mirrorH(work);
          fillRect(canvas, curX, curY, pW, pH, BG_COLOR);
          canvas.composite(work, curX + Math.round((pW - fw) / 2), curY + Math.round((pH - fh) / 2));
          pasted = true;
        }
      }
      if (!pasted) {
        fillRect(canvas, curX, curY, pW, pH, PLACEHOLDER_COLOR);
      }

      drawRectOutline(canvas, curX, curY, pW, pH, OUTLINE_COLOR, 3);

      const labelText = `${panel.label.toUpperCase()} ${panel.widthInches}"X${panel.heightInches}"`;
      const tw = textWidth(labelText, TEXT_SCALE);
      const tx = Math.round(curX + pW / 2 - tw / 2);
      const ty = curY + pH + 14;
      drawText(canvas, tx, ty, labelText, TEXT_COLOR, TEXT_SCALE);

      curX += pW + GAP_BETWEEN_PANELS;
    }

    curY += rowPxH + LABEL_H + ROW_GAP;
  }

  return await canvas.encode();
}

// ── Main handler ────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { job_id, vehicle_name, approved_render_url } = body;
    const allRenderUrls: Record<string, string> | undefined = body.allRenderUrls;
    const panels: PanelDim[] | undefined = body.panels;

    if (!job_id || !vehicle_name || !approved_render_url) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: job_id, vehicle_name, approved_render_url" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    console.log(`[FLAT] Starting: ${job_id} - ${vehicle_name}`);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: jobRow } = await sb
      .from("panelizer_jobs")
      .select("panels, vehicle_make, vehicle_model, vehicle_year, concept_json, all_view_urls")
      .eq("id", job_id)
      .single();

    // Resolve dimensions (same 4-tier fallback as generate-artboard-simple)
    let resolvedPanels: PanelDim[] | undefined;

    if (panels && panels.length > 0) {
      const hasRealDims = panels.some((p) => p.widthInches !== 172 && p.widthInches !== 173);
      if (hasRealDims) {
        resolvedPanels = panels.map((p: any) => ({
          label: p.label || p.panelKey || "Panel",
          panelKey: p.panelKey || p.id || p.label || "panel",
          widthInches: p.widthInches,
          heightInches: p.heightInches,
          mirrored: p.mirrored || false,
        }));
      }
    }

    if (!resolvedPanels && jobRow?.panels && Array.isArray(jobRow.panels) && jobRow.panels.length > 0) {
      const dbPanels = jobRow.panels as any[];
      const hasRealDims = dbPanels.some((p: any) => p.widthInches && p.widthInches !== 172 && p.widthInches !== 173);
      if (hasRealDims) {
        resolvedPanels = dbPanels.map((p: any) => ({
          label: p.label || p.panelKey || "Panel",
          panelKey: p.panelKey || p.id || p.label || "panel",
          widthInches: p.widthInches || 172,
          heightInches: p.heightInches || 59.5,
          mirrored: p.mirrored || false,
        }));
      }
    }

    if (!resolvedPanels) {
      const validateUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/panelizer-step-validate`;
      const vMake = jobRow?.vehicle_make || vehicle_name.split(" ").slice(1, -1).join(" ") || "";
      const vModel = jobRow?.vehicle_model || vehicle_name.split(" ").pop() || "";
      try {
        const valResp = await fetch(validateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            vehicleMake: vMake,
            vehicleModel: vModel,
            vehicleYear: jobRow?.vehicle_year || null,
            // Full vehicle name + design name so the validate step can detect
            // trailer / box-truck bodies (and parse the stated length).
            bodyText: `${vehicle_name || ""} ${(jobRow?.concept_json as any)?.design_name || ""}`.trim(),
            sideSize: "medium",
            addHood: true,
            addRear: true,
            addFrontBumper: true,
            addRearBumper: true,
            addRoof: true,
          }),
        });
        if (valResp.ok) {
          const valData = await valResp.json();
          if (valData.panels && valData.panels.length > 0) resolvedPanels = valData.panels;
        }
      } catch (e) {
        console.warn(`[FLAT] vehicle DB lookup failed: ${(e as Error).message}`);
      }
    }

    if (!resolvedPanels && panels && panels.length > 0) {
      resolvedPanels = panels.map((p: any) => ({
        label: p.label || p.panelKey || "Panel",
        panelKey: p.panelKey || p.id || p.label || "panel",
        widthInches: p.widthInches || 172,
        heightInches: p.heightInches || 59.5,
        mirrored: p.mirrored || false,
      }));
    }

    if (!resolvedPanels || resolvedPanels.length === 0) {
      throw new Error("No panel dimensions available — cannot generate artboard");
    }

    // Guarantee roof
    const hasRoof = resolvedPanels.some((p) => /roof/i.test(p.label || p.panelKey || ""));
    if (!hasRoof) {
      const sidePanel = resolvedPanels.find((p) => /side|driver|passenger/i.test(p.label || p.panelKey || ""));
      if (sidePanel) {
        const roofL = Math.round(sidePanel.widthInches * 0.62);
        const roofW = Math.round(sidePanel.heightInches * 0.9);
        resolvedPanels.push({ label: "Roof", panelKey: "roof", widthInches: roofL, heightInches: roofW, mirrored: false });
      }
    }

    resolvedPanels = autoSplitPanels(resolvedPanels);

    // Assemble view map (request body wins over job row; both supported)
    const views: Record<string, string> = {};
    const jobViews = jobRow?.all_view_urls && typeof jobRow.all_view_urls === "object" ? (jobRow.all_view_urls as Record<string, string>) : {};
    for (const [k, v] of Object.entries(jobViews)) if (v) views[k] = v as string;
    if (allRenderUrls) for (const [k, v] of Object.entries(allRenderUrls)) if (v) views[k] = v;
    console.log(`[FLAT] Resolved ${resolvedPanels.length} panels, ${Object.keys(views).length} views`);

    const storagePath = `artboards/${job_id}/artboard.png`;

    // Single deterministic path: math-compose 3D render views into panel
    // rectangles. No AI, no proof-image branching.
    const pngBytes = await composeArtboard(resolvedPanels, views, approved_render_url);

    const { error: uploadError } = await sb.storage.from(BUCKET).upload(storagePath, pngBytes, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: signedData } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
    const signedUrl = signedData?.signedUrl || "";

    const updatedCj = {
      ...(jobRow?.concept_json || {}),
      artboard_pages: 1,
      artboard_page_paths: [storagePath],
      artboard_page_urls: [signedUrl],
      artboard_stale: false,
      artboard_generator: "flat-deterministic",
    };
    const { error: statusErr } = await sb.from("panelizer_jobs").update({
      status: "pending_qc",
      panels: resolvedPanels,
      artboard_storage_path: storagePath,
      artboard_url: signedUrl || null,
      concept_json: updatedCj,
    }).eq("id", job_id);
    if (statusErr) console.error(`[FLAT] Failed to update status:`, statusErr.message);

    console.log(`[FLAT] Done! 1 page, ${resolvedPanels.length} panels, ${(pngBytes.byteLength / 1024).toFixed(0)} KB`);

    return new Response(
      JSON.stringify({
        success: true,
        artboard_url: signedUrl,
        storage_path: storagePath,
        artboard_urls: [signedUrl],
        artboard_pages: 1,
        vehicle_name,
        panels_count: resolvedPanels.length,
        panels: resolvedPanels,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[FLAT] Error:`, err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
