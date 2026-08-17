/**
 * slice-flat-panel
 *
 * Build-Files' OWN per-side slicer. Given the 2D production proof (the multi-view
 * sheet that already shows every panel) and ONE side, it outputs a single flat,
 * full-bleed, print-ready layer for that side. Two-pass clone architecture:
 *   layer: "background" — the wrap artwork at size, ALL logos/text stripped
 *   layer: "overlay"    — ONLY the logos/text/emblems, on a TRANSPARENT background
 *   layer: "graphics"   — background + branding combined (back-compat)
 * So the caller feeds the proof to the AI twice (background, then transparent
 * overlay), giving a clean print background + an editable overlay layer.
 *
 * It does NOT route through design-panel-ai-generate's artboard mode (which
 * returned the whole proof sheet) and never injects company branding — the only
 * branding is whatever the proof itself shows.
 *
 * Body: { sourceUrl, side, layer?, withGraphics?, vehicleYear, vehicleMake, vehicleModel, jobId? }
 * Returns: { success, panelUrl, layer }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

// Chroma key: the overlay is generated on a solid PURE GREEN backdrop (#00FF00),
// then that green is knocked out to real alpha so we save a TRUE transparent PNG
// (Gemini only returns opaque JPEG/PNG — it cannot emit reliable alpha itself).
const CHROMA = "#00FF00";
async function knockoutChroma(jpegOrPng: Uint8Array): Promise<Uint8Array> {
  const im = await Image.decode(jpegOrPng);
  const bmp = im.bitmap; // RGBA, 4 bytes per pixel
  for (let i = 0; i < bmp.length; i += 4) {
    const r = bmp[i], g = bmp[i + 1], b = bmp[i + 2];
    // Pixel is "green screen" when green dominates and red/blue are low.
    if (g > 150 && r < 120 && b < 120 && g - r > 60 && g - b > 60) {
      bmp[i + 3] = 0; // fully transparent
    }
  }
  return await im.encode(); // PNG (with alpha)
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const _pool: string[] = [];
let _loaded = false;
let _idx = 0;
function _load() {
  if (_loaded) return;
  const p = Deno.env.get("GOOGLE_AI_API_KEY");
  if (p) _pool.push(p);
  for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) _pool.push(k); }
  _loaded = true;
}
function getKey(): string { _load(); if (!_pool.length) throw new Error("No GOOGLE_AI_API_KEY"); const k = _pool[_idx % _pool.length]; _idx++; return k; }
function hasKey(): boolean { _load(); return _pool.length > 0; }

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))));
  return btoa(s);
}
async function fetchImg(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return { b64: toBase64(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/jpeg" };
  } catch { return null; }
}

// Per-side output proportions — sides/bumpers are wide, hood/roof closer to square.
// Only used as a fallback when real panel dimensions aren't supplied.
const RATIO: Record<string, string> = {
  "DRIVER SIDE": "21:9", "PASSENGER SIDE": "21:9",
  "FRONT": "16:9", "REAR": "16:9",
  "HOOD": "4:3", "ROOF": "4:3",
};

// Gemini imageConfig only accepts a fixed set of aspect ratios — pick the one
// closest to the panel's TRUE width:height (from the dims DB) so the output
// rectangle matches the real panel. Exact true-size is enforced later at assembly.
const SUPPORTED: Array<[string, number]> = [
  ["9:16", 0.5625], ["2:3", 0.6667], ["3:4", 0.75], ["4:5", 0.8],
  ["1:1", 1], ["5:4", 1.25], ["4:3", 1.3333], ["3:2", 1.5], ["16:9", 1.7778], ["21:9", 2.3333],
];
function ratioFromDims(w: number, h: number): string {
  const r = w / h;
  let best = SUPPORTED[0]; let bd = Infinity;
  for (const c of SUPPORTED) { const d = Math.abs(c[1] - r); if (d < bd) { bd = d; best = c; } }
  return best[0];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!hasKey()) return new Response(JSON.stringify({ success: false, error: "No Gemini key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { sourceUrl, refUrl, side, layer, withGraphics, dimW, dimH, bleedIn, vehicleYear, vehicleMake, vehicleModel, jobId } = await req.json();
    if (!sourceUrl || !side) return new Response(JSON.stringify({ success: false, error: "Missing sourceUrl or side" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // layer wins; withGraphics kept for back-compat (true → graphics, false → background)
    const lyr: "background" | "overlay" | "graphics" =
      layer === "overlay" || layer === "background" || layer === "graphics"
        ? layer
        : (withGraphics === false ? "background" : "graphics");

    const img = await fetchImg(sourceUrl);
    if (!img) return new Response(JSON.stringify({ success: false, error: "Could not fetch source proof" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    // Per-side EXACT reference (this side's own render) — so text/logos are copied
    // precisely instead of redrawn/garbled when extracting from the busy proof sheet.
    const refImg = refUrl ? await fetchImg(refUrl) : null;

    const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ") || "vehicle";
    const SIDE = String(side).toUpperCase();
    // True panel dimensions (inches) drive the output rectangle when supplied;
    // otherwise fall back to the per-side ratio guess.
    const hasDims = Number(dimW) > 0 && Number(dimH) > 0;
    const ratio = hasDims ? ratioFromDims(Number(dimW), Number(dimH)) : (RATIO[SIDE] || "16:9");
    const bleed = Number(bleedIn) > 0 ? Number(bleedIn) : 0;
    const dimRule = hasDims
      ? `\nThis ${SIDE} panel is ${dimW}" wide x ${dimH}" tall${bleed ? ` INCLUDING a ${bleed}" bleed on every side` : ""} — compose the artwork to fill that exact rectangle proportion and run it FULLY to all four edges past the trim (true full bleed, no border, no margin, nothing important within ${bleed || 1}" of the edge).`
      : "";
    const refRule = refImg
      ? `\nA SECOND image is attached: the exact ${SIDE} view of this vehicle. Use it as the source of truth for that panel's exact graphics, colors, logos and LETTERING — reproduce every word EXACTLY as written (do not garble, drop, or invent letters). Copy text character-for-character.`
      : "";
    const brandRule =
      lyr === "overlay"
        ? `Fill the ENTIRE frame with solid pure green ${CHROMA} (a green screen). On top of that green, paint ONLY the branding ELEMENTS from that panel — the logos, company name, phone number, website, and any lettering/emblems — in their real colors, in the same position and scale they have on the panel. The green is a chroma backdrop that will be removed to transparency, so use NO green in the branding itself and do NOT paint the wrap background artwork, pattern, vehicle, or any other fill — pure green everywhere except the branding.`
        : lyr === "background"
          ? `Output ONLY the background artwork — the colors, pattern, gradient and graphic flow. REMOVE every logo, company name, phone number, website and piece of lettering so the panel has nothing readable on it.`
          : `Reproduce that panel's wrap artwork EXACTLY as shown — including every graphic, logo, company name, phone number, website and piece of lettering on it. Do not add, remove, or invent any branding.`;

    // 3 prompt tiers — shorten on a NO_IMAGE retry (shorter prompts emit images
    // more reliably). Locked model gemini-3-pro-image-preview, no model fallback.
    const tiers = [
      `The attached image is a 2D vehicle-wrap PRODUCTION PROOF SHEET for a ${vehicle}: it lays out every wrap panel (driver side, passenger side, hood, roof, front, rear) with labels, dimension lines, a title bar and a signature bar.

Output ONE image: the ${SIDE} panel ONLY, as a single FLAT, full-bleed, print-ready wrap panel — the wrap GRAPHIC itself as a print file, filling the entire frame edge to edge.
${brandRule}${dimRule}${refRule}
Do NOT include: any other panel, the vehicle body/windows/wheels/tires, the title bar, dimension lines, arrows, panel labels, the approval/signature bar, the page background, or any white margin or border. Do not draw any text of your own beyond reproducing the panel's own lettering exactly.`,
      `Flat full-bleed ${SIDE} wrap print panel for a ${vehicle}, taken from the attached 2D proof sheet. ${brandRule}${dimRule}${refRule} Only that one panel's artwork, edge to edge — no vehicle, no other panels, no labels, no dimension lines, no margins.`,
      `${SIDE} wrap panel only, flat full-bleed print file, from the attached proof. ${brandRule} No vehicle, no labels, no margins.`,
    ];

    let imageB64 = "", imageMime = "image/png", lastErr = "";
    const MAX = 4;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      const tier = Math.min(attempt - 1, tiers.length - 1);
      const parts: Array<Record<string, unknown>> = [{ text: tiers[tier] }, { inlineData: { mimeType: img.mime, data: img.b64 } }];
      if (refImg) {
        parts.push({ text: `EXACT ${SIDE} reference — copy its graphics and lettering precisely:` });
        parts.push({ inlineData: { mimeType: refImg.mime, data: refImg.b64 } });
      }
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getKey()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: ratio, imageSize: lyr === "overlay" ? "2K" : "4K" } } }),
            signal: AbortSignal.timeout(120000),
          }
        );
        if (!resp.ok) { lastErr = `Gemini ${resp.status}`; if (attempt < MAX) await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
        const result = await resp.json();
        const rParts = result.candidates?.[0]?.content?.parts;
        const reason = result.candidates?.[0]?.finishReason;
        if (rParts) for (const p of rParts) { if (p.inlineData) { imageB64 = p.inlineData.data; imageMime = p.inlineData.mimeType || "image/png"; break; } }
        if (imageB64) break;
        lastErr = reason === "NO_IMAGE" ? "NO_IMAGE" : `No image. finishReason: ${reason}`;
        if (attempt < MAX) await new Promise(r => setTimeout(r, 1500 * attempt));
      } catch (e) { lastErr = String(e); if (attempt < MAX) await new Promise(r => setTimeout(r, 2000 * attempt)); }
    }

    if (!imageB64) return new Response(JSON.stringify({ success: false, error: lastErr || "Failed" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const bin = atob(imageB64);
    let data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);

    // Overlay layer: knock the green chroma out to REAL alpha and save a true
    // transparent PNG (Gemini returned an opaque JPEG/PNG). Non-fatal: if the
    // knockout fails we keep the original so the build never dies on it.
    let outMime = imageMime;
    if (lyr === "overlay") {
      try {
        data = await knockoutChroma(data);
        outMime = "image/png";
      } catch (e) { console.warn(`[slice-flat-panel] chroma knockout failed, keeping original: ${String(e)}`); }
    }

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization");
    let uid = "panels";
    if (auth) { try { const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", "")); if (user) uid = user.id; } catch { /* anon */ } }

    const ext = outMime.includes("jpeg") ? "jpg" : outMime.includes("webp") ? "webp" : "png";
    const safeSide = SIDE.replace(/[^A-Z0-9]+/g, "-");
    const path = `renders/${uid}/flat-panels/${jobId || "job"}/${safeSide}_${lyr}_${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from("wrap-files").upload(path, data, { contentType: outMime, upsert: true });
    if (upErr) return new Response(JSON.stringify({ success: false, error: "Upload failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: { publicUrl } } = db.storage.from("wrap-files").getPublicUrl(path);
    console.log(`[slice-flat-panel] ${vehicle} · ${SIDE} · ${lyr} → ${publicUrl}`);
    return new Response(JSON.stringify({ success: true, panelUrl: publicUrl, layer: lyr }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[slice-flat-panel] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
