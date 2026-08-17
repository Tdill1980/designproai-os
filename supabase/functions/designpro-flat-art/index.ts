/**
 * designpro-flat-art — Layered, persona-based FLAT ART generator (artboard-first source)
 *
 * CREATIVE MODE engine (Stage 1, temperature 0.7). Print-Ready Layering:
 *   Layer 0: bleed base panel — texture & background at true dimensions
 *   Layer 1: real photographic ingestion — raster assets soft-alpha-blended
 *   Layer 2: high-contrast structural elements — geometric overlays / masks
 *   Layer 3: isolated overlaid elements — logos & typography (transparent)
 * Layers 2 and 3 are painted on a pure-magenta knock-out and chroma-keyed by
 * CODE (deterministic transparency), then composited into the combined design
 * and laid into 6 labeled flat panels at TRUE vehicle dimensions.
 *
 * Per-side recreate branch = Stage 3 segmentation (temperature 0.0, top_p 1.0).
 *
 * Self-contained (no _shared imports) so it ships in a single MCP deploy.
 *   - Model LOCKED to gemini-3-pro-image-preview (Flash fallback only).
 *   - Real panel dims from vehicle_dimensions (PVO), body-type defaults otherwise.
 *   - GOOGLE_AI_API_KEY pool.
 *
 * config.toml:  [functions.designpro-flat-art]  verify_jwt = false
 *
 * Request:  { prompt, mode?, vehicleMake, vehicleModel, vehicleYear?, finish?,
 *             companyName?, phone?, url?, bodyType?, generationId? }
 * Response: { success, artboardUrl, backgroundUrl, elementsUrl, combinedUrl,
 *             panels, dimsSource } | { success:false, error }
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
const FONT_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf";

// Pure-magenta knock-out used for the element pass, then chroma-keyed out by code.
const KEY_R = 255, KEY_G = 0, KEY_B = 255;

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
function geminiKey(): string { loadKeys(); if (!_keys.length) throw new Error("No GOOGLE_AI_API_KEY"); return _keys[_ki++ % _keys.length]; }
function hasKey(): boolean { loadKeys(); return _keys.length > 0; }
function sb() { return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!); }
function json(b: unknown, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

// ── Vehicle dimensions (PVO) — same source designpro-artboard uses ──
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
  } catch (e: any) { console.warn(`[FLAT-ART] dims lookup failed: ${e?.message}`); return { dims: null, source: "error" }; }
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

// ── PERSONA — exactly as Trish defined it ──
function persona(): string {
  return `You are a Vehicle Wrap Designer at WePrintWraps.com. You design commercial wraps at agency level — always unique, layered, and branded — and restyle wraps that are award-winning, with clear distinct texture, real depth, and SEMA-show-level quality. You stay FAITHFUL to the customer's brief and ELEVATE the execution to that standard. You know wrap placement and installation best practices: keep logos, company name, phone, and URL in flat readable door zones (never across handles, mirrors, body-line creases, or panel gaps), hold proper bleed and safe margins, and account for how vinyl wraps around edges and compound curves. You produce finished, print-ready designs sold to professional wrap shops, sign companies, and restyle shops across the USA.`;
}

function backgroundPrompt(prompt: string, mode: string, finish: string): string {
  const modeLine = mode === "restyle"
    ? "This is a RESTYLE wrap: bold, award-winning, SEMA-level texture and depth — fill the whole frame, no empty branding space needed."
    : "This is a COMMERCIAL wrap: clean, professional, layered base. Leave the design breathing room on the left/door area where a logo and contact info will sit.";
  return `Create the BACKGROUND layer for a vehicle wrap, FAITHFUL to this brief:
"${prompt}"

${modeLine}
This is a FLAT, full-bleed 2D wrap background — rich color, texture, atmosphere and real depth that reads as ONE cohesive design edge to edge. Finish: ${finish}.
NO text, NO logos, NO lettering, NO graphic elements yet, NO 3D vehicle, NO mockup, NO panel lines — just the flat background artwork.`;
}

// Reproduce-from-reference (image-to-image): faithfully FLATTEN an approved
// design (which may be a 3D render or a multi-view 2D proof) into one flat panel.
function reproducePrompt(finish: string): string {
  return `The attached image is an APPROVED vehicle wrap design — it may be a photo of a wrapped vehicle, a 3D render, or a multi-view production proof / artboard sheet that has its own headers, labels, dimension callouts and a signature footer. Extract ONLY the wrap ARTWORK itself — use the largest side-panel artwork as the source of truth — and reproduce it as ONE FLAT, full-bleed 2D wrap panel: keep the EXACT colors, patterns, graphic motifs, gradients, flow and composition, rendered edge to edge as if peeled off the vehicle and laid flat. Finish: ${finish}. The output must contain the artwork ONLY: no sheet titles or headers, no dimension text, no labels, no approval/signature lines, no white margins or borders, no 3D vehicle, no photograph, no multiple views, no background scene, no panel outlines.`;
}

// RecreatePro-style per-side: reproduce ONE named side from the approved proof,
// anchored to that side so the set stays faithful and never drifts. No prompt.
function sidePrompt(side: string, finish: string): string {
  return `You are operating as a precise pre-press print production engine. Analyze the provided vehicle wrap design reference and isolate the flat panel asset for the ${side} with zero artistic modification. Maintain absolute alignment, scale, and spatial positions of all graphic elements exactly as seen in the reference anchor image. Do not invent new elements, shadows, lighting, or background patterns. Render that side flattened as ONE full-bleed 2D wrap panel, edge to edge. Finish: ${finish}. Output only that side's flat artwork.`;
}

// 21:9 removed — it produces a short "skinny" frame; 16:9 is the largest 4K canvas and gets cover-cropped to true panel dims downstream.
const _ASPECTS: Array<[string, number]> = [["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 0.75], ["9:16", 9 / 16]];
function nearestAspect(w: number, h: number): string {
  const t = w / h; let best = "16:9", d = Infinity;
  for (const [l, r] of _ASPECTS) { const e = Math.abs(r - t); if (e < d) { d = e; best = l; } }
  return best;
}

// LAYER 2 — high-contrast STRUCTURAL elements: geometric overlays, accent
// shapes, vectors and shading masks that create dimensional separation
// between the background and the branding. No text, no logos.
function structuralPrompt(prompt: string, mode: string): string {
  const intent = mode === "restyle"
    ? "sweeping accent shapes, angular vectors and layered shading that amplify the design's motion and depth"
    : "clean geometric overlays, accent bars and soft shading masks that carve out clear zones where branding will sit";
  return `The attached image is the finished wrap BACKGROUND. Paint ONLY the high-contrast STRUCTURAL layer for this brief:
"${prompt}"

Add ${intent} — dimensional separation, not decoration. NO text, NO logos, NO lettering.
CRITICAL OUTPUT RULE: paint these shapes over a SOLID PURE MAGENTA (#FF00FF) background and NOTHING else — pure (255,0,255) everywhere there is no shape — so they cut out as a transparent layer. Crisp edges.`;
}

function elementPrompt(prompt: string, mode: string, companyName: string, phone: string, url: string): string {
  const brand = mode === "restyle"
    ? "Paint the HERO graphic elements, accents and fine detail that ELEVATE this design — layered, high-end, SEMA-level, with real depth. No company text unless the brief asks for it."
    : `Paint the branded ELEMENTS that complete this commercial wrap: the company logo/name${companyName ? ` "${companyName}"` : ""}${phone ? `, phone "${phone}"` : ""}${url ? `, web "${url}"` : ""}, plus supporting graphic accents. Place them as they should sit on the vehicle — readable, in the flat door zone, never where a handle, mirror or body line would cut them.`;
  return `The attached image is the finished wrap BACKGROUND. Paint ONLY the design ELEMENTS that go ON TOP of it, FAITHFUL to this brief:
"${prompt}"

${brand}

CRITICAL OUTPUT RULE: paint the elements over a SOLID PURE MAGENTA (#FF00FF) background and NOTHING else — pure (255,0,255) everywhere there is no element, so the elements can be cut out as a transparent layer. Do NOT repaint or include the background artwork. Do NOT draw a vehicle. Keep edges crisp. Agency / SEMA level quality, layered with depth.`;
}

async function genImage(systemText: string, parts: any[], aspect: string, size: string, temperature = 0.7): Promise<Uint8Array | null> {
  for (const model of [GEMINI_MODEL, GEMINI_MODEL, GEMINI_FALLBACK]) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemText }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: size }, temperature, ...(temperature <= 0.2 ? { topP: 1.0 } : {}) },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) { console.error(`[FLAT-ART] ${model} HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`); continue; }
      const r = await resp.json();
      for (const part of (r?.candidates?.[0]?.content?.parts || [])) {
        if (part.inlineData?.data) return b64decode(part.inlineData.data);
      }
      console.error(`[FLAT-ART] ${model} no image (finishReason ${r?.candidates?.[0]?.finishReason || "?"})`);
    } catch (e: any) { console.error(`[FLAT-ART] ${model} ${e?.message}`); }
  }
  return null;
}

// ── CODE chroma-key: remove pure-magenta → transparent alpha. Deterministic. ──
function chromaKeyMagenta(img: Image): Image {
  for (const [x, y, color] of img.iterateWithColors()) {
    const r = (color >>> 24) & 0xff, g = (color >>> 16) & 0xff, b = (color >>> 8) & 0xff;
    // Magenta = high R, low G, high B. Tolerant so JPEG/AA fringe still keys out.
    if (r > 180 && g < 90 && b > 180) {
      img.setPixelAt(x, y, 0x00000000);
    }
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

async function composeArtboard(design: Image, panels: Panel[], title: string, finish: string): Promise<Uint8Array> {
  const font = await ensureFont();
  const W = 2400, H = 1500;
  const canvas = new Image(W, H);
  canvas.fill(0xffffffff);
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

  const place = async (t: string, size: number, color: number, x: number, y: number, center = false) => {
    try { const im = await Image.renderText(font, size, t, color); canvas.composite(im, center ? Math.round((W - im.width) / 2) : x, y); } catch { /* font miss */ }
  };

  await place(title, 38, 0x111111ff, 0, 30, true);
  await place(`ALL PANELS @ ACTUAL SIZE   300 DPI   CMYK   1" BLEED   ${finish.toUpperCase()}`, 22, 0x777777ff, 0, 90, true);

  const drawPanel = async (key: string, name: string) => {
    const p = find(name);
    const [x, y, w, h] = boxes[key];
    const border = new Image(w + 4, h + 4); border.fill(0xccccccff);
    canvas.composite(border, x - 2, y - 2);
    canvas.composite(coverCrop(design, w, h), x, y);
    await place(`${name === "FRONT" ? "FRONT BUMPER" : name === "REAR" ? "REAR BUMPER" : name}: ${dimStr(p)}`, 26, 0x111111ff, x, y - 34);
  };
  await drawPanel("hood", "HOOD");
  await drawPanel("roof", "ROOF");
  await drawPanel("driver", "DRIVER SIDE");
  await drawPanel("pass", "PASSENGER SIDE");
  await drawPanel("front", "FRONT");
  await drawPanel("rear", "REAR");

  await place("DIMENSIONS REFERENCE", 24, 0x111111ff, 60, 1360);
  const d = find("DRIVER SIDE"), hd = find("HOOD"), rf = find("ROOF"), fr = find("FRONT"), re = find("REAR");
  const legend = [`Driver/Passenger: ${dimStr(d)}`, `Hood: ${dimStr(hd)}`, `Roof: ${dimStr(rf)}`, `Front: ${dimStr(fr)}`, `Rear: ${dimStr(re)}`];
  for (let i = 0; i < legend.length; i++) await place(legend[i], 20, 0x555555ff, 60 + (i % 3) * 460, 1400 + Math.floor(i / 3) * 34);

  return await canvas.encode();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const prompt: string = (body.prompt || body.designDescription || "").trim();
    const referenceImageUrl: string = (body.referenceImageUrl || body.proofUrl || body.designUrl || "").trim();
    const mode: string = (body.mode === "restyle" ? "restyle" : "commercial");
    const vehicleYear: string = String(body.vehicleYear || body.year || "2024");
    const vehicleMake: string = (body.vehicleMake || body.make || "").trim();
    const vehicleModel: string = (body.vehicleModel || body.model || "").trim();
    const finish: string = body.finish || "Gloss";
    const bodyType: string = (body.bodyType || "truck").toLowerCase();
    const companyName: string = (body.companyName || "").trim();
    const phone: string = (body.phone || "").trim();
    const url: string = (body.url || "").trim();
    const generationId: string = body.generationId || "";

    if (!prompt && !referenceImageUrl) return json({ success: false, error: "prompt or referenceImageUrl required" }, 400);
    if (!vehicleMake || !vehicleModel) return json({ success: false, error: "vehicleMake and vehicleModel required" }, 400);
    if (!hasKey()) return json({ success: false, error: "AI key not configured" }, 500);

    let userId: string = body.userId || "";
    if (!userId) {
      const ah = req.headers.get("Authorization");
      if (ah?.startsWith("Bearer ")) { try { const { data: { user } } = await sb().auth.getUser(ah.replace("Bearer ", "")); if (user) userId = user.id; } catch { /**/ } }
    }

    const dbLookup = await loadVehicleDims(vehicleMake, vehicleModel, vehicleYear);
    const dims: PanelDims = { ...(BODY_DEFAULTS[bodyType] || BODY_DEFAULTS.truck), ...(dbLookup.dims || {}), ...(body.panelDims || {}) };
    const dimsSource = body.panelDims ? "payload" : (dbLookup.dims ? dbLookup.source : `default:${bodyType}`);
    const panels = buildPanels(dims);
    const vehicle = `${vehicleYear} ${vehicleMake} ${vehicleModel}`.trim();
    console.log(`[FLAT-ART] ${vehicle} mode=${mode} dims=${dimsSource}`);

    // ── SINGLE-SIDE RECREATE (RecreatePro-style, anchored to the proof) ──
    // Frontend loops the sides; each call reproduces ONE side from the proof so
    // the set stays faithful and never drifts. editNote = optional minor edit.
    const sideReq: string = (body.side || "").toString().trim();
    const editNote: string = (body.editNote || "").toString().trim();
    if (sideReq && referenceImageUrl) {
      const panel = panels.find((p) => p.label.toUpperCase() === sideReq.toUpperCase())
        || { label: sideReq.toUpperCase(), w: Number(body.panelW) || 200, h: Number(body.panelH) || 60 };
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 1;
      const bw = panel.w + 2 * bleed, bh = panel.h + 2 * bleed;
      let refB64 = "", refMime = "image/png";
      try {
        const rr = await fetch(referenceImageUrl, { signal: AbortSignal.timeout(30_000) });
        if (!rr.ok) throw new Error(`reference fetch ${rr.status}`);
        refMime = rr.headers.get("content-type") || "image/png";
        refB64 = b64encode(new Uint8Array(await rr.arrayBuffer()));
      } catch (e: any) { return json({ success: false, error: `Could not fetch reference: ${e?.message || e}` }, 502); }
      const promptText = sidePrompt(panel.label, finish) + (editNote ? ` MINOR EDIT — apply ONLY this change, keep everything else identical: ${editNote}` : "");
      // Stage 3 segmentation = deterministic: temperature 0.0, top_p 1.0.
      const sideBytes = await genImage(persona(), [{ inlineData: { mimeType: refMime, data: refB64 } }, { text: promptText }], nearestAspect(bw, bh), "4K", 0.0);
      if (!sideBytes) return json({ success: false, error: `${panel.label} generation failed — retry` }, 502);
      // Cap at 2048px: the AI output is only ~2K, so upscaling beyond it adds
      // memory (546 OOM), not detail. Keep the panel's true aspect.
      let pxW = Math.round(bw * 150), pxH = Math.round(bh * 150);
      const longest = Math.max(pxW, pxH); if (longest > 2048) { const k = 2048 / longest; pxW = Math.round(pxW * k); pxH = Math.round(pxH * k); }
      const sized = coverCrop(await Image.decode(sideBytes), pxW, pxH);
      const owner = userId || "anon";
      const label2 = panel.label.toLowerCase().replace(/\s+/g, "_");
      const path = `designpro-flat-art/sides/${owner}/${generationId || Date.now()}/${label2}.png`;
      const { error: upErr } = await sb().storage.from(BUCKET).upload(path, await sized.encode(), { contentType: "image/png", upsert: true });
      if (upErr) return json({ success: false, error: `upload failed: ${upErr.message}` }, 500);
      const { data: signed } = await sb().storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
      console.log(`[FLAT-ART] side ${panel.label} ${pxW}x${pxH} edit=${!!editNote}`);
      // Register the print panel on /admin/production-files ("DesignPro
      // Artboards" section). Keyed to the generationId so all sides + the
      // master artboard land on ONE job card. Public URL (signed expires).
      try {
        const jobId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generationId) ? generationId : crypto.randomUUID();
        await sb().from("panel_artboard_jobs").upsert({
          id: jobId, user_id: userId || null, status: "complete", mode: "designpro",
          prompt: prompt || `Flat panels — ${vehicle}`, vehicle_year: vehicleYear, vehicle_make: vehicleMake,
          vehicle_model: vehicleModel, body_type: bodyType, finish, dims_source: dimsSource,
          completed_at: new Date().toISOString(),
        } as any, { onConflict: "id" });
        await sb().from("panel_artboard_assets").delete().eq("job_id", jobId).eq("kind", "panel").eq("panel_label", panel.label);
        const { error: regErr } = await sb().from("panel_artboard_assets").insert({
          job_id: jobId, kind: "panel", label: `${panel.label} — PRINT PANEL (incl. ${bleed}″ bleed)`, panel_label: panel.label,
          width_inches: bw, height_inches: bh, dpi: Math.round(pxW / bw),
          storage_path: path, url: sb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl, sort_order: 10,
        });
        if (regErr) console.warn(`[FLAT-ART] production-files panel register failed (non-fatal): ${regErr.message}`);
      } catch (e) { console.warn(`[FLAT-ART] production-files registration failed (non-fatal): ${(e as Error)?.message || e}`); }
      return json({ success: true, side: panel.label, url: signed?.signedUrl || "", trimWidthInches: panel.w, trimHeightInches: panel.h, bleedWidthInches: bw, bleedHeightInches: bh, pixelW: pxW, pixelH: pxH, effectiveDpi: Math.round((pxW / bw) * 10) / 10 });
    }

    // ── PASS 1 / LAYER 0: BACKGROUND ──
    // referenceImageUrl (an approved 2D proof / render upload) → image-to-image
    // FAITHFUL FLATTEN of that design. Otherwise prompt-driven background.
    const reproduceMode = !!referenceImageUrl;
    let bgBytes: Uint8Array | null;
    if (reproduceMode) {
      let refB64 = "", refMime = "image/png";
      try {
        const rr = await fetch(referenceImageUrl, { signal: AbortSignal.timeout(30_000) });
        if (!rr.ok) throw new Error(`reference fetch ${rr.status}`);
        refMime = rr.headers.get("content-type") || "image/png";
        refB64 = b64encode(new Uint8Array(await rr.arrayBuffer()));
      } catch (e: any) {
        return json({ success: false, error: `Could not fetch reference image: ${e?.message || e}` }, 502);
      }
      bgBytes = await genImage(persona(), [{ inlineData: { mimeType: refMime, data: refB64 } }, { text: reproducePrompt(finish) }], "16:9", "4K", 0.2);
    } else {
      bgBytes = await genImage(persona(), [{ text: backgroundPrompt(prompt, mode, finish) }], "16:9", "4K");
    }
    if (!bgBytes) return json({ success: false, error: "Background generation failed — retry" }, 502);
    const background = await Image.decode(bgBytes);
    console.log(`[FLAT-ART] background ${background.width}x${background.height} reproduce=${reproduceMode}`);

    // ── LAYER 1 (optional): real photographic ingestion — soft-blend raster
    // photo assets into the base before structural/branding layers. ──
    const combined = background.clone();
    const photoUrls: string[] = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 2) : [];
    for (const pu of photoUrls) {
      try {
        const pr = await fetch(pu, { signal: AbortSignal.timeout(20_000) });
        if (!pr.ok) continue;
        const photo = await Image.decode(new Uint8Array(await pr.arrayBuffer()));
        const targetW = Math.round(combined.width * 0.34);
        const scaled = coverCrop(photo, targetW, Math.round(combined.height * 0.6));
        scaled.opacity(0.88); // soft alpha blend — no harsh edges
        combined.composite(scaled, combined.width - targetW - Math.round(combined.width * 0.04), Math.round(combined.height * 0.2));
        console.log(`[FLAT-ART] photo ingested (L1)`);
      } catch (e: any) { console.warn(`[FLAT-ART] photo skipped: ${e?.message}`); }
    }

    // ── LAYER 2: STRUCTURAL pass (geometric overlays / shading masks) +
    // LAYER 3: BRANDING pass (logos/text) — each magenta-knocked, code-keyed.
    // Skipped in reproduce mode (the reference carries the whole design). ──
    let structuralLayer: Image | null = null;
    let elementsLayer: Image | null = null;
    if (!reproduceMode) {
      const structBytes = await genImage(persona(), [
        { inlineData: { mimeType: "image/png", data: b64encode(bgBytes) } },
        { text: structuralPrompt(prompt, mode) },
      ], "16:9", "4K");
      if (structBytes) {
        structuralLayer = chromaKeyMagenta(await Image.decode(structBytes));
        if (structuralLayer.width !== combined.width || structuralLayer.height !== combined.height) {
          structuralLayer.resize(combined.width, combined.height);
        }
        combined.composite(structuralLayer, 0, 0);
        console.log(`[FLAT-ART] structural layer keyed + composited (L2)`);
      }

      const brandingBase = await combined.encode();
      const elBytes = await genImage(persona(), [
        { inlineData: { mimeType: "image/png", data: b64encode(brandingBase) } },
        { text: elementPrompt(prompt, mode, companyName, phone, url) },
      ], "16:9", "4K");
      if (elBytes) {
        elementsLayer = chromaKeyMagenta(await Image.decode(elBytes));
        if (elementsLayer.width !== combined.width || elementsLayer.height !== combined.height) {
          elementsLayer.resize(combined.width, combined.height);
        }
        combined.composite(elementsLayer, 0, 0); // L0(+L1)+L2+L3 = full flat design
        console.log(`[FLAT-ART] branding layer keyed + composited (L3)`);
      } else {
        console.warn(`[FLAT-ART] branding pass returned no image — shipping without L3`);
      }
    }

    // ── PASS 4: CODE compose the install-correct flat panels ──
    const combinedBytes = await combined.encode();
    const title = `${vehicle.toUpperCase()} WRAP${companyName ? ` — ${companyName.toUpperCase()}` : ""}`;
    const artboardBytes = await composeArtboard(combined, panels, title, finish);

    // ── Upload all LAYERS + artboard (kept separate so they stay editable) ──
    const owner = userId || "anon";
    const dir = `designpro-flat-art/${owner}/${generationId || Date.now()}`;
    const up = async (name: string, bytes: Uint8Array) => {
      const { error } = await sb().storage.from(BUCKET).upload(`${dir}/${name}`, bytes, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`upload ${name} failed: ${error.message}`);
      const { data } = await sb().storage.from(BUCKET).createSignedUrl(`${dir}/${name}`, 60 * 60 * 24 * 7);
      return data?.signedUrl || "";
    };

    const backgroundUrl = await up("background.png", bgBytes);
    const structuralUrl = structuralLayer ? await up("structural.png", await structuralLayer.encode()) : "";
    const elementsUrl = elementsLayer ? await up("elements.png", await elementsLayer.encode()) : "";
    const combinedUrl = await up("combined.png", combinedBytes);
    const artboardUrl = await up("artboard.png", artboardBytes);

    if (generationId) {
      await sb().from("designiq_generations").update({ master_artboard_url: artboardUrl } as any).eq("id", generationId);
    }

    // ── Register on /admin/production-files ("DesignPro Artboards" section) ──
    // Same job id as the per-side calls (generationId) so the artboard, layers
    // and print panels all collect on one card. Replaces only the kinds this
    // path writes — per-side panel assets are kept. Public URLs (signed expire).
    try {
      const pub = (name: string) => sb().storage.from(BUCKET).getPublicUrl(`${dir}/${name}`).data.publicUrl;
      const jobId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generationId) ? generationId : crypto.randomUUID();
      await sb().from("panel_artboard_jobs").upsert({
        id: jobId, user_id: userId || null, status: "complete", mode: "designpro",
        prompt: prompt || `Flat art — ${vehicle}`, vehicle_year: vehicleYear, vehicle_make: vehicleMake,
        vehicle_model: vehicleModel, body_type: bodyType, finish, dims_source: dimsSource,
        panels: panels.map((p) => ({ label: p.label, widthInches: p.w, heightInches: p.h })),
        completed_at: new Date().toISOString(),
      } as any, { onConflict: "id" });
      await sb().from("panel_artboard_assets").delete().eq("job_id", jobId).in("kind", ["artboard", "design", "background", "overlays"]);
      const rows: any[] = [
        { job_id: jobId, kind: "artboard", label: "MASTER ARTBOARD", storage_path: `${dir}/artboard.png`, url: pub("artboard.png"), sort_order: 1 },
        { job_id: jobId, kind: "design", label: "COMBINED FLAT DESIGN", storage_path: `${dir}/combined.png`, url: pub("combined.png"), sort_order: 2 },
        { job_id: jobId, kind: "background", label: "BACKGROUND LAYER", storage_path: `${dir}/background.png`, url: pub("background.png"), sort_order: 3 },
      ];
      if (structuralUrl) rows.push({ job_id: jobId, kind: "overlays", label: "STRUCTURAL LAYER (transparent)", storage_path: `${dir}/structural.png`, url: pub("structural.png"), sort_order: 4 });
      if (elementsUrl) rows.push({ job_id: jobId, kind: "overlays", label: "BRANDING LAYER (transparent)", storage_path: `${dir}/elements.png`, url: pub("elements.png"), sort_order: 5 });
      const { error: regErr } = await sb().from("panel_artboard_assets").insert(rows);
      if (regErr) console.warn(`[FLAT-ART] production-files asset insert failed (non-fatal): ${regErr.message}`);
      else console.log(`[FLAT-ART] registered ${rows.length} production-file assets on job ${jobId}`);
    } catch (e) { console.warn(`[FLAT-ART] production-files registration failed (non-fatal): ${(e as Error)?.message || e}`); }

    console.log(`[FLAT-ART] DONE ${vehicle} — artboard ${Math.round(artboardBytes.length / 1024)}KB, layers: bg + ${structuralLayer ? "structural" : "-"} + ${elementsLayer ? "branding" : "-"}`);
    return json({
      success: true,
      artboardUrl,
      backgroundUrl,
      structuralUrl,
      elementsUrl,
      combinedUrl,
      hadElements: !!elementsLayer,
      dimsSource,
      mode,
      panels: panels.map((p) => ({ label: p.label, widthInches: p.w, heightInches: p.h })),
    });
  } catch (err: any) {
    console.error("[FLAT-ART] error:", err?.message || err);
    return json({ success: false, error: err?.message || "designpro-flat-art failed" }, 500);
  }
});
