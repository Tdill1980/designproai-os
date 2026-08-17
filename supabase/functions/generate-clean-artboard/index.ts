/**
 * generate-clean-artboard — DETERMINISTIC 1:1 source→rectangle mapper.
 *
 * NO AI. NO Gemini. Takes the exact source pixel bytes and maps them edge-to-edge
 * onto a flat rectangular print canvas using ImageScript. Zero hallucination —
 * the output is the source's real pixels, resized to the target rectangle and
 * stamped with a physical-size (pHYs) DPI header for the RIP.
 *
 * Body (any one source): {
 *   original3DSourceBase64? | sourceImageBase64? | sourceUrl?,   // the design pixels
 *   jobID?, targetWidth?=4096, targetHeight?=2304,               // 16:9 4K default
 *   widthInches?, heightInches?, bleedInches?=0, dpi?=100,       // optional true-size mode
 *   fit?="stretch"|"cover",                                      // edge-to-edge fill
 * }
 * Returns: { success, url, path, pixelWidth, pixelHeight }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as b64decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BUCKET = "wrap-files";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Inject a pHYs chunk so the print file declares its true physical DPI (no pixels touched).
const _crc = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = _crc[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngWithDpi(png: Uint8Array, dpiX: number, dpiY: number): Uint8Array {
  if (png.length < 33 || png[0] !== 0x89 || png[12] !== 0x49 || png[13] !== 0x48) return png;
  const chunk = new Uint8Array(21); const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  dv.setUint32(8, Math.max(1, Math.round(dpiX / 0.0254))); dv.setUint32(12, Math.max(1, Math.round(dpiY / 0.0254))); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + 21);
  out.set(png.subarray(0, 33), 0); out.set(chunk, 33); out.set(png.subarray(33), 54);
  return out;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { jobID, jobId, sourceUrl } = body;
    const job = jobID || jobId || "job";
    const b64 = body.original3DSourceBase64 || body.sourceImageBase64 || "";

    // 1) Get the exact source pixel bytes — from base64 or by fetching the URL. NO AI.
    let srcBytes: Uint8Array | null = null;
    if (b64) {
      try { srcBytes = b64decode(String(b64).replace(/^data:[^,]+,/, "")); }
      catch (e) { return json({ success: false, error: `bad base64: ${e}` }, 400); }
    } else if (sourceUrl) {
      // Pull through the storage image-transform (pre-downscaled) so we never
      // decode a raw 4K+ source in-worker (the 546 OOM). format=origin keeps it a
      // real decodable image. Non-storage URLs fetch directly.
      const su = String(sourceUrl);
      const t = su.includes("/storage/v1/object/")
        ? su.replace("/storage/v1/object/", "/storage/v1/render/image/") + (su.includes("?") ? "&" : "?") + "width=3000&height=3000&resize=contain&format=origin"
        : su;
      let r = await fetch(t, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) r = await fetch(su, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) return json({ success: false, error: `fetch source ${r.status}` }, 200);
      srcBytes = new Uint8Array(await r.arrayBuffer());
    }
    if (!srcBytes || !srcBytes.length) return json({ success: false, error: "Provide original3DSourceBase64, sourceImageBase64, or sourceUrl" }, 400);

    // 2) Target rectangle. Either explicit pixels, or true-size (inches × dpi + bleed).
    const dpi = Number(body.dpi) > 0 ? Number(body.dpi) : 100;
    let targetW: number, targetH: number;
    let physWin = 0, physHin = 0;   // true physical print size (incl bleed), when given
    if (Number(body.widthInches) > 0 && Number(body.heightInches) > 0) {
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 0;
      physWin = Number(body.widthInches) + 2 * bleed;
      physHin = Number(body.heightInches) + 2 * bleed;
      targetW = Math.round(physWin * dpi);
      targetH = Math.round(physHin * dpi);
    } else {
      targetW = Number(body.targetWidth) > 0 ? Number(body.targetWidth) : 4096;
      targetH = Number(body.targetHeight) > 0 ? Number(body.targetHeight) : 2304;
    }
    // Cap to keep the worker in-memory (status-546 guard). 4000px base; the Topaz
    // Stage-4 upscale takes it the rest of the way to true print density.
    const cap = 4000, longest = Math.max(targetW, targetH);
    if (longest > cap) { const k = cap / longest; targetW = Math.max(1, Math.round(targetW * k)); targetH = Math.max(1, Math.round(targetH * k)); }

    // 3) DETERMINISTIC map: decode → fill the rectangle edge-to-edge → encode. Zero pixels invented.
    const src = await Image.decode(srcBytes);
    let outImg: Image;
    if (String(body.fit || "stretch") === "cover") {
      // cover-fill keeping aspect (crop overflow)
      const sr = src.width / src.height, tr = targetW / targetH;
      let cw: number, ch: number, cx: number, cy: number;
      if (sr > tr) { ch = src.height; cw = Math.max(1, Math.round(ch * tr)); cx = Math.round((src.width - cw) / 2); cy = 0; }
      else { cw = src.width; ch = Math.max(1, Math.round(cw / tr)); cx = 0; cy = Math.round((src.height - ch) / 2); }
      src.crop(cx, cy, cw, ch); src.resize(targetW, targetH); outImg = src;
    } else {
      outImg = src.resize(targetW, targetH);   // stretch edge-to-edge corner-to-corner
    }
    // Declare the EFFECTIVE DPI so the file's physical size is correct even after
    // the cap: physical width = pixels / dpi must equal the true panel inches.
    const dpiX = physWin > 0 ? targetW / physWin : dpi;
    const dpiY = physHin > 0 ? targetH / physHin : dpi;
    const png = pngWithDpi(await outImg.encode(), dpiX, dpiY);

    // 4) Upload the exact 1:1 mapped file.
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const path = `production-prints/${job}_true_1to1_${Date.now()}.png`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
    if (upErr) return json({ success: false, error: `upload: ${upErr.message}` }, 200);
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
    const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);

    return json({ success: true, url: signed?.signedUrl || pub?.publicUrl || "", path, pixelWidth: targetW, pixelHeight: targetH, deterministic: true });
  } catch (err) {
    console.error("[generate-clean-artboard] Error:", err);
    return json({ success: false, error: String(err) }, 200);
  }
});
