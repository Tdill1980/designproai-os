/**
 * composite-layers — headless (Deno) layer compositor for DesignIQ.
 *
 * Places crisp IMAGE layers (a LogoPro logo lockup, a generated photo-subject
 * panel, a QR code) onto an AI-generated base-art render at normalized
 * coordinates, then returns flattened PNG bytes. This is the "build it from
 * layers" half of the architecture — the part that survives the art-model swap.
 *
 * Image-on-image only, on purpose: it relies solely on `imagescript` (already
 * proven across this codebase, e.g. panelizer-step-fill), so there is no fragile
 * server-side font rendering. The biggest brand element — the company-name
 * lockup — comes in as a LogoPro PNG, so it stays razor-sharp without painting
 * text. (A small contact-bar text layer can be added later as its own step.)
 *
 * Coordinates use the same normalized placement model as the existing
 * client-side compositor (src/lib/logo-composite.ts) and the logo_layers data:
 * x/y are the layer CENTER as a 0–1 fraction of the frame; width is a 0–1
 * fraction of frame width; height is derived from the layer's aspect ratio.
 */

import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

export interface ImageLayer {
  /** Storage/HTTP URL of the layer art (PNG with transparency recommended). */
  url: string;
  /** Layer center X as a fraction of frame width (0–1). */
  xPct: number;
  /** Layer center Y as a fraction of frame height (0–1). */
  yPct: number;
  /** Layer width as a fraction of frame width (0–1). Height follows aspect ratio. */
  widthPct: number;
  /** Optional opacity 0–1 (default 1). */
  opacity?: number;
  /** For z-ordering; lower draws first. Defaults to array order. */
  z?: number;
}

async function fetchImage(url: string): Promise<Image> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Layer fetch failed (${res.status}): ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return Image.decode(bytes);
}

/**
 * Composite the given image layers onto baseUrl. Returns PNG bytes.
 * Layers are drawn in z-order (then array order) on top of the base.
 */
export async function compositeImageLayers(
  baseUrl: string,
  layers: ImageLayer[],
): Promise<Uint8Array> {
  const base = await fetchImage(baseUrl);
  const out = base.clone();
  const frameW = out.width;
  const frameH = out.height;

  const ordered = layers
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.z ?? a.i) - (b.l.z ?? b.i));

  for (const { l } of ordered) {
    const layerImg = await fetchImage(l.url);

    // Scale to target width (fraction of frame), preserve aspect ratio.
    const targetW = Math.max(1, Math.round(frameW * clamp01(l.widthPct)));
    const aspect = layerImg.height / layerImg.width;
    const targetH = Math.max(1, Math.round(targetW * aspect));
    const scaled = layerImg.resize(targetW, targetH);

    if (l.opacity != null && l.opacity < 1) {
      scaled.opacity(clamp01(l.opacity));
    }

    // Convert normalized CENTER to top-left pixel, clamped into frame.
    const cx = clamp01(l.xPct) * frameW;
    const cy = clamp01(l.yPct) * frameH;
    const x = Math.round(clamp(cx - targetW / 2, 0, Math.max(0, frameW - targetW)));
    const y = Math.round(clamp(cy - targetH / 2, 0, Math.max(0, frameH - targetH)));

    out.composite(scaled, x, y);
  }

  return await out.encode(); // PNG
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
