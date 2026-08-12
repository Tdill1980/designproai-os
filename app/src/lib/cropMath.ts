/**
 * cropMath — pure geometry for the Shot List photo crop editor.
 *
 * The Konva stage is only the VIEW; the actual crop is cut from the original
 * image at native resolution using these functions, so quality never depends
 * on the on-screen canvas size. Kept free of Konva/React imports so it can be
 * unit-tested directly (tests/shot-list-crop.test.ts).
 */

export type CropPresetKey = "vertical" | "square" | "landscape";

export const CROP_PRESETS: Record<CropPresetKey, { label: string; ratio: number }> = {
  vertical: { label: "Vertical 9:16", ratio: 9 / 16 },
  square: { label: "Square 1:1", ratio: 1 },
  landscape: { label: "Landscape 16:9", ratio: 16 / 9 },
};

/** Stage (viewport) size for a preset, fitted into maxW×maxH. */
export function stageSizeFor(preset: CropPresetKey, maxW: number, maxH: number): { width: number; height: number } {
  const r = CROP_PRESETS[preset].ratio; // width / height
  let width = maxW;
  let height = width / r;
  if (height > maxH) {
    height = maxH;
    width = height * r;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Minimum scale at which the image still covers the whole stage (no gaps). */
export function coverScale(imgW: number, imgH: number, stageW: number, stageH: number): number {
  return Math.max(stageW / imgW, stageH / imgH);
}

/**
 * Clamp a drag position so the scaled image always covers the stage —
 * x/y are the image's top-left in stage coordinates (always <= 0).
 */
export function clampPosition(
  x: number, y: number,
  imgW: number, imgH: number, scale: number,
  stageW: number, stageH: number,
): { x: number; y: number } {
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    x: Math.min(0, Math.max(stageW - w, x)),
    y: Math.min(0, Math.max(stageH - h, y)),
  };
}

/**
 * The crop rectangle in ORIGINAL image pixels for the current view.
 * Draw this rect from the original image onto an offscreen canvas of
 * sw×sh to get a full-resolution crop.
 */
export function cropRect(
  x: number, y: number, scale: number,
  stageW: number, stageH: number,
  imgW: number, imgH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.max(0, -x / scale);
  const sy = Math.max(0, -y / scale);
  const sw = Math.min(imgW - sx, stageW / scale);
  const sh = Math.min(imgH - sy, stageH / scale);
  return { sx, sy, sw, sh };
}
