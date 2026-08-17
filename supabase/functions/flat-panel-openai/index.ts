/**
 * flat-panel-openai
 *
 * Standalone flat-panel generator (independent of QC Artboard).
 * Pipeline: source image -> OpenAI /v1/images/edits (gpt-image-1)
 * -> server-side center-crop to the exact per-side aspect (ImageScript)
 * -> 4x upscale (Real-ESRGAN via upscale-production-panel) for print res.
 *
 * gpt-image-1 only emits fixed sizes (1024x1024 / 1536x1024 / 1024x1536),
 * so we pick the orientation that matches the side's real-world panel
 * aspect, then cover-crop to the exact aspect HERE (not in the browser —
 * a 25MP client canvas was hanging the page).
 *
 * Requires OPENAI_API_KEY in Supabase Edge secrets (org verified for
 * gpt-image-1). Reads the key case/whitespace-insensitively because the
 * stored secret name has a leading space (" OPENAI_API_KEY").
 *
 * Always returns HTTP 200 with { success, url, error } so the UI can show
 * the real reason instead of a generic "edge fail".
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

// Center cover-crop raw PNG bytes to an exact aspect ratio (w/h).
async function cropToAspect(bytes: Uint8Array, aspect: number): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const img = await Image.decode(bytes);
  const sw = img.width, sh = img.height;
  // FILL the exact panel rectangle: stretch the whole design to the target
  // aspect so the entire panel is the design, edge to edge — no center-crop
  // that chops the artwork, no letterbox bars. Vinyl is printed to the panel's
  // real per-side dimensions, so filling the rectangle is what's wanted here.
  const tw = sw;
  const th = Math.max(1, Math.round(sw / aspect));
  img.resize(tw, th);
  const out = await img.encode();
  return { bytes: out, w: img.width, h: img.height };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEnvCI(name: string): string | undefined {
  const d = Deno.env.get(name); if (d) return d.trim();
  const want = name.trim().toLowerCase();
  try { for (const [k, v] of Object.entries(Deno.env.toObject())) if (k.trim().toLowerCase() === want && v) return v.trim(); } catch (_e) { /* */ }
  return undefined;
}

// Real-world panel dimensions (inches) per side — drives orientation + scale.
const PANEL_INCHES: Record<string, { w: number; h: number }> = {
  driver_side: { w: 227, h: 76.4 },
  passenger_side: { w: 227, h: 76.4 },
  roof: { w: 227, h: 81.1 },
  hood: { w: 68, h: 40 },
  front: { w: 18.1, h: 17.5 },
  rear: { w: 18.1, h: 88.3 },
  front_bumper: { w: 120.5, h: 38 },
  rear_bumper: { w: 120, h: 38 },
};

type OpenAISize = "1024x1024" | "1024x1536" | "1536x1024";
function sizeForAspect(w: number, h: number): OpenAISize {
  const r = w / h;
  if (r > 1.15) return "1536x1024";       // landscape
  if (r < 0.87) return "1024x1536";       // portrait
  return "1024x1024";                       // ~square
}

