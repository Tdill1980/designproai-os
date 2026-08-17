// sample-metro-swatch-colors
// For each color, fetch its MetroRestyling swatch image (the product_sheet
// reference) and sample the true film color from the center of the image
// (center crop avoids white backgrounds, edges and watermarks). Stores the
// sampled hex in metro_swatch_colors for review + calibration. Read-only w.r.t.
// the live catalog — does not modify manufacturer_colors.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

function sampleCenter(img: Image): { hex: string; n: number } | null {
  const W = img.width, H = img.height;
  const x0 = Math.floor(W * 0.40), x1 = Math.ceil(W * 0.60);
  const y0 = Math.floor(H * 0.40), y1 = Math.ceil(H * 0.60);
  const px: [number, number, number, number][] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = img.getPixelAt(x + 1, y + 1); // 1-indexed
      const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255;
      px.push([r, g, b, 0.299 * r + 0.587 * g + 0.114 * b]);
    }
  }
  if (px.length < 16) return null;
  px.sort((a, b) => a[3] - b[3]);
  // drop the brightest 15% (specular highlight) and darkest 5% (shadow seams)
  const sel = px.slice(Math.floor(px.length * 0.05), Math.floor(px.length * 0.85));
  const med = (i: number) => {
    const arr = sel.map((p) => p[i]).sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] | 0;
  };
  const r = med(0), g = med(1), b = med(2);
  const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  return { hex, n: sel.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const manufacturer = body.manufacturer ?? "3M";
  const codes: string[] | null = Array.isArray(body.codes) ? body.codes : null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const batch = body.batch ?? 25;
  const redo = !!body.redo; // re-sample even if already done
  let q = sb.from("manufacturer_colors").select("product_code, official_name")
    .eq("manufacturer", manufacturer).eq("show_in_picker", true);
  if (codes) q = q.in("product_code", codes);
  const { data: allColors, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });

  // skip colors already sampled (unless redo) so repeated calls make progress
  let colors = allColors ?? [];
  if (!redo) {
    const { data: done } = await sb.from("metro_swatch_colors").select("product_code");
    const doneSet = new Set((done ?? []).map((d: any) => d.product_code));
    colors = colors.filter((c: any) => !doneSet.has(c.product_code));
  }
  const remainingBefore = colors.length;
  colors = colors.slice(0, batch);

  const results: any[] = [];
  for (const c of colors ?? []) {
    // prefer the product_sheet (swatch) image; fall back to any reference
    const { data: refs } = await sb.from("vinyl_reference_images")
      .select("image_url, image_type, source_url")
      .eq("manufacturer", manufacturer).eq("product_code", c.product_code)
      .order("image_type", { ascending: true }).limit(1);
    const ref = refs?.[0];
    if (!ref?.image_url) { results.push({ code: c.product_code, ok: false, reason: "no reference image" }); continue; }
    try {
      // fetch a downscaled version (Shopify CDN resize) — far faster to decode,
      // plenty of resolution for a centre-crop colour sample
      const sep = ref.image_url.includes("?") ? "&" : "?";
      const smallUrl = ref.image_url + sep + "width=320";
      const resp = await fetch(smallUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!resp.ok) { results.push({ code: c.product_code, ok: false, reason: "fetch " + resp.status }); continue; }
      const buf = new Uint8Array(await resp.arrayBuffer());
      const img = await Image.decode(buf);
      const s = sampleCenter(img);
      if (!s) { results.push({ code: c.product_code, ok: false, reason: "too small" }); continue; }
      await sb.from("metro_swatch_colors").upsert({
        product_code: c.product_code, color_name: c.official_name, sampled_hex: s.hex,
        pixels_used: s.n, source_url: ref.source_url, image_url: ref.image_url, updated_at: new Date().toISOString(),
      }, { onConflict: "product_code" });
      results.push({ code: c.product_code, ok: true, hex: s.hex });
    } catch (e) {
      results.push({ code: c.product_code, ok: false, reason: "decode: " + (e?.message ?? String(e)) });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  return new Response(JSON.stringify({ processed: results.length, ok, remaining: remainingBefore - results.length, results }, null, 2),
    { headers: { ...cors, "Content-Type": "application/json" } });
});
