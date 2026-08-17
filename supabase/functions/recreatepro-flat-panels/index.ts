/**
 * recreatepro-flat-panels — RECREATEPRO engine: match an existing design EXACTLY.
 *
 * The counterpart to designpro-flat-art (which DESIGNS from a prompt). This
 * function only REPRODUCES: fed the customer's image (wrap photo, 3D render,
 * or 2D proof), it builds the flat-first pack anchored to that image:
 *
 *   step:"layers"      → 1. ELEMENTS pass — extract the logos / text / focal
 *                           graphics EXACTLY as they appear, painted on a pure
 *                           magenta knock-out → CODE chroma-key → guaranteed
 *                           transparent PNG overlay layer.
 *                        2. BACKGROUND pass — the design with those elements
 *                           removed, pattern continued seamlessly.
 *                        3. CODE composite — background + elements = combined
 *                           flat design (proves the layers reassemble 1:1).
 *   side:"DRIVER SIDE" → ONE print panel reproduced from ITS view of the
 *                        reference at true panel dims + bleed, temperature
 *                        0.15 (reproduction job — creativity is the enemy).
 *
 * The frontend drives one layers call + one call per panel so every edge
 * invocation stays small (the 546 worker-limit lesson).
 *
 * Model LOCKED to gemini-3-pro-image-preview (Flash fallback only).
 * config.toml:  [functions.recreatepro-flat-panels]  verify_jwt = false
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as b64encode, decode as b64decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "wrap-files";
const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_FALLBACK = "gemini-3.1-flash-image-preview";
const REPRO_TEMP = 0.0; // RECREATE MODE: deterministic — zero creativity
const REPRO_TOP_P = 1.0;

const _keys: string[] = [];
let _kl = false, _ki = 0;
function loadKeys() {
  if (_kl) return;
  const p = Deno.env.get("GOOGLE_AI_API_KEY"); if (p) _keys.push(p);
  for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) _keys.push(k); }
  _kl = true;
}
function geminiKey(): string { loadKeys(); if (!_keys.length) throw new Error("No GOOGLE_AI_API_KEY"); return _keys[_ki++ % _keys.length]; }
function sb() { return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!); }
function json(b: unknown, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

// ── Vehicle dimensions — same source as designpro-flat-art ──
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
  } catch (e: any) { console.warn(`[RECREATEPRO] dims lookup failed: ${e?.message}`); return { dims: null, source: "error" }; }
}
interface Panel { label: string; w: number; h: number; }
function buildPanels(d: PanelDims): Panel[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  return [
    { label: "DRIVER SIDE", w: r(d.sideW), h: r(d.sideH) },
    { label: "PASSENGER SIDE", w: r(d.sideW), h: r(d.sideH) },
    { label: "HOOD", w: r(d.hoodW), h: r(d.hoodL) },
    { label: "ROOF", w: r(d.roofW), h: r(d.roofL) },
    { label: "FRONT", w: r(d.backW), h: r(d.backH) },
    { label: "REAR", w: r(d.backW), h: r(d.backH) },
  ];
}

// ── PROMPTS — Gemini best practice: short, positive-first, one clear output
// instruction. Reproduction fidelity comes from the anchored reference image
// plus near-zero temperature, not from prompt length. ──
function persona(): string {
  return `You are a precise pre-press print production engine at WePrintWraps.com. You analyze approved vehicle wrap design references and isolate flat panel assets with zero artistic modification.

### Core Constraints
1. NO AI DRIFT: Maintain absolute alignment, scale, and spatial positions of all graphic elements exactly as seen in the reference anchor image.
2. TEMPERATURE ENFORCEMENT: Process with an implied temperature of 0.0. Do not invent new elements, shadows, lighting, or background patterns.
3. You reproduce; you never design.`;
}
function elementsPrompt(editNote = ""): string {
  const edit = editNote ? ` Apply ONLY this change and keep everything else identical: ${editNote}.` : "";
  return `From the attached approved vehicle wrap design, extract ONLY the graphic elements — logos, text lockups, phone numbers, website addresses, mascots and focal graphics — exactly as they appear: same shapes, colors, fonts, proportions and relative positions.${edit} Paint them over a solid pure magenta #FF00FF background, with pure magenta everywhere there is no element, so they can be cut out as a transparent overlay. Crisp edges, elements only.`;
}
function backgroundPrompt(): string {
  return `Reproduce the attached approved vehicle wrap design as ONE flat, full-bleed 2D background panel with the logos, text and focal graphics removed and the underlying pattern continued seamlessly where they were. Keep the exact colors, pattern, gradients and flow, edge to edge. Output the flat background artwork only.`;
}
// Stage 3 — Flat Panel Segmentation. Reproduce the WHOLE side faithfully —
// background pattern AND every graphic/logo/text that belongs on that panel.
// One view per call so focus stays bound to that exact flat aspect ratio.
function sidePrompt(side: string, finish: string): string {
  // The output must be the ARTWORK ITSELF filling the whole canvas — verified
  // failure modes without the hard framing below: a studio PHOTO of a panel
  // standing on a floor (wall + reflections + light streaks around it), a 3D
  // hood object on a white background, and wheel-arch CUT-OUTS showing the
  // background through the panel. A print file has none of those.
  return `Convert the ${side} of the attached approved vehicle wrap design into ONE flat 2D print file: a straight-on, orthographic sheet of printed vinyl artwork that fills 100% of the image canvas edge to edge. The artwork itself IS the entire image — pure flat graphics with zero perspective. No vehicle body, no panel object, no scene, no wall, no floor, no shadow, no reflection, no light streak, and no cut-outs: where wheel arches, windows, or trim would be, continue the SAME pattern seamlessly across that area. Keep EVERY graphic, logo, text, phone number, website and design element that belongs on this side: identical artwork, colors, fonts, sizes, positions, scale and flow as the reference. Do not blank, omit, simplify, relocate or restyle any graphic, and do not add anything that is not in the reference. If this side is partly hidden or angled in the reference, continue the SAME artwork naturally so the full panel is covered. Finish: ${finish}. Output only the flat print artwork filling the whole canvas.`;
}

// EDIT-flatten prompt (opt-in `editFlatten`). Used when the reference is the
// side's OWN approved view render (a hood/roof/front/rear photo on the vehicle)
// rather than the montage 2D proof. This is an EDIT pass — it de-vehicles the
// real pixels and flattens perspective, so it preserves the exact approved
// design instead of REPRODUCING it (which invented/chopped the hood). Same
// proven approach generate-2d-proof uses for the driver clean artboard.
function sideEditPrompt(side: string, finish: string): string {
  const s = side.toLowerCase();
  return `Take the attached ${s} view of an approved vehicle wrap and EDIT it into a PERFECTLY FLAT print file — do NOT redraw, restyle, reinvent, or add anything (no new colors, no gold, nothing not already present). Remove ALL vehicle parts and ALL vehicle GEOMETRY: the body, ${s} sheet-metal, cab, windows and glass, wheels, tires, bumpers, mirrors, lights, ground, and studio background — AND every panel seam, cut line, hood/roof crease, character line, raised contour, curvature, metal highlight, glare, reflection, and cast shadow. The surface must read as flat printed vinyl scanned straight off the printer: ZERO dimensionality, ZERO lighting, ZERO body lines — just the pure flat design. KEEP the ${s} wrap artwork EXACTLY as shown — identical colors, graphics, logo, company name, phone number, website, all lettering, gradients and flow — but lay it out dead-flat and straight-on. Extend the real design seamlessly to all four edges so the result is ONE continuous flat rectangle of the ${s} print artwork filling 100% of the canvas — no vehicle, no silhouette, no scene, no blank space, no cut-outs, no creases. Finish: ${finish}. Output only the flat ${s} print artwork.`;
}

// 21:9 removed — it produces a short "skinny" frame; 16:9 is the largest 4K canvas and gets cover-cropped to true panel dims downstream.
const _ASPECTS: Array<[string, number]> = [["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 0.75], ["9:16", 9 / 16]];
function nearestAspect(w: number, h: number): string {
  const t = w / h; let best = "16:9", d = Infinity;
  for (const [l, r] of _ASPECTS) { const e = Math.abs(r - t); if (e < d) { d = e; best = l; } }
  return best;
}

async function genImage(parts: any[], aspect: string, size: string): Promise<Uint8Array | null> {
  for (const model of [GEMINI_MODEL, GEMINI_MODEL, GEMINI_FALLBACK]) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: persona() }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: size }, temperature: REPRO_TEMP, topP: REPRO_TOP_P },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) { console.error(`[RECREATEPRO] ${model} HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`); continue; }
      const r = await resp.json();
      for (const part of (r?.candidates?.[0]?.content?.parts || [])) {
        if (part.inlineData?.data) return b64decode(part.inlineData.data);
      }
      console.error(`[RECREATEPRO] ${model} no image (finishReason ${r?.candidates?.[0]?.finishReason || "?"})`);
    } catch (e: any) { console.error(`[RECREATEPRO] ${model} ${e?.message}`); }
  }
  return null;
}

// ── Coordinate-locking pass: temperature 0 / top_p 1 / JSON-only output.
// Returns [{label, box_2d:[ymin,xmin,ymax,xmax]}] normalized 0-1000 so the
// server execution layer (imagescript) does the actual cropping — the model
// never touches pixels on this pass, eliminating drift.
async function genBoxes(parts: any[]): Promise<Array<{ label: string; box: number[] }>> {
  const prompt = `Analyze the reference image and locate all instances of high-contrast foreground graphics, logos, and typography intended for Layer 3 (isolated overlaid elements). Return a JSON object containing the exact normalized bounding boxes.

Expected Response Format:
{
  "elements": [
    {
      "label": "primary_phone_number",
      "box_2d": [ymin, xmin, ymax, xmax],
      "extraction_rationale": "Commercial text layer requiring isolated canvas cropping"
    }
  ]
}
Coordinates normalized to 0-1000. Return exclusively valid JSON.`;
  for (const model of [GEMINI_MODEL, GEMINI_FALLBACK]) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: persona() }] },
          contents: [{ role: "user", parts: [...parts, { text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT"], responseMimeType: "application/json", temperature: 0, topP: 1.0 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) { console.error(`[RECREATEPRO] boxes ${model} HTTP ${resp.status}`); continue; }
      const r = await resp.json();
      const txt = (r?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
      const parsed = JSON.parse(txt);
      const list = Array.isArray(parsed) ? parsed : parsed?.elements;
      if (Array.isArray(list)) {
        return list
          .map((b: any) => ({ label: String(b.label || "element"), box: b.box_2d || b.box || [] }))
          .filter((b) => Array.isArray(b.box) && b.box.length === 4);
      }
    } catch (e: any) { console.error(`[RECREATEPRO] boxes ${model} ${e?.message}`); }
  }
  return [];
}

// Distance-based key with a soft ramp (not a hard on/off cutoff) so
// anti-aliased edge pixels — the blend between pure magenta and the real
// logo color — fade to transparent instead of staying opaque with a visible
// pink/magenta fringe ("should not have pink line", verified live 2026-07-27
// on the Flamingo Pools logo: the old binary threshold left a solid pink
// outline around every letter). Also despills the residual magenta tint out
// of the ramp-zone pixels' own color so the fading edge doesn't just fade a
// pink halo to transparent — it stops being pink first.
function chromaKeyMagenta(img: Image): Image {
  const KEY_R = 255, KEY_G = 0, KEY_B = 255;
  const FULL_KEY_DIST = 70;  // within this RGB distance of pure magenta: fully transparent
  const NO_KEY_DIST = 200;   // beyond this distance: untouched, real content
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  for (const [x, y, color] of img.iterateWithColors()) {
    const r = (color >>> 24) & 0xff, g = (color >>> 16) & 0xff, b = (color >>> 8) & 0xff, a = color & 0xff;
    const dr = r - KEY_R, dg = g - KEY_G, db = b - KEY_B;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= FULL_KEY_DIST) { img.setPixelAt(x, y, 0x00000000); continue; }
    if (dist >= NO_KEY_DIST) continue; // far from magenta — real content, untouched
    const t = (dist - FULL_KEY_DIST) / (NO_KEY_DIST - FULL_KEY_DIST); // 0 (near magenta) .. 1 (real content)
    const spill = 1 - t;
    const nr = clamp(Math.round(r - (r - g) * spill * 0.6));
    const nb = clamp(Math.round(b - (b - g) * spill * 0.6));
    const newA = Math.round(a * t);
    img.setPixelAt(x, y, ((nr << 24) | (g << 16) | (nb << 8) | newA) >>> 0);
  }
  return img;
}

function coverCrop(src: Image, tw: number, th: number): Image {
  const c = src.clone();
  const sr = c.width / c.height, tr = tw / th;
  let cw: number, ch: number, cx: number, cy: number;
  if (sr > tr) { ch = c.height; cw = Math.max(1, Math.round(ch * tr)); cx = Math.round((c.width - cw) / 2); cy = 0; }
  else { cw = c.width; ch = Math.max(1, Math.round(cw / tr)); cx = 0; cy = Math.round((c.height - ch) / 2); }
  c.crop(cx, cy, cw, ch);
  c.resize(tw, th);
  return c;
}

// CONTAIN-FIT + EDGE-EXTEND — the print-panel sizer that NEVER slices the design
// (replaces coverCrop for the per-side panel; 2026-07-25, "front and hood cropped
// wrong").
//
// coverCrop scaled the generated artwork to COVER the target aspect and cropped
// the overflow. Because the model fills its canvas edge-to-edge at only a COARSE
// nearest aspect (16:9 / 1:1 / 4:3 …), any panel whose TRUE aspect is far from
// that gets real artwork sliced off: a FRONT bumper is very wide + short (~3:1) so
// a 16:9 source is cover-cropped in HEIGHT → its top & bottom are cut; a HOOD is
// near-square so a 16:9 source is cover-cropped in WIDTH → its sides are cut. The
// 5" bleed did not protect it because the crop target already includes the bleed.
//
// Instead: scale the WHOLE artwork to FIT inside the target (contain — zero
// content lost), center it, and fill the leftover margin by extending the fitted
// design's edge pixels (the natural print bleed). Contain-fit always touches two
// opposite edges exactly, so only ONE axis ever has a margin (the other branch is
// a no-op) — no corners to reconcile. This is the CORE PRINT RULE: fill the trim,
// extend for bleed, never crop the design.
function containExtend(src: Image, tw: number, th: number): Image {
  const sw = src.width, sh = src.height;
  const scale = Math.min(tw / sw, th / sh);
  const fw = Math.max(1, Math.round(sw * scale));
  const fh = Math.max(1, Math.round(sh * scale));
  const fitted = src.clone().resize(fw, fh);
  const out = new Image(tw, th);
  const ox = Math.floor((tw - fw) / 2);
  const oy = Math.floor((th - fh) / 2);

  // Horizontal bleed (design narrower than target): stretch the fitted design's
  // left/right edge columns across the side gaps. When this branch runs oy === 0
  // (contain bound by width), so the columns span the full height.
  if (ox > 0) {
    const rightW = tw - fw - ox;
    const leftCol = fitted.clone().crop(0, 0, 1, fh).resize(ox, fh);
    out.composite(leftCol, 0, oy);
    if (rightW > 0) {
      const rightCol = fitted.clone().crop(fw - 1, 0, 1, fh).resize(rightW, fh);
      out.composite(rightCol, ox + fw, oy);
    }
  }

  // The full fitted artwork — composited whole, never cropped.
  out.composite(fitted, ox, oy);

  // Vertical bleed (design shorter than target): stretch the top/bottom edge rows
  // across the full width (ox === 0 here, so the center band is already full-width).
  if (oy > 0) {
    const botH = th - fh - oy;
    const band = out.clone().crop(0, oy, tw, fh);
    const topRow = band.clone().crop(0, 0, tw, 1).resize(tw, oy);
    out.composite(topRow, 0, 0);
    if (botH > 0) {
      const botRow = band.clone().crop(0, fh - 1, tw, 1).resize(tw, botH);
      out.composite(botRow, 0, oy + fh);
    }
  }

  return out;
}

async function fetchRefB64(url: string): Promise<{ b64: string; mime: string }> {
  // Pull Supabase-hosted references DOWNSCALED through the storage
  // image-transform (2048px) — the raw hero renders are 4K PNGs (10-30MB);
  // base64-ing those in this worker was the remaining 546 OOM after the
  // output side was capped to 2K. 2048 is plenty for Gemini to read the
  // design (same lesson as cut-graphics-proof). Falls back to the raw URL
  // for non-Supabase images or if the transform endpoint rejects it.
  let fetchUrl = url;
  if (url.includes("/storage/v1/object/public/")) {
    fetchUrl = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")
      + (url.includes("?") ? "&" : "?") + "width=2048&height=2048&resize=contain";
  }
  let rr = await fetch(fetchUrl, { signal: AbortSignal.timeout(30_000) });
  if (!rr.ok && fetchUrl !== url) {
    rr = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  }
  if (!rr.ok) throw new Error(`reference fetch ${rr.status}`);
  return { b64: b64encode(new Uint8Array(await rr.arrayBuffer())), mime: rr.headers.get("content-type") || "image/png" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const referenceImageUrl: string = (body.referenceImageUrl || "").trim();
    const vehicleYear = String(body.vehicleYear || "2024");
    const vehicleMake: string = (body.vehicleMake || "").trim();
    const vehicleModel: string = (body.vehicleModel || "").trim();
    const bodyType: string = (body.bodyType || "truck").toLowerCase();
    const finish: string = body.finish || "Gloss";
    const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 2;
    // EDIT-flatten mode (opt-in): the reference is the side's OWN view render, so
    // de-vehicle + flatten the real pixels instead of reproducing from the proof.
    const editFlatten: boolean = body.editFlatten === true || body.mode === "edit";
    const runTag: string = body.runId || String(Date.now());
    // Edit/revision instruction (e.g. "change the phone number to 555-1234").
    // Applied to side panels AND the editable elements overlay so revisions
    // actually change the artwork instead of re-reproducing the original.
    const editNote: string = (body.editNote || "").toString().trim();

    if (!referenceImageUrl) return json({ success: false, error: "referenceImageUrl is required" }, 400);
    if (!vehicleMake || !vehicleModel) return json({ success: false, error: "vehicleMake and vehicleModel required" }, 400);

    let userId: string = body.userId || "";
    if (!userId) {
      const ah = req.headers.get("Authorization");
      if (ah?.startsWith("Bearer ")) { try { const { data: { user } } = await sb().auth.getUser(ah.replace("Bearer ", "")); if (user) userId = user.id; } catch { /**/ } }
    }
    const owner = userId || "anon";
    const dir = `recreatepro/${owner}/${runTag}`;
    const up = async (name: string, bytes: Uint8Array): Promise<string> => {
      const { error } = await sb().storage.from(BUCKET).upload(`${dir}/${name}`, bytes, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`upload ${name}: ${error.message}`);
      const { data } = await sb().storage.from(BUCKET).createSignedUrl(`${dir}/${name}`, 60 * 60 * 24 * 365);
      return data?.signedUrl || "";
    };

    const dbLookup = await loadVehicleDims(vehicleMake, vehicleModel, vehicleYear);
    const dims: PanelDims = { ...(BODY_DEFAULTS[bodyType] || BODY_DEFAULTS.truck), ...(dbLookup.dims || {}) };
    const dimsSource = dbLookup.dims ? dbLookup.source : `default:${bodyType}`;
    const panels = buildPanels(dims);
    const ref = await fetchRefB64(referenceImageUrl);
    const refPart = { inlineData: { mimeType: ref.mime, data: ref.b64 } };

    // ── MODE A: one print panel, reproduced from ITS view of the reference ──
    const sideReq: string = (body.side || "").toString().trim();
    if (sideReq) {
      const panel = panels.find((p) => p.label.toUpperCase() === sideReq.toUpperCase())
        || { label: sideReq.toUpperCase(), w: Number(body.panelW) || 200, h: Number(body.panelH) || 60 };
      const bw = panel.w + 2 * bleed, bh = panel.h + 2 * bleed;
      const promptText = (editFlatten ? sideEditPrompt(panel.label, finish) : sidePrompt(panel.label, finish)) + (editNote ? ` MINOR EDIT — apply ONLY this change, keep everything else identical: ${editNote}` : "");
      // FEW-SHOT FORMAT ANCHORS (the Universal Panelizer training images, same
      // set the protected panelizer-step-fill uses). Without examples the model
      // flip-flops on FRAMING run to run — verified live: one run returned a
      // studio photo of a panel on a floor, the next returned the whole car
      // photo. Examples teach the output FORMAT (flat full-bleed artwork);
      // prompt words alone do not. Non-fatal if an example fails to load.
      const EXAMPLES_BASE = `${Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co"}/storage/v1/render/image/public/${BUCKET}/genie-examples`;
      const exampleParts: any[] = [];
      for (const [file, label] of [
        ["04-production-flow-before-after.png", "EXAMPLE — a 3D vehicle render (left) converted to its flat print panel (right):"],
        ["05-golden-flat-panel-output.png", "EXAMPLE — the CORRECT output format: flat print artwork filling the whole canvas, no vehicle, no scene:"],
      ] as const) {
        try {
          const ex = await fetchRefB64(`${EXAMPLES_BASE}/${file}?width=1024&height=1024&resize=contain`);
          exampleParts.push({ text: label }, { inlineData: { mimeType: ex.mime, data: ex.b64 } });
        } catch (e) { console.warn(`[RECREATEPRO] example ${file} skipped: ${e}`); }
      }
      // 2K, NOT 4K: the output is code-capped to ≤2048px below anyway (working
      // resolution — print pixels come from the worker/upscaler at buy time),
      // and decoding a 4K Gemini PNG in this worker is what blew the 256MB
      // limit (546) on every side after the first. 2K halves decode memory
      // with zero loss in the shipped panel.
      const bytes = await genImage(
        editFlatten
          // EDIT-flatten: feed ONLY the side's own view + the de-vehicle edit
          // instruction. No few-shot "reproduce" examples — those teach the
          // reproduce format and would pull the model off the real pixels.
          ? [refPart, { text: promptText }]
          : [...exampleParts, { text: "REFERENCE — reproduce THIS side's artwork in the flat format shown above:" }, refPart, { text: promptText }],
        nearestAspect(bw, bh), "2K",
      );
      if (!bytes) return json({ success: false, error: `${panel.label} reproduction failed — retry` }, 502);
      // AI output is ~2K — cap there; upscaling adds memory (546), not detail.
      let pxW = Math.round(bw * 150), pxH = Math.round(bh * 150);
      const longest = Math.max(pxW, pxH);
      if (longest > 2048) { const k = 2048 / longest; pxW = Math.round(pxW * k); pxH = Math.round(pxH * k); }
      // ADAPTIVE GREY-BORDER TRIM — the residual studio frame VARIES run to
      // run (a fixed 3.5% shave was beaten by a thicker border on the next
      // build). Scan inward from each edge and trim while rows/columns are
      // predominantly desaturated grey (the studio wall/floor), capped at 10%
      // per edge, minimum 2% shave. Pure pixel math; the panel carries a
      // generated 5" bleed so no real content is lost.
      const dec = await Image.decode(bytes);
      const isGrey = (px: number): boolean => {
        // Chroma tolerance 48 (not 24): the studio wall reads as WARM grey /
        // beige in many renders (r>g>b spread ~30-40), which a strict test
        // missed — leaving the border untouched. Wrap artwork rows are either
        // near-black (<30) or saturated gold (spread >48), so 48 separates
        // wall from art cleanly.
        const r = (px >> 24) & 0xff, g = (px >> 16) & 0xff, b = (px >> 8) & 0xff;
        const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
        return (hi - lo) <= 48 && hi >= 30 && hi <= 235;
      };
      const greyFrac = (horizontal: boolean, idx: number): number => {
        let grey = 0, n = 0;
        const len = horizontal ? dec.width : dec.height;
        for (let i = 0; i < len; i += 4) {
          const px = horizontal ? dec.getPixelAt(i + 1, idx + 1) : dec.getPixelAt(idx + 1, i + 1);
          n++; if (isGrey(px)) grey++;
        }
        return n ? grey / n : 0;
      };
      const scanTrim = (horizontal: boolean, fromEnd: boolean): number => {
        const size = horizontal ? dec.height : dec.width;
        const capPx = Math.floor(size * 0.12);
        let cut = 0;
        for (let s = 0; s < capPx; s++) {
          const idx = fromEnd ? size - 1 - s : s;
          if (greyFrac(horizontal, idx) > 0.6) cut = s + 1; else break;
        }
        // 4% floor: verified across builds — the model leaves at least a thin
        // frame most runs even when the scan can't classify it.
        return Math.max(cut, Math.floor(size * 0.04));
      };
      const tTop = scanTrim(true, false), tBottom = scanTrim(true, true);
      const tLeft = scanTrim(false, false), tRight = scanTrim(false, true);
      dec.crop(tLeft, tTop, dec.width - tLeft - tRight, dec.height - tTop - tBottom);
      // CONTAIN-FIT + EDGE-EXTEND (not coverCrop): fit the WHOLE side artwork into
      // the panel and synthesize the bleed margin from the edge pixels, so no real
      // design is ever sliced — the fix for FRONT (top/bottom cut) and HOOD (sides
      // cut). See containExtend.
      const sized = containExtend(dec, pxW, pxH);
      const fname = `panels/${panel.label.toLowerCase().replace(/\s+/g, "-")}.png`;
      const url = await up(fname, await sized.encode());
      console.log(`[RECREATEPRO] side ${panel.label} ${pxW}x${pxH}`);
      return json({
        success: true, side: panel.label, url,
        trimWidthInches: panel.w, trimHeightInches: panel.h,
        bleedWidthInches: bw, bleedHeightInches: bh,
        pixelW: pxW, pixelH: pxH, effectiveDpi: Math.round((pxW / bw) * 10) / 10,
        dimsSource,
      });
    }

    // ── MODE B (default, step:"layers"): transparent elements + clean
    // background + code composite — the editable layer set, matched 1:1 ──
    // 2K, NOT 4K: decoding + compositing two 4K Gemini PNGs (elements + background)
    // in one worker invocation is the same 256MB limit (546) that hit
    // generate-2d-proof and Mode A above — verified live 2026-07-27 (a real call
    // 546'd at 70s). 2K halves decode memory with no loss to the shipped panel
    // (print resolution comes from the downstream gridslice + upscaler, not this
    // origin image, same as every other clean-artboard source in this pipeline).
    const elBytes = await genImage([refPart, { text: elementsPrompt(editNote) }], "16:9", "2K");
    const bgBytes = await genImage([refPart, { text: backgroundPrompt() }], "16:9", "2K");
    if (!bgBytes) return json({ success: false, error: "Background reproduction failed — retry" }, 502);

    const background = await Image.decode(bgBytes);
    let elementsLayer: Image | null = null;
    const combined = background.clone();
    if (elBytes) {
      elementsLayer = chromaKeyMagenta(await Image.decode(elBytes));
      if (elementsLayer.width !== background.width || elementsLayer.height !== background.height) {
        elementsLayer.resize(background.width, background.height);
      }
      combined.composite(elementsLayer, 0, 0);
    }

    const backgroundUrl = await up("background.png", bgBytes);
    const elementsUrl = elementsLayer ? await up("elements.png", await elementsLayer.encode()) : "";
    const combinedUrl = await up("combined.png", await combined.encode());

    // ── Coordinate locking: deterministic JSON boxes → CODE crops each
    // isolated overlay element from the transparent layer. ──
    const elementCrops: Array<{ label: string; box: number[]; url: string }> = [];
    if (elementsLayer) {
      const boxes = await genBoxes([refPart]);
      for (let i = 0; i < Math.min(boxes.length, 8); i++) {
        const [ymin, xmin, ymax, xmax] = boxes[i].box.map((v: number) => Math.max(0, Math.min(1000, Number(v) || 0)));
        const x = Math.round((xmin / 1000) * elementsLayer.width);
        const y = Math.round((ymin / 1000) * elementsLayer.height);
        const w = Math.min(Math.round(((xmax - xmin) / 1000) * elementsLayer.width), elementsLayer.width - x);
        const h = Math.min(Math.round(((ymax - ymin) / 1000) * elementsLayer.height), elementsLayer.height - y);
        if (w < 8 || h < 8) continue;
        try {
          const crop = elementsLayer.clone().crop(x, y, w, h);
          const url = await up(`elements/element-${i + 1}.png`, await crop.encode());
          elementCrops.push({ label: boxes[i].label, box: [ymin, xmin, ymax, xmax], url });
        } catch (e: any) { console.warn(`[RECREATEPRO] crop ${i + 1} skipped: ${e?.message}`); }
      }
    }

    console.log(`[RECREATEPRO] layers done — bg + ${elementsLayer ? "elements" : "(no elements)"} + ${elementCrops.length} coordinate-locked crops (${dimsSource})`);
    return json({
      success: true,
      backgroundUrl, elementsUrl, combinedUrl,
      elementCrops,
      hadElements: !!elementsLayer,
      dimsSource,
      panels: panels.map((p) => ({ label: p.label, widthInches: p.w, heightInches: p.h })),
    });
  } catch (err: any) {
    console.error("[RECREATEPRO] error:", err?.message || err);
    return json({ success: false, error: err?.message || "recreatepro-flat-panels failed" }, 500);
  }
});
