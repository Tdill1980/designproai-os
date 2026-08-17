/**
 * designpro-artboard — Prompt → Master Artboard (labeled, dimensioned panels)
 *
 * RELIABLE: AI generates the wrap ARTWORK (clean, no text/logos); CODE composes
 * the ARTBOARD with ImageScript (Deno-native raster compositor) — each side a
 * labeled rectangle with EXACT dimensions from the vehicle_dimensions table,
 * the design cover-fit into each panel window, plus a dimensions legend. The
 * artwork is AI; the layout/labels/dimensions are code (always correct).
 *
 * POST /designpro-artboard
 *   { designDescription, companyName?, vehicleYear, vehicleMake, vehicleModel,
 *     bodyType?, panelDims?, finish?, generationId? }
 * → { success, artboardUrl, designUrl, dimsSource, panels }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as b64encode, decode as b64decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BUCKET = "wrap-files";
const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_FALLBACK = "gemini-3.1-flash-image-preview"; // gemini-2.0-flash-exp retired; sanctioned fallback per _shared/model-config.ts
const FONT_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf";

let _fontBytes: Uint8Array | null = null;
async function ensureFont(): Promise<Uint8Array> {
  if (!_fontBytes) { const r = await fetch(FONT_URL); _fontBytes = new Uint8Array(await r.arrayBuffer()); }
  return _fontBytes;
}

const _keys: string[] = [];
let _kl = false, _ki = 0;
function loadKeys() {
  if (_kl) return;
  const p = Deno.env.get("GOOGLE_AI_API_KEY"); if (p) _keys.push(p);
  for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) _keys.push(k); }
  _kl = true;
}
function getGeminiKey(): string { loadKeys(); if (!_keys.length) throw new Error("No GOOGLE_AI_API_KEY"); return _keys[_ki++ % _keys.length]; }
function hasGeminiKey(): boolean { loadKeys(); return _keys.length > 0; }
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
  } catch (e: any) { console.warn(`[ARTBOARD] dims lookup failed: ${e?.message}`); return { dims: null, source: "error" }; }
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

function artworkSystemInstruction(): string {
  return `You are the senior creative director at a $5,000-$8,000-per-vehicle wrap studio. You produce bold, original, gallery-grade flat wrap ARTWORK — rich color, depth, movement, wow factor, never generic. Output is ONE flat 2D artwork panel (a wide horizontal composition) with NO text, NO logos, NO lettering, NO 3D vehicle, NO mockup — pure wrap graphics.`;
}
function artworkPrompt(designDescription: string, finish: string, seed: string, hasExample: boolean): string {
  return `Create ONE wide flat vehicle-wrap ARTWORK (a single horizontal banner-style composition) for this brief:
"${designDescription}"

${hasExample ? "Match the color energy and graphic quality of the EXAMPLE above, but create an ORIGINAL composition.\n" : ""}Bold, cohesive graphics that flow left-to-right with depth and movement. Fill the whole frame edge-to-edge. Finish: ${finish}.
NO text, NO logos, NO words, NO numbers — pure artwork only. (variation token: ${seed})`;
}

async function genArtwork(designDescription: string, finish: string, seed: string, refParts: any[]): Promise<Uint8Array | null> {
  for (const model of [GEMINI_MODEL, GEMINI_FALLBACK]) {
    try {
      const parts: any[] = [...refParts, { text: artworkPrompt(designDescription, finish, seed, refParts.length > 0) }];
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getGeminiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: artworkSystemInstruction() }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) { console.error(`[ARTBOARD] ${model} HTTP ${resp.status}`); continue; }
      const r = await resp.json();
      for (const part of (r?.candidates?.[0]?.content?.parts || [])) {
        if (part.inlineData?.data) { console.log(`[ARTBOARD] artwork from ${model}`); return b64decode(part.inlineData.data); }
      }
    } catch (e: any) { console.error(`[ARTBOARD] ${model} ${e?.message}`); }
  }
  return null;
}

async function loadExample(): Promise<{ mimeType: string; data: string } | null> {
  const sources = [{ b: "wrap-files", p: "designpro-artboard-examples" }, { b: "wrap-files flat panel", p: "" }];
  for (const s of sources) {
    try {
      const { data: files } = await sb().storage.from(s.b).list(s.p, { limit: 30 });
      const img = (files || []).find((f) => /\.(png|jpe?g|webp)$/i.test(f.name) && /background|no\s*element|clean/i.test(f.name))
        || (files || []).find((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
      if (!img) continue;
      const { data: blob } = await sb().storage.from(s.b).download(s.p ? `${s.p}/${img.name}` : img.name);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length > 6 * 1024 * 1024) continue;
      return { mimeType: (blob as any).type || "image/png", data: b64encode(bytes) };
    } catch { /* next */ }
  }
  return null;
}

