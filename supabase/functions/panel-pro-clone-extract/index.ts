// deploy: panel-pro-clone-extract — pixel-preserving panel extract (Vertex mask-inpaint)
/**
 * panel-pro-clone-extract — the PIXEL-PRESERVING extract.
 *
 * The generative extract (panel-pro-extract) asks Gemini to redraw the wrap, so
 * iconic art (flags, logos) gets idealized — it never copies the truck's exact
 * pixels. This path is different: it KEEPS the real wrap pixels and only synthesizes
 * the small vehicle gaps, using Vertex Imagen mask-inpaint (which actually composites
 * kept pixels + generated fill — something Gemini's generateContent cannot do).
 *
 * Flow:
 *   1. Fetch the 3D render, crop to the wrapped design (drop floor/walls/wheels mass).
 *   2. Gemini builds a BINARY MASK: white over the parts to remove (windows, glass,
 *      mirrors, handles, wheels, tires, bumpers, chrome, glare, leftover background),
 *      black over the wrap artwork to KEEP. (Idealization is irrelevant for a mask —
 *      we only need region shapes.)
 *   3. Vertex INPAINT_REMOVAL fills the white regions by continuing the surrounding
 *      wrap, and leaves every black-region pixel EXACTLY as the real artwork.
 *   4. Trim the uniform border so the design sits edge-to-edge.
 *
 * Requires Vertex (VERTEX_AI_SERVICE_ACCOUNT_KEY + GCP_PROJECT_ID). When it isn't
 * configured it returns { success:false, needsVertex:true } so the caller falls back
 * to the generative extract (no breakage).
 *
 * POST { imageUrl, widthInches?, heightInches?, label?, sideKey?, userId?, jobId?, maskDilation? }
 * → { success, panelUrl, url, mode:"clone", maskUrl } | { success:false, needsVertex? }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  uploadToStorage,
  getPublicUrl,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "../_shared/panelizer-os/storage.ts";
import { tempPath, GEMINI_IMAGE_MODEL } from "../_shared/panelizer-os/constants.ts";
import { vertexInpaintRemoval, getImagenBackend } from "../_shared/imagen-client.ts";

const MAX_FETCH_WIDTH = 2048;

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Crop to the saturated wrap region (drops gray studio / floor / glass / wheels mass). */
async function cropToDesign(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const W = img.width, H = img.height;
  let minX = W, minY = H, maxX = 0, maxY = 0, hits = 0;
  const step = Math.max(1, Math.round(Math.min(W, H) / 500));
  for (let y = 1; y <= H; y += step) {
    for (let x = 1; x <= W; x += step) {
      const px = img.getPixelAt(x, y);
      const r = (px >> 24) & 0xff, g = (px >> 16) & 0xff, b = (px >> 8) & 0xff;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat > 0.45 && max > 70) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; hits++; }
    }
  }
  if (hits < 30 || maxX <= minX || maxY <= minY) return new Uint8Array(await img.encode());
  const mx = Math.round(W * 0.04), my = Math.round(H * 0.04);
  const x0 = Math.max(0, minX - mx), y0 = Math.max(0, minY - my);
  const cw = Math.max(1, Math.min(W, maxX + mx) - x0), ch = Math.max(1, Math.min(H, maxY + my) - y0);
  return new Uint8Array(await img.clone().crop(x0, y0, cw, ch).encode());
}

/** Ask Gemini for a binary remove-mask, then force it to pure black/white at the source size. */
async function buildMask(srcB64: string, W: number, H: number): Promise<Uint8Array | null> {
  const prompt =
    "Output a BLACK-AND-WHITE MASK of this vehicle-wrap photo, same framing. Paint PURE WHITE (#FFFFFF) over " +
    "everything that is NOT the printed wrap artwork: the windows, glass, mirrors, door handles, wheels, tires, " +
    "bumpers, chrome/trim, any glare or reflection, and any leftover background or ground. Paint PURE BLACK (#000000) " +
    "over the wrap artwork itself (the printed design/graphics on the body panels, doors and bed). Output ONLY the mask " +
    "as flat solid white and solid black regions — no gray, no gradients, no text, no other content.";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: srcB64 } }, { text: prompt }] }],
            generationConfig: { temperature: 0, responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K" } },
          }),
          signal: AbortSignal.timeout(70_000),
        },
      );
      if (!resp.ok) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500)); continue; } return null; }
      const result = await resp.json();
      let maskB64: string | null = null;
      for (const p of (result?.candidates?.[0]?.content?.parts || [])) if (p?.inlineData?.data) { maskB64 = p.inlineData.data; break; }
      if (!maskB64) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500)); continue; } return null; }
      // Resize to source dims + binarize so the mask is exactly white/black.
      const m = (await Image.decode(base64ToUint8Array(maskB64))).resize(W, H);
      for (let y = 1; y <= H; y++) {
        for (let x = 1; x <= W; x++) {
          const px = m.getPixelAt(x, y);
          const r = (px >> 24) & 0xff, g = (px >> 16) & 0xff, b = (px >> 8) & 0xff;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          m.setPixelAt(x, y, lum > 128 ? 0xffffffff : 0x000000ff);
        }
      }
      return new Uint8Array(await m.encode());
    } catch (_e) { if (attempt < 2) await new Promise((r) => setTimeout(r, 2000)); }
  }
  return null;
}

