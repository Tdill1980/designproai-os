import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

export { buildPrompt } from "./designpro-text-layer-prompt.ts";

// ── Chroma key → TRUE transparency ──────────────────────────────────────────
// Gemini bakes a background instead of emitting alpha, so we render the art on a
// flat magenta backdrop (see buildPrompt) and remove it here: every magenta-ish
// pixel becomes fully transparent, then we tight-crop to the remaining artwork.
// Pure Deno (imagescript) — no sharp, no extra service. The result is a real
// alpha PNG the canvas + GENIE panelizer can composite, not an opaque block.
export async function chromaKeyToAlpha(pngBytes: Uint8Array, strict = false): Promise<Uint8Array> {
  let img: any;
  try {
    img = await Image.decode(pngBytes);
  } catch {
    if (strict) throw new Error("proof_logo_image_unreadable");
    return pngBytes; // undecodable — keep original rather than lose the art
  }
  const W = img.width as number;
  const H = img.height as number;
  const bmp = img.bitmap as Uint8ClampedArray; // RGBA, length W*H*4
  let minX = W, minY = H, maxX = -1, maxY = -1;
  let transparent = 0;
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const r = bmp[i], g = bmp[i + 1], b = bmp[i + 2];
    // magenta backdrop: strong red + strong blue, weak green
    if (r > 140 && b > 140 && g < 120) {
      bmp[i + 3] = 0; // → fully transparent
      transparent++;
    } else {
      const x = p % W, y = (p / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Nothing survived (all magenta?) — return the keyed full frame as-is.
  if (strict && (!transparent || maxX < minX || maxY < minY)) throw new Error("proof_logo_alpha_invalid");
  if (maxX < minX || maxY < minY) return await img.encode();
  // Tight crop to the artwork with a small even margin.
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);
  try {
    img.crop(minX, minY, maxX - minX + 1, maxY - minY + 1);
  } catch { /* keep uncropped if crop fails */ }
  return await img.encode();
}
