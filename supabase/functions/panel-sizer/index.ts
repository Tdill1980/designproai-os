/**
 * panel-sizer — deterministic per-panel PRINT SIZING. NO AI.
 *
 * Takes ONE flat design/artboard image + the vehicle's panel dimensions and, for
 * each panel, produces a properly-sized print file:
 *   - crops to the panel's TRUE aspect ratio (from real inches — nothing stretched)
 *   - includes the panel's content scaled to fill a 1" bleed on every side
 *   - scales to a print pixel target (inches x DPI, capped) and reports the
 *     physical size + effective DPI so it drops onto the production template at
 *     true print size
 *
 * This is geometry only — it never regenerates art and never flattens a 3D
 * render. Works on flat-first art (designpro-flat-art) OR any existing flat file.
 *
 * Self-contained single file. config.toml: [functions.panel-sizer] verify_jwt=false
 *
 * Request:  { imageUrl, vehicleMake?, vehicleModel?, vehicleYear?, bodyType?,
 *             dpi?, bleedInches?, panels?:[{label,w,h}], jobId? }
 * Response: { success, dpi, bleedInches, dimsSource,
 *             panels:[{label, trimWidthInches, trimHeightInches, bleedWidthInches,
 *                      bleedHeightInches, pixelW, pixelH, effectiveDpi, url}] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "wrap-files";
const DEFAULT_DPI = 150;
const DEFAULT_BLEED = 1;        // inches, per side
// px cap per panel. imagescript is pure-JS: a 6000px RGBA buffer + PNG encode
// blows the ~256MB edge memory ceiling → HTTP 546 WORKER_LIMIT (the function is
// killed mid-run). 3000px keeps every panel a useful true-aspect sizing preview
// while staying well inside memory. The final 300-DPI CMYK print files are
// produced by the Vercel slicer (process-production-pack), not here.
const MAX_EDGE = 3000;
// Working cap for the SOURCE: upscaling a flat design past this adds no real
// detail, so we downscale once up-front to slash per-panel clone/crop memory.
const SOURCE_MAX_EDGE = 3000;

function sb() { return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!); }
function json(b: unknown, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

interface PanelDims { sideW: number; sideH: number; roofW: number; roofL: number; backW: number; backH: number; hoodW: number; hoodL: number; }
const BODY_DEFAULTS: Record<string, PanelDims> = {
  sedan: { sideW: 170, sideH: 56, roofW: 50, roofL: 110, backW: 60, backH: 50, hoodW: 56, hoodL: 40 },
  suv:   { sideW: 200, sideH: 70, roofW: 54, roofL: 75,  backW: 66, backH: 60, hoodW: 60, hoodL: 42 },
  truck: { sideW: 210, sideH: 72, roofW: 50, roofL: 70,  backW: 66, backH: 56, hoodW: 62, hoodL: 46 },
  van:   { sideW: 220, sideH: 80, roofW: 60, roofL: 130, backW: 70, backH: 90, hoodW: 60, hoodL: 40 },
};

async function loadVehicleDims(make: string, model: string, year: string): Promise<{ dims: PanelDims | null; source: string }> {
  try {
    const yr = parseInt(year) || 0;
    const { data } = await sb()
      .from("vehicle_dimensions")
      .select("make,model,year_start,year_end,side_width,side_height,hood_width,hood_length,roof_width,roof_length,back_width,back_height")
      .ilike("make", make).ilike("model", `%${model}%`).limit(25);
    if (!data || !data.length) return { dims: null, source: "none" };
    const inRange = data.find((r: any) => yr && r.year_start && r.year_end && yr >= r.year_start && yr <= r.year_end);
    const r: any = inRange || data[0];
    if (!r?.side_width) return { dims: null, source: "none" };
    return {
      dims: {
        sideW: r.side_width, sideH: r.side_height,
        roofW: r.roof_width || 54, roofL: r.roof_length || 75,
        backW: r.back_width || 66, backH: r.back_height || 56,
        hoodW: r.hood_width || 60, hoodL: r.hood_length || 42,
      },
      source: inRange ? `vehicle_dimensions(${r.year_start}-${r.year_end})` : "vehicle_dimensions(nearest)",
    };
  } catch (e: any) { console.warn(`[SIZER] dims lookup failed: ${e?.message}`); return { dims: null, source: "error" }; }
}

interface Panel { label: string; w: number; h: number; }
function buildPanels(d: PanelDims): Panel[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  return [
    { label: "driver_side", w: r(d.sideW), h: r(d.sideH) },
    { label: "passenger_side", w: r(d.sideW), h: r(d.sideH) },
    { label: "hood", w: r(d.hoodW), h: r(d.hoodL) },
    { label: "roof", w: r(d.roofW), h: r(d.roofL) },
    { label: "front", w: r(d.backW), h: r(d.backH) },
    { label: "rear", w: r(d.backW), h: r(d.backH) },
  ];
}

// Cover-crop to a target aspect ratio (no scaling) — fills the frame, centered.
function coverCropToAspect(src: Image, targetAspect: number): Image {
  const c = src.clone();
  const sr = c.width / c.height;
  if (sr > targetAspect) {
    const cw = Math.max(1, Math.round(c.height * targetAspect));
    c.crop(Math.round((c.width - cw) / 2), 0, cw, c.height);
  } else {
    const ch = Math.max(1, Math.round(c.width / targetAspect));
    c.crop(0, Math.round((c.height - ch) / 2), c.width, ch);
  }
  return c;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const imageUrl: string = body.imageUrl || body.artboardUrl || body.designUrl || "";
    const dpi: number = Math.max(50, Math.min(300, parseInt(body.dpi) || DEFAULT_DPI));
    const bleed: number = body.bleedInches != null ? Number(body.bleedInches) : DEFAULT_BLEED;
    const bodyType: string = (body.bodyType || "truck").toLowerCase();
    const jobId: string = body.jobId || "";
    if (!imageUrl) return json({ success: false, error: "imageUrl required" }, 400);

    // Resolve panels: explicit override > vehicle_dimensions > body-type default
    let panels: Panel[];
    let dimsSource: string;
    if (Array.isArray(body.panels) && body.panels.length) {
      panels = body.panels.map((p: any) => ({ label: String(p.label || "panel").toLowerCase().replace(/\s+/g, "_"), w: Number(p.w || p.widthInches), h: Number(p.h || p.heightInches) }));
      dimsSource = "payload";
    } else {
      const look = await loadVehicleDims(body.vehicleMake || "", body.vehicleModel || "", String(body.vehicleYear || "2024"));
      const dims = { ...(BODY_DEFAULTS[bodyType] || BODY_DEFAULTS.truck), ...(look.dims || {}) };
      panels = buildPanels(dims);
      dimsSource = look.dims ? look.source : `default:${bodyType}`;
    }

    // Fetch the source flat design once.
    const r = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return json({ success: false, error: `Could not fetch source image (${r.status})` }, 502);
    const srcBytes = new Uint8Array(await r.arrayBuffer());
    let source = await Image.decode(srcBytes);
    // Downscale the source ONCE if it is larger than we ever need. This caps the
    // memory each per-panel clone/crop holds (the root cause of the 546 OOM) and
    // never costs real detail — every panel is cropped from this same source.
    const srcLongest = Math.max(source.width, source.height);
    if (srcLongest > SOURCE_MAX_EDGE) {
      const k = SOURCE_MAX_EDGE / srcLongest;
      source = source.resize(Math.round(source.width * k), Math.round(source.height * k));
    }
    console.log(`[SIZER] source ${source.width}x${source.height}, ${panels.length} panels @ ${dpi}dpi, ${bleed}" bleed`);

    const owner = (body.userId || "anon").toString();
    const dir = `panels/sized/${owner}/${jobId || Date.now()}`;
    const out: any[] = [];

    for (const p of panels) {
      if (!p.w || !p.h) { console.warn(`[SIZER] skip ${p.label}: missing dims`); continue; }
      const bw = p.w + 2 * bleed, bh = p.h + 2 * bleed;           // bleed-inclusive physical size
      const aspect = bw / bh;
      let pxW = Math.round(bw * dpi);
      let pxH = Math.round(bh * dpi);
      const longest = Math.max(pxW, pxH);
      if (longest > MAX_EDGE) { const k = MAX_EDGE / longest; pxW = Math.round(pxW * k); pxH = Math.round(pxH * k); }
      const effDpi = Math.round((pxW / bw) * 10) / 10;

      const panelImg = coverCropToAspect(source, aspect);
      panelImg.resize(pxW, pxH);
      const bytes = await panelImg.encode();

      const path = `${dir}/${p.label}_print.png`;
      const { error: upErr } = await sb().storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
      if (upErr) { console.error(`[SIZER] upload ${p.label} failed: ${upErr.message}`); continue; }
      const { data: signed } = await sb().storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);

      out.push({
        label: p.label,
        trimWidthInches: p.w, trimHeightInches: p.h,
        bleedWidthInches: Math.round(bw * 10) / 10, bleedHeightInches: Math.round(bh * 10) / 10,
        pixelW: pxW, pixelH: pxH, effectiveDpi: effDpi,
        url: signed?.signedUrl || "",
      });
      console.log(`[SIZER] ${p.label}: ${p.w}x${p.h}" (+${bleed}" bleed) -> ${pxW}x${pxH}px @ ${effDpi}dpi`);
    }

    if (!out.length) return json({ success: false, error: "No panels sized — check dimensions" }, 422);
    return json({ success: true, dpi, bleedInches: bleed, dimsSource, sourcePixels: { w: source.width, h: source.height }, panels: out });
  } catch (err: any) {
    console.error("[SIZER] error:", err?.message || err);
    return json({ success: false, error: err?.message || "panel-sizer failed" }, 500);
  }
});