// ── CODE: compose the labeled, dimensioned artboard with ImageScript ──
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
// DETERMINISTIC PANEL SLICE — crop the design to the panel's TRUE aspect ratio at
// NATIVE resolution (no resize, no AI). Output pixels are copied straight from the
// source artwork, so each per-panel print file is pixel-exact = ZERO generative
// drift. (coverCrop above resizes down for the low-res preview sheet; this keeps
// the full source pixels for the actual print file.)
function slicePanel(src: Image, tw: number, th: number): Image {
  const c = src.clone();
  const sr = c.width / c.height, tr = tw / th;
  let cw: number, ch: number, cx: number, cy: number;
  if (sr > tr) { ch = c.height; cw = Math.max(1, Math.round(ch * tr)); cx = Math.round((c.width - cw) / 2); cy = 0; }
  else { cw = c.width; ch = Math.max(1, Math.round(cw / tr)); cx = 0; cy = Math.round((c.height - ch) / 2); }
  c.crop(cx, cy, cw, ch);
  return c; // native-resolution crop — exact source pixels, no upscale
}
// DETERMINISTIC OVERLAY LAYER — composite the customer's uploaded logo PNG + the
// branding text (company / phone / website) onto a TRANSPARENT, panel-sized canvas.
// No AI: the logo is the exact uploaded pixels; the text is code-rendered. Returns a
// transparent PNG that sits OVER the clean background slice = two separate, editable,
// zero-drift layers per panel. Placement is a sane default (logo top-centre, text
// lower-centre); tune later without affecting drift.
async function buildOverlay(w: number, h: number, logo: Image | null, font: Uint8Array, lines: string[]): Promise<Uint8Array> {
  const ov = new Image(w, h); // transparent by default (RGBA all-zero)
  if (logo && logo.width > 0 && logo.height > 0) {
    const lh = Math.max(1, Math.round(h * 0.24));
    const lw = Math.max(1, Math.round(lh * (logo.width / logo.height)));
    ov.composite(logo.clone().resize(lw, lh), Math.round((w - lw) / 2), Math.round(h * 0.10));
  }
  let ty = Math.round(h * 0.80);
  const size = Math.max(14, Math.round(h * 0.05));
  for (const line of lines) {
    try {
      const im = await Image.renderText(font, size, line, 0xffffffff);
      ov.composite(im, Math.round((w - im.width) / 2), ty);
      ty += Math.round(size * 1.35);
    } catch { /* skip a line */ }
  }
  return await ov.encode();
}
async function composeArtboard(artwork: Uint8Array, panels: Panel[], title: string, finish: string): Promise<Uint8Array> {
  const font = await ensureFont();
  const W = 2400, H = 1500;
  const canvas = new Image(W, H);
  canvas.fill(0xffffffff);
  const design = await Image.decode(artwork);
  const find = (l: string) => panels.find((p) => p.label === l)!;
  const dimStr = (p: Panel) => `${p.w}" x ${p.h}"`;

  const boxes: Record<string, [number, number, number, number]> = {
    hood:   [60, 210, 380, 230],
    roof:   [60, 510, 380, 360],
    driver: [500, 210, 1320, 360],
    pass:   [500, 630, 1320, 360],
    front:  [1860, 230, 480, 180],
    rear:   [1860, 490, 480, 180],
  };

  const text = async (t: string, size: number, color: number) => {
    try { return await Image.renderText(font, size, t, color); } catch { return null; }
  };
  const place = async (t: string, size: number, color: number, x: number, y: number, center = false) => {
    const im = await text(t, size, color);
    if (!im) return;
    canvas.composite(im, center ? Math.round((W - im.width) / 2) : x, y);
  };

  await place(title, 40, 0x111111ff, 0, 32, true);
  await place(`ALL PANELS @ ACTUAL SIZE   300 DPI   CMYK   1" BLEED   ${finish.toUpperCase()}`, 22, 0x777777ff, 0, 92, true);

  const drawPanel = async (key: string, name: string) => {
    const p = find(name);
    const [x, y, w, h] = boxes[key];
    // border
    const border = new Image(w + 4, h + 4); border.fill(0xccccccff);
    canvas.composite(border, x - 2, y - 2);
    // artwork cover-fit into the panel
    canvas.composite(coverCrop(design, w, h), x, y);
    // label above
    await place(`${name === "FRONT" ? "FRONT BUMPER" : name === "REAR" ? "REAR BUMPER" : name}: ${dimStr(p)}`, 26, 0x111111ff, x, y - 34);
  };
  await drawPanel("hood", "HOOD");
  await drawPanel("roof", "ROOF");
  await drawPanel("driver", "DRIVER SIDE");
  await drawPanel("pass", "PASSENGER SIDE");
  await drawPanel("front", "FRONT");
  await drawPanel("rear", "REAR");

  // legend
  await place("DIMENSIONS REFERENCE", 24, 0x111111ff, 60, 1360);
  const d = find("DRIVER SIDE"), hd = find("HOOD"), rf = find("ROOF"), fr = find("FRONT"), re = find("REAR");
  const legend = [`Driver/Passenger: ${dimStr(d)}`, `Hood: ${dimStr(hd)}`, `Roof: ${dimStr(rf)}`, `Front: ${dimStr(fr)}`, `Rear: ${dimStr(re)}`];
  for (let i = 0; i < legend.length; i++) {
    await place(legend[i], 20, 0x555555ff, 60 + (i % 3) * 460, 1400 + Math.floor(i / 3) * 34);
  }

  return await canvas.encode();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const designDescription: string = (body.designDescription || body.prompt || body.designPrompt || "").trim();
    const companyName: string = (body.companyName || "").trim();
    const vehicleYear: string = String(body.vehicleYear || body.year || "2024");
    const vehicleMake: string = (body.vehicleMake || body.make || "").trim();
    const vehicleModel: string = (body.vehicleModel || body.model || "").trim();
    const finish: string = body.finish || "Gloss";
    const bodyType: string = (body.bodyType || "suv").toLowerCase();
    const generationId: string = body.generationId || "";
    // Overlay inputs (deterministic layer): customer logo PNG + branding text.
    const logoUrl: string = (body.logoUrl || body.logo_url || "").trim();
    const phone: string = (body.phone || "").trim();
    const website: string = (body.website || body.url || "").trim();

    if (!designDescription) return json({ success: false, error: "designDescription required" }, 400);
    if (!vehicleMake || !vehicleModel) return json({ success: false, error: "vehicleMake and vehicleModel required" }, 400);
    if (!hasGeminiKey()) return json({ success: false, error: "AI key not configured" }, 500);

    let userId: string = body.userId || "";
    if (!userId) {
      const ah = req.headers.get("Authorization");
      if (ah?.startsWith("Bearer ")) { try { const { data: { user } } = await sb().auth.getUser(ah.replace("Bearer ", "")); if (user) userId = user.id; } catch { /**/ } }
    }

    const dbLookup = await loadVehicleDims(vehicleMake, vehicleModel, vehicleYear);
    const dims: PanelDims = { ...(BODY_DEFAULTS[bodyType] || BODY_DEFAULTS.suv), ...(dbLookup.dims || {}), ...(body.panelDims || {}) };
    const dimsSource = body.panelDims ? "payload" : (dbLookup.dims ? dbLookup.source : `default:${bodyType}`);
    const panels = buildPanels(dims);
    const vehicle = `${vehicleYear} ${vehicleMake} ${vehicleModel}`.trim();
    const seed = body.variationSeed || crypto.randomUUID().slice(0, 8);
    console.log(`[ARTBOARD] ${vehicle} — dims ${dimsSource}, seed ${seed}`);

    const refParts: any[] = [];
    const ex = await loadExample();
    if (ex) { refParts.push({ text: "EXAMPLE (match color energy + quality, original composition):" }); refParts.push({ inlineData: ex }); }

    const artwork = await genArtwork(designDescription, finish, seed, refParts);
    if (!artwork) return json({ success: false, error: "Artwork generation failed — retry" }, 502);

    const owner = userId || "anon";
    const baseDir = `designpro-artboards/${owner}/${generationId || Date.now()}`;
    await sb().storage.from(BUCKET).upload(`${baseDir}/design.png`, artwork, { contentType: "image/png", upsert: true });
    const { data: designSigned } = await sb().storage.from(BUCKET).createSignedUrl(`${baseDir}/design.png`, 60 * 60 * 24 * 7);

    const title = `${vehicle.toUpperCase()} WRAP${companyName ? ` — ${companyName.toUpperCase()}` : ""}`;
    const artboardPng = await composeArtboard(artwork, panels, title, finish);

    const { error: upErr } = await sb().storage.from(BUCKET).upload(`${baseDir}/artboard.png`, artboardPng, { contentType: "image/png", upsert: true });
    if (upErr) return json({ success: false, error: `Upload failed: ${upErr.message}` }, 500);
    const { data: signed } = await sb().storage.from(BUCKET).createSignedUrl(`${baseDir}/artboard.png`, 60 * 60 * 24 * 7);
    const artboardUrl = signed?.signedUrl || "";

    // ── DETERMINISTIC per-panel print files (pixel-exact slices, ZERO AI drift) ──
    // Crop the SAME source artwork into each panel's true aspect at native
    // resolution and save each as its own PNG. These are the print files
    // production / RecreatePro grab — identical pixels to the artboard panels,
    // no regeneration. Non-fatal per panel.
    const designImg = await Image.decode(artwork);
    // Overlay layer inputs (deterministic): customer logo PNG + branding text lines.
    let logoImg: Image | null = null;
    if (logoUrl) {
      try { const lr = await fetch(logoUrl); logoImg = await Image.decode(new Uint8Array(await lr.arrayBuffer())); }
      catch (e) { console.warn(`[ARTBOARD] logo fetch failed: ${(e as Error)?.message}`); }
    }
    const overlayFont = await ensureFont();
    const brandLines = [companyName, phone, website].filter(Boolean);

    const panelOut: Array<{ label: string; widthInches: number; heightInches: number; fileUrl: string | null; overlayUrl: string | null }> = [];
    for (const p of panels) {
      let fileUrl: string | null = null;
      let overlayUrl: string | null = null;
      const slug = p.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      try {
        const sliced = slicePanel(designImg, p.w, p.h);
        // Layer 1 — clean BACKGROUND (pixel-exact slice, zero drift)
        await sb().storage.from(BUCKET).upload(`${baseDir}/panels/${slug}.png`, await sliced.encode(), { contentType: "image/png", upsert: true });
        const { data: ps } = await sb().storage.from(BUCKET).createSignedUrl(`${baseDir}/panels/${slug}.png`, 60 * 60 * 24 * 7);
        fileUrl = ps?.signedUrl || null;
        // Layer 2 — OVERLAY (logo + text), transparent, SAME panel dimensions
        const ovPng = await buildOverlay(sliced.width, sliced.height, logoImg, overlayFont, brandLines);
        await sb().storage.from(BUCKET).upload(`${baseDir}/panels/${slug}-overlay.png`, ovPng, { contentType: "image/png", upsert: true });
        const { data: ov } = await sb().storage.from(BUCKET).createSignedUrl(`${baseDir}/panels/${slug}-overlay.png`, 60 * 60 * 24 * 7);
        overlayUrl = ov?.signedUrl || null;
      } catch (e) {
        console.warn(`[ARTBOARD] panel ${p.label} failed:`, (e as Error)?.message || e);
      }
      panelOut.push({ label: p.label, widthInches: p.w, heightInches: p.h, fileUrl, overlayUrl });
    }

    if (generationId) { await sb().from("designiq_generations").update({ master_artboard_url: artboardUrl } as any).eq("id", generationId); }

    // ── Register on /admin/production-files ("DesignPro Artboards" section) ──
    // panel_artboard_jobs/assets drive that page. PUBLIC storage URLs only —
    // the page previews/upscales via /object/public/wrap-files/… and the
    // signed URLs above expire in 7 days. Non-fatal: registration never
    // breaks the generation that produced the files.
    try {
      const pub = (key: string) => sb().storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
      const jobId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generationId) ? generationId : crypto.randomUUID();
      await sb().from("panel_artboard_jobs").upsert({
        id: jobId, user_id: userId || null, status: "complete", mode: "designpro",
        prompt: designDescription, vehicle_year: vehicleYear, vehicle_make: vehicleMake,
        vehicle_model: vehicleModel, body_type: bodyType, finish, dims_source: dimsSource,
        panels: panelOut.map((p) => ({ label: p.label, widthInches: p.widthInches, heightInches: p.heightInches })),
        completed_at: new Date().toISOString(),
      } as any, { onConflict: "id" });
      // This function regenerates the full set, so replace the job's assets.
      await sb().from("panel_artboard_assets").delete().eq("job_id", jobId);
      const rows: any[] = [
        { job_id: jobId, kind: "artboard", label: "MASTER ARTBOARD", storage_path: `${baseDir}/artboard.png`, url: pub(`${baseDir}/artboard.png`), sort_order: 1 },
        { job_id: jobId, kind: "design", label: "CLEAN DESIGN", storage_path: `${baseDir}/design.png`, url: pub(`${baseDir}/design.png`), sort_order: 2 },
      ];
      panelOut.forEach((p, i) => {
        const pslug = p.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (p.fileUrl) rows.push({ job_id: jobId, kind: "panel", label: `${p.label} — PRINT PANEL`, panel_label: p.label, width_inches: p.widthInches, height_inches: p.heightInches, storage_path: `${baseDir}/panels/${pslug}.png`, url: pub(`${baseDir}/panels/${pslug}.png`), sort_order: 10 + i });
        if (p.overlayUrl) rows.push({ job_id: jobId, kind: "overlays", label: `${p.label} — OVERLAY (transparent)`, panel_label: p.label, width_inches: p.widthInches, height_inches: p.heightInches, storage_path: `${baseDir}/panels/${pslug}-overlay.png`, url: pub(`${baseDir}/panels/${pslug}-overlay.png`), sort_order: 30 + i });
      });
      const { error: regErr } = await sb().from("panel_artboard_assets").insert(rows);
      if (regErr) console.warn(`[ARTBOARD] production-files asset insert failed (non-fatal): ${regErr.message}`);
      else console.log(`[ARTBOARD] registered ${rows.length} production-file assets on job ${jobId}`);
    } catch (e) { console.warn(`[ARTBOARD] production-files registration failed (non-fatal): ${(e as Error)?.message || e}`); }

    console.log(`[ARTBOARD] DONE — ${Math.round(artboardPng.length / 1024)} KB, ${panelOut.filter((p) => p.fileUrl).length}/${panelOut.length} panel files`);
    return json({
      success: true, artboardUrl, designUrl: designSigned?.signedUrl || "", exampleUsed: !!ex, variationSeed: seed, dimsSource,
      panels: panelOut,
    });
  } catch (err: any) {
    console.error("[ARTBOARD] error:", err?.message || err);
    return json({ success: false, error: err?.message || "Artboard error" }, 500);
  }
});
