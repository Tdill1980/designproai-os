/**
 * panelize-artboard — DETERMINISTIC pixel-match panel slicer.
 *
 * The flat master artboard ("ALL PANELS @ ACTUAL SIZE") is the source of truth.
 * Gemini is used ONLY as a coordinate engine (temperature 0, JSON bounding boxes)
 * to locate each panel's rectangle on the artboard. The actual slicing is then
 * done in code (ImageScript) — crop the EXACT pixels, resize to the panel's true
 * aspect, fill to a 2" full bleed. No re-painting, so zero AI drift: the output is
 * the same artwork that was approved.
 *
 * Body: { artboardUrl, jobId, bleedIn?, panels:[{side, dimW, dimH}] }
 * Returns: { success, panels:[{side, panelUrl, box}] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const _pool: string[] = [];
let _loaded = false, _idx = 0;
function getKey(): string {
  if (!_loaded) {
    const p = Deno.env.get("GOOGLE_AI_API_KEY"); if (p) _pool.push(p);
    for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) _pool.push(k); }
    _loaded = true;
  }
  if (!_pool.length) throw new Error("No GOOGLE_AI_API_KEY");
  return _pool[_idx++ % _pool.length];
}

// Normalize a side label to match Gemini's detected labels.
function norm(s: string): string { return String(s).toLowerCase().replace(/[^a-z]/g, ""); }
const SIDE_ALIASES: Record<string, string[]> = {
  "DRIVER SIDE": ["driverside", "driver", "leftside", "left"],
  "PASSENGER SIDE": ["passengerside", "passenger", "right"],
  "HOOD": ["hood"],
  "ROOF": ["roof", "top", "toproof"],
  "FRONT": ["front", "frontbumper", "frontview"],
  "REAR": ["rear", "rearbumper", "back", "rearview"],
};

// Gemini coordinate engine — temp 0, JSON. Returns 0-1000 normalized boxes.
// `wantSides` is the list of panels the caller needs (e.g. DRIVER SIDE, HOOD,
// ROOF, FRONT, REAR). It is fed into the prompt so Gemini identifies each view
// by the vehicle's ORIENTATION and returns one labeled box PER requested panel.
// Root cause it fixes: on a 2D production PROOF the small tiles (hood/roof/front/
// rear) carry no per-tile text label, so the old generic prompt returned boxes
// with BLANK labels for them (detected: ['driverside','passengerside','','','']),
// every small side then failed to match ("panel not located") and the atomic
// build discarded all six panels.
async function detectBoxes(b64: string, mime: string, wantSides: string[] = []): Promise<Array<{ label: string; box: number[] }>> {
  const requested = (wantSides.length ? wantSides : ["Driver Side", "Passenger Side", "Hood", "Roof", "Front", "Rear"])
    .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim());
  const list = requested.join(", ");
  const prompt = `This image is a FLAT vehicle-wrap PRODUCTION PROOF SHEET. It shows the SAME vehicle drawn as several flat orthographic views arranged on a white sheet. Identify each view by the vehicle's ORIENTATION and return the bounding box of that view's wrap ARTWORK rectangle — the COMPLETE painted design from its LEFT edge to its RIGHT edge and TOP to BOTTOM. Include every part of the artwork that touches the panel edges. Do NOT crop the design in from its edges. Exclude ONLY the text labels, dimension lines/arrows, the title bar, and the empty white sheet margin between views.

Identify each view by orientation (the tiles are NOT text-labeled — use the vehicle's pose):
- Driver Side / Passenger Side = the long side PROFILE views (full length, wheels and doors visible). There are usually two nearly identical ones; treat the upper/left as Driver Side and the other as Passenger Side.
- Roof = the OVERHEAD / top-down view (looking straight down on the roof).
- Front = the FRONT-FACING view (grille, headlights, windshield seen head-on).
- Rear = the REAR-FACING view (tail lights / rear doors seen from behind).
- Hood = the hood panel (top of the front end), when present.

Return EXACTLY one box for EACH of these requested panels: ${list}. Assign every requested panel to its matching view by orientation and position — NEVER leave a label blank and NEVER omit a requested panel. If two candidates look alike, use position (top/left = Driver Side).
Respond with ONLY this JSON (box_2d is [ymin,xmin,ymax,xmax] normalized 0-1000):
{"panels":[{"label":"Driver Side","box_2d":[0,0,0,0]}]}`;
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
        generationConfig: { responseModalities: ["TEXT"], temperature: 0, topP: 1 },
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!resp.ok) throw new Error(`Gemini detect ${resp.status}`);
  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return (json.panels || []).map((p: any) => ({ label: norm(p.label || ""), box: p.box_2d || p.box || [] }));
}

function b64encode(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))));
  return btoa(s);
}

type Box = [number, number, number, number];
type ManifestBoxes = Record<string, Box>;

function isValidBox(value: unknown): value is Box {
  if (!Array.isArray(value) || value.length < 4) return false;
  const box = value.slice(0, 4).map(Number);
  return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1];
}

function canonicalSide(label: string): string | null {
  const normalized = norm(label);
  for (const [side, aliases] of Object.entries(SIDE_ALIASES)) {
    if (aliases.includes(normalized) || aliases.some((alias) =>
      normalized.length >= 4 && (normalized.includes(alias) || alias.includes(normalized))
    )) return side;
  }
  return null;
}

function readManifestBoxes(input: unknown): ManifestBoxes {
  const value = input && typeof input === "object" && "boxes" in input
    ? (input as { boxes?: unknown }).boxes
    : input;
  const entries = Array.isArray(value)
    ? value.map((item: any) => [item?.side || item?.label, item?.box || item?.box_2d])
    : Object.entries(value && typeof value === "object" ? value as Record<string, unknown> : {});
  const boxes: ManifestBoxes = {};
  for (const [label, candidate] of entries) {
    const side = canonicalSide(String(label || ""));
    if (side && isValidBox(candidate)) boxes[side] = candidate.slice(0, 4).map(Number) as Box;
  }
  return boxes;
}

function boxesToArray(boxes: ManifestBoxes): Array<{ label: string; box: number[] }> {
  return Object.entries(boxes).map(([side, box]) => ({ label: norm(side), box }));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// flipH / flipV — in-place mirrors (used to build the mirror bleed border).
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
// mirrorExtend — add a `b`-px bleed border by MIRRORING the design's own edges
// outward (the print-shop "mirror bleed"). NO crop of the design, NO AI: the full
// `src` sits centered and the border is a reflection of its outer pixels, so the
// artwork runs cleanly past the cut line on every side. Deterministic.
function mirrorExtend(src: any, b: number): any {
  if (!(b > 0)) return src;
  const w = src.width, h = src.height;
  const bw = Math.min(b, w), bh = Math.min(b, h);   // guard tiny panels
  const out = new Image(w + 2 * b, h + 2 * b);
  out.composite(src, b, b);                                  // full design, centered
  const hStrip = (x0: number) => { const s = src.clone().crop(x0, 0, bw, h); flipH(s); return s; };
  const vStrip = (y0: number) => { const s = src.clone().crop(0, y0, w, bh); flipV(s); return s; };
  out.composite(hStrip(0), b - bw, b);                       // left  edge mirrored
  out.composite(hStrip(w - bw), w + b, b);                   // right edge mirrored
  out.composite(vStrip(0), b, b - bh);                       // top   edge mirrored
  out.composite(vStrip(h - bh), b, h + b);                   // bottom edge mirrored
  const corner = (x0: number, y0: number) => { const s = src.clone().crop(x0, y0, bw, bh); flipH(s); flipV(s); return s; };
  out.composite(corner(0, 0), b - bw, b - bh);               // 4 corners mirrored both ways
  out.composite(corner(w - bw, 0), w + b, b - bh);
  out.composite(corner(0, h - bh), b - bw, h + b);
  out.composite(corner(w - bw, h - bh), w + b, h + b);
  return out;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { artboardUrl, jobId, bleedIn = 5, panels, panelManifest, manifest } = await req.json();
    if (!artboardUrl || !Array.isArray(panels) || !panels.length) {
      return new Response(JSON.stringify({ success: false, error: "Missing artboardUrl or panels" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch + decode the artboard. Cap working size to keep edge memory sane
    // (this is the pixel-match SOURCE-res crop; print-res upscaling is a later step).
    const r = await fetch(artboardUrl, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return new Response(JSON.stringify({ success: false, error: `fetch artboard ${r.status}`, stage: "fetch" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const srcBytes = new Uint8Array(await r.arrayBuffer());
    const mime = r.headers.get("content-type") || "image/png";
    const sourceKey = await sha256Hex(srcBytes);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const wantSides = panels.map((p: any) => String(p.side || "")).filter(Boolean);
    // Match a requested side to a detected box (alias-aware) AND require a valid
    // 4-number box — a degenerate/empty box does not count as located.
    const locate = (side: string, bxs: Array<{ label: string; box: number[] }>) => {
      const aliases = SIDE_ALIASES[side.toUpperCase()] || [norm(side)];
      const exact = bxs.find((b) => b.box.length >= 4 && aliases.includes(b.label));
      return exact || bxs.find((b) => b.box.length >= 4 && aliases.some((a) => b.label.length >= 4 && (b.label.includes(a) || a.includes(b.label)))) || null;
    };
    let manifestBoxes = readManifestBoxes(panelManifest || manifest);
    let manifestSource = Object.keys(manifestBoxes).length ? "provided" : "none";
    const hasAllWantedSides = () => wantSides.every((side) => {
      const canonical = canonicalSide(side);
      return canonical ? Boolean(manifestBoxes[canonical]) : false;
    });

    // A caller-supplied manifest is authoritative. Otherwise reuse the immutable
    // manifest stored for the exact source pixels before asking Gemini anything.
    if (!hasAllWantedSides()) {
      const { data: persisted, error: manifestReadError } = await db
        .from("designpro_panel_manifests")
        .select("boxes")
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (!manifestReadError && persisted?.boxes) {
        manifestBoxes = { ...readManifestBoxes(persisted.boxes), ...manifestBoxes };
        if (hasAllWantedSides()) manifestSource = "persisted";
      } else if (manifestReadError) {
        console.warn("[panelize-artboard] manifest lookup unavailable:", manifestReadError.message);
      }
    }

    let boxes = boxesToArray(manifestBoxes);
    let detectedAny = false;
    try {
      // Tell the detector exactly which panels the caller needs so it labels
      // every requested tile by orientation (fixes blank labels on small tiles).
      // Gemini's box detection still varies run-to-run when juggling all sides at
      // once (a small tile like ROOF occasionally returns a degenerate box), so
      // RE-DETECT only the still-missing sides — a few-panel request locates them
      // reliably — and merge, up to 3 passes. This fixes the intermittent
      // single-side miss that made the whole atomic entice build fail.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const missing = wantSides.filter((s) => !locate(s, boxes));
        if (!missing.length) break;
        const fresh = await detectBoxes(b64encode(srcBytes), mime, attempt === 1 ? wantSides : missing);
        for (const fb of fresh) {
          const side = canonicalSide(fb.label);
          if (side && isValidBox(fb.box) && !manifestBoxes[side]) {
            manifestBoxes[side] = fb.box.slice(0, 4).map(Number) as Box;
            detectedAny = true;
          }
        }
        boxes = boxesToArray(manifestBoxes);
      }
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: `detect: ${String(e)}`, stage: "detect" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!hasAllWantedSides()) {
      const missing = wantSides.filter((side) => !locate(side, boxes));
      return new Response(JSON.stringify({
        success: false,
        error: `panel manifest incomplete: ${missing.join(", ")}`,
        stage: "manifest",
        sourceKey,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (detectedAny) {
      manifestSource = "detected";
      const { error: manifestWriteError } = await db
        .from("designpro_panel_manifests")
        .upsert({
          source_key: sourceKey,
          source_url: artboardUrl,
          boxes: manifestBoxes,
          updated_at: new Date().toISOString(),
        }, { onConflict: "source_key" });
      if (manifestWriteError) {
        console.warn("[panelize-artboard] manifest persistence unavailable:", manifestWriteError.message);
      }
    }

    let img: any;
    try {
      img = await Image.decode(srcBytes);
      if (img.width > 4000) img = img.resize(4000, Math.round((img.height * 4000) / img.width));
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: `decode: ${String(e)}`, stage: "decode", boxes: boxes.length }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const W = img.width, H = img.height;

    const out: Array<{ side: string; panelUrl?: string; box?: number[]; error?: string; trimWidthInches?: number; trimHeightInches?: number; printWidthInches?: number; printHeightInches?: number; bleedInches?: number; pixelWidth?: number; pixelHeight?: number; deterministic?: boolean }> = [];

    for (const p of panels) {
      const side = String(p.side);
      try {
        // Match this side to a detected box (same alias+valid-box rule as the
        // retry loop above, so the slice uses the box the retry actually found).
        const hit = locate(side, boxes);
        if (!hit || hit.box.length < 4) { out.push({ side, error: "panel not located on artboard" }); continue; }
        // 0-1000 normalized [ymin,xmin,ymax,xmax] → pixel rect.
        const [ymin, xmin, ymax, xmax] = hit.box;
        const x = Math.max(0, Math.round((xmin / 1000) * W));
        const y = Math.max(0, Math.round((ymin / 1000) * H));
        const w = Math.min(W - x, Math.round(((xmax - xmin) / 1000) * W));
        const h = Math.min(H - y, Math.round(((ymax - ymin) / 1000) * H));
        if (w < 8 || h < 8) { out.push({ side, error: "located box too small" }); continue; }

        // Crop the EXACT artwork pixels — no re-paint.
        const crop = img.clone().crop(x, y, w, h);

        // FULL-DESIGN FIT + 5" MIRROR BLEED — matches the proven `gridslice` fix
        // in panel-artboard-generator ("the navy-was-cropped fix"). Scale the
        // WHOLE cropped design to the panel's TRIM size — nothing is cropped. The
        // vehicle's front and rear live at the LEFT and RIGHT edges of the side
        // artwork (e.g. the stars at the front and the navy at the rear of a flag
        // wrap), so any horizontal crop drops exactly that content — the #1 panel
        // complaint ("not pulling full panel left to right"). Then add the
        // mandatory 5" bleed all around by MIRRORING the design's own edges
        // outward — no white space, no AI, deterministic. (The old COVER-fit
        // scaled to the bleed-inclusive aspect and center-cropped the overscan,
        // which sliced the front/rear off whenever the detected box was a
        // different aspect than the trim.)
        const trimW = Number(p.dimW) || w, trimH = Number(p.dimH) || h;
        const bw = trimW + bleedIn * 2, bh = trimH + bleedIn * 2;
        const LONG = 2400;
        const ppi = Math.min(150, LONG / Math.max(bw, bh));
        const bleedPx = Math.max(0, Math.round(bleedIn * ppi));
        const tpxW = Math.max(1, Math.round(trimW * ppi));
        const tpxH = Math.max(1, Math.round(trimH * ppi));
        const trim = crop.resize(tpxW, tpxH);        // full design → trim, nothing cropped
        const sized = mirrorExtend(trim, bleedPx);   // true 5" bleed all around, mirrored edges

        const png = await sized.encode();
        const path = `renders/panels/${jobId || "job"}/${side.replace(/[^A-Za-z0-9]+/g, "-")}_crop_${Date.now()}.png`;
        const { error: upErr } = await db.storage.from("wrap-files").upload(path, png, { contentType: "image/png", upsert: true });
        if (upErr) { out.push({ side, error: "upload failed" }); continue; }
        const { data: { publicUrl } } = db.storage.from("wrap-files").getPublicUrl(path);
        out.push({ side, panelUrl: publicUrl, box: [x, y, w, h], trimWidthInches: trimW, trimHeightInches: trimH, printWidthInches: bw, printHeightInches: bh, bleedInches: bleedIn, pixelWidth: sized.width, pixelHeight: sized.height, deterministic: true });
      } catch (e) { out.push({ side, error: String(e) }); }
    }

    return new Response(JSON.stringify({
      success: true,
      panels: out,
      detected: boxes.map((b) => b.label),
      manifestSource,
      panelManifest: { version: 1, sourceKey, sourceUrl: artboardUrl, boxes: manifestBoxes },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[panelize-artboard] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err), stage: "top" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