async function editToFlatPanel(srcUrl: string, sideLabel: string, finish: string, intent: string, size: OpenAISize, key: string, backgroundOnly: boolean, noWheels: boolean): Promise<{ b64?: string; error?: string }> {
  let imgBlob: Blob;
  try {
    const ir = await fetch(srcUrl, { signal: AbortSignal.timeout(20_000) });
    if (!ir.ok) return { error: `source fetch ${ir.status}` };
    imgBlob = await ir.blob();
  } catch (e: any) { return { error: `source fetch failed: ${e?.message || e}` }; }

  const extra = intent?.trim() ? ` Design intent: "${intent.trim()}".` : "";
  const wheels = noWheels ? " EXCLUDE all wheels, tires, rims, and wheel wells — do not draw them; reconstruct the wrap design continuously across those areas so the panel is one clean uninterrupted flat graphic." : "";
  // CRITICAL prepress safeguard — the #1 production bug. The model must output ONLY
  // the raw wrap artwork. It must NEVER bake template/annotation marks or vehicle
  // geometry into the panel (this is what warped Rivera + stamped "TOP PANEL x=0%"
  // labels and barcodes onto the printable file). One flat texture per call.
  const SAFEGUARDS = ` CRITICAL: output ONLY the raw flat wrap artwork — absolutely DO NOT draw, render, stamp, label, or bake into the image any: panel names, side names, titles, dimensions, measurements, inch/percent values, scale indicators, crop marks, registration marks, cut lines, grid lines, coordinates, order numbers, watermarks, or barcodes (NEVER render text like "DRIVER SIDE", "TOP PANEL", "x=0%", "227\\"", "RP-100888", or similar annotations). DO NOT draw any vehicle body, silhouette, outline, doors, door handles, seams, windows, mirrors, lights, or wheel arches. The result is one clean rectangular print texture and nothing else.`;
  const prompt = backgroundOnly
    ? `Recreate the EXACT ${sideLabel} wrap design shown in this image as one FLAT, full-bleed 2D print panel. Reproduce its colors, gradients, patterns, textures, and graphic layout PRECISELY as they appear on the ${sideLabel} — do NOT redesign, simplify, restyle, recolor, rearrange, crop differently, or invent anything; match the artwork exactly. Reproduce ONLY the background design: omit ALL text, words, lettering, numbers, logos, icons, and symbols, leaving those areas as clean continuous background so real artwork is placed on top later. Perfectly straight-on and flattened: no vehicle, no 3D, no perspective, no glare, no reflections, no shadows, no margins.${wheels} Fill the frame edge to edge. ${finish} finish.${SAFEGUARDS}${extra}`
    : `Recreate the EXACT ${sideLabel} wrap design shown in this image as one FLAT, full-bleed 2D print panel. Keep the design, colors, gradients, patterns, logos, and text EXACTLY as they appear on the ${sideLabel} — reproduce them faithfully and do NOT redesign, simplify, restyle, recolor, rearrange, or invent anything; match the artwork exactly. Perfectly straight-on and flattened: no vehicle, no 3D, no perspective, no glare, no reflections, no shadows, no background, no margins.${wheels} Fill the frame edge to edge. ${finish} finish.${SAFEGUARDS}${extra}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("prompt", prompt);
      form.append("size", size);
      form.append("quality", "high");
      form.append("input_fidelity", "high");
      form.append("image", imgBlob, "source.png");
      const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(180_000) });
      if (!r.ok) {
        const t = await r.text();
        console.error(`[flat-panel-openai] edits ${r.status}: ${t.slice(0, 400)}`);
        if (attempt < 2 && r.status >= 500) { await new Promise(x => setTimeout(x, 2000)); continue; }
        return { error: `OpenAI image edit ${r.status}: ${t.slice(0, 260)}` };
      }
      const j = await r.json();
      const b64 = j?.data?.[0]?.b64_json;
      return b64 ? { b64 } : { error: "OpenAI returned no image" };
    } catch (e: any) {
      if (attempt < 2) await new Promise(x => setTimeout(x, 2000)); else return { error: String(e?.message || e) };
    }
  }
  return { error: "edits failed" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { imageUrl, side = "driver_side", finish = "Gloss", prompt = "", upscale = true, backgroundOnly = false, noWheels = false, widthIn, heightIn } = body;
    if (!imageUrl) return new Response(JSON.stringify({ success: false, error: "Missing imageUrl" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const key = getEnvCI("OPENAI_API_KEY") || "";
    if (!key) {
      let seen: string[] = [];
      try { seen = Object.keys(Deno.env.toObject()).filter((k) => /openai|api_key/i.test(k)); } catch { /* */ }
      return new Response(JSON.stringify({ success: false, error: `OPENAI_API_KEY not readable. Visible: [${seen.join(", ") || "none"}]` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sideKey = String(side).toLowerCase().replace(/[\s-]+/g, "_");
    // Caller can pass the actual vehicle's per-side dimensions (GENIE panel
    // dims from the QC job); fall back to the generic per-side constants.
    const dims = (Number(widthIn) > 0 && Number(heightIn) > 0)
      ? { w: Number(widthIn), h: Number(heightIn) }
      : (PANEL_INCHES[sideKey] || PANEL_INCHES.driver_side);
    const size = sizeForAspect(dims.w, dims.h);
    const sideLabel = sideKey.replace(/_/g, " ");

    const out = await editToFlatPanel(imageUrl, sideLabel, finish, prompt, size, key, !!backgroundOnly, !!noWheels);
    if (!out.b64) return new Response(JSON.stringify({ success: false, error: out.error || "generation failed" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const bin = atob(out.b64); const raw = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);

    // Center cover-crop to the exact panel aspect (server-side, not in the browser).
    let bytes = raw; let cropW = 0, cropH = 0;
    try {
      const cropped = await cropToAspect(raw, dims.w / dims.h);
      bytes = cropped.bytes; cropW = cropped.w; cropH = cropped.h;
    } catch (e) { console.error("[flat-panel-openai] crop failed, using uncropped:", String(e)); }

    const nativeName = `panels/flat-panel-openai/${Date.now()}_${sideKey}_scaled.png`;
    const { error: upErr } = await supabase.storage.from("wrap-files").upload(nativeName, bytes, { contentType: "image/png", upsert: true });
    if (upErr) return new Response(JSON.stringify({ success: false, error: "Upload failed: " + upErr.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: { publicUrl: nativeUrl } } = supabase.storage.from("wrap-files").getPublicUrl(nativeName);

    let finalUrl = nativeUrl;
    let upscaled = false;
    if (upscale) {
      try {
        const { data: ud, error: ue } = await supabase.functions.invoke("upscale-production-panel", { body: { image_url: nativeUrl, scale: 4 } });
        if (!ue && ud?.success && ud?.upscaled_url) { finalUrl = ud.upscaled_url; upscaled = true; }
      } catch (_e) { /* keep cropped */ }
    }

    return new Response(JSON.stringify({
      success: true,
      url: finalUrl,
      scaledUrl: nativeUrl,
      upscaled,
      side: sideKey,
      openaiSize: size,
      cropW, cropH,
      targetInches: dims,
      targetAspect: dims.w / dims.h,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[flat-panel-openai] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