/** Trim a uniform near-background border so the design is edge-to-edge. */
async function trimBorder(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const W = img.width, H = img.height;
  if (W < 16 || H < 16) return bytes;
  const isBg = (x: number, y: number) => {
    const px = img.getPixelAt(x, y);
    const r = (px >> 24) & 0xff, g = (px >> 16) & 0xff, b = (px >> 8) & 0xff;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return (max === 0 ? 0 : (max - min) / max) < 0.12;
  };
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  const rowBg = (y: number) => { let n = 0; for (let x = 1; x <= W; x++) if (isBg(x, y + 1)) n++; return n / W > 0.99; };
  const colBg = (x: number) => { let n = 0; for (let y = 1; y <= H; y++) if (isBg(x + 1, y + 1)) n++; return n / H > 0.99; };
  while (top < bottom && rowBg(top)) top++;
  while (bottom > top && rowBg(bottom)) bottom--;
  while (left < right && colBg(left)) left++;
  while (right > left && colBg(right)) right--;
  const cw = right - left + 1, ch = bottom - top + 1;
  if (cw < W * 0.5 || ch < H * 0.5) return bytes; // refuse over-aggressive trim
  if (cw === W && ch === H) return bytes;
  return new Uint8Array(await img.clone().crop(left, top, cw, ch).encode());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (getImagenBackend() !== "vertex") {
      return jsonResponse({ success: false, needsVertex: true, error: "Vertex Imagen not configured (need VERTEX_AI_SERVICE_ACCOUNT_KEY + GCP_PROJECT_ID)" }, 200);
    }
    if (!hasGeminiKey()) return jsonResponse({ success: false, error: "No GOOGLE_AI_API_KEY configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const imageUrl: string = body.imageUrl || body.driverUrl || "";
    const userId: string = body.userId || "anonymous";
    const jobId: string = body.jobId || `clone-${Date.now()}`;
    const sideKey: string = body.sideKey || "panel";
    if (!imageUrl) return jsonResponse({ success: false, error: "imageUrl is required" }, 400);

    // 1) Fetch render (memory-safe transform) and crop to the wrap.
    let fetchUrl = imageUrl;
    if (imageUrl.includes("/storage/v1/object/")) {
      fetchUrl = imageUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=${MAX_FETCH_WIDTH}&resize=contain&quality=90`;
    }
    let r = await fetch(fetchUrl, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok && fetchUrl !== imageUrl) r = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return jsonResponse({ success: false, error: `fetch ${r.status}` }, 400);
    const cropped = await cropToDesign(new Uint8Array(await r.arrayBuffer()));
    const cImg = await Image.decode(cropped);
    const W = cImg.width, H = cImg.height;
    const srcB64 = uint8ArrayToBase64(cropped);

    // 2) Build the remove-mask (white = remove vehicle parts, black = keep wrap).
    const maskBytes = await buildMask(srcB64, W, H);
    if (!maskBytes) return jsonResponse({ success: false, error: "mask generation failed" }, 502);
    const maskPath = tempPath(userId, jobId, `clone-mask-${sideKey}-${Date.now()}`);
    await uploadToStorage(maskPath, maskBytes, "image/png");
    const maskUrl = getPublicUrl(maskPath);

    // 3) Vertex inpaint-removal: keep the real wrap pixels, fill only the white gaps
    //    by continuing the surrounding artwork.
    const res = await vertexInpaintRemoval({
      sourceImageBase64: srcB64,
      maskImageBase64: uint8ArrayToBase64(maskBytes),
      prompt: "Continue the surrounding vehicle-wrap design seamlessly into the masked areas, matching the existing colors, pattern and flow. Do not add new objects.",
      maskDilation: typeof body.maskDilation === "number" ? body.maskDilation : 0.02,
      baseSteps: 35,
    });
    if (!res.success || !res.imageBase64) return jsonResponse({ success: false, error: res.error || "vertex inpaint failed" }, 502);

    // 4) Trim uniform border → edge-to-edge.
    let outBytes = base64ToUint8Array(res.imageBase64);
    try { outBytes = await trimBorder(outBytes); } catch (_t) { /* keep on trim error */ }
    const outPath = tempPath(userId, jobId, `panel-pro-clone-${sideKey}-${Date.now()}`);
    await uploadToStorage(outPath, outBytes, "image/png");
    const url = `${getPublicUrl(outPath)}?t=${Date.now()}`;
    return jsonResponse({ success: true, mode: "clone", panelUrl: url, url, maskUrl });
  } catch (err: any) {
    console.error("[PANEL-PRO-CLONE-EXTRACT] error:", err?.message || err);
    return jsonResponse({ success: false, error: err?.message || "clone extract failed" }, 500);
  }
});
