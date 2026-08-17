/**
 * flat-panel-composite
 *
 * Flattens an extracted artwork element (transparent PNG from Revision Studio
 * LayerLift) onto an AI-generated flat-panel BACKGROUND, server-side, at full
 * resolution — so the browser never has to push a 25MP canvas.
 *
 * Body: {
 *   backgroundUrl: string,   // the scaled/upscaled flat background
 *   overlayUrl: string,      // transparent PNG to place on top
 *   x: number, y: number,    // top-left position as fractions (0..1) of bg
 *   w: number,               // overlay width as a fraction (0..1) of bg width
 * }
 * Returns { success, url } (always HTTP 200 with the real error on failure).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`fetch ${r.status} for ${url.slice(0, 80)}`);
  return new Uint8Array(await r.arrayBuffer());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { backgroundUrl, overlayUrl, x = 0.1, y = 0.1, w = 0.3 } = await req.json();
    if (!backgroundUrl || !overlayUrl) {
      return new Response(JSON.stringify({ success: false, error: "Missing backgroundUrl or overlayUrl" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [bgBytes, ovBytes] = await Promise.all([fetchBytes(backgroundUrl), fetchBytes(overlayUrl)]);
    const bg = await Image.decode(bgBytes);
    const ov = await Image.decode(ovBytes);

    const targetW = Math.max(1, Math.round(w * bg.width));
    const targetH = Math.max(1, Math.round(targetW * (ov.height / ov.width)));
    ov.resize(targetW, targetH);

    const px = Math.round(x * bg.width);
    const py = Math.round(y * bg.height);
    bg.composite(ov, px, py);

    const out = await bg.encode();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const name = `panels/flat-panel-openai/composited/${Date.now()}_final.png`;
    const { error: upErr } = await supabase.storage.from("wrap-files").upload(name, out, { contentType: "image/png", upsert: true });
    if (upErr) return new Response(JSON.stringify({ success: false, error: "Upload failed: " + upErr.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(name);

    return new Response(JSON.stringify({ success: true, url: publicUrl, width: bg.width, height: bg.height }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[flat-panel-composite] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
