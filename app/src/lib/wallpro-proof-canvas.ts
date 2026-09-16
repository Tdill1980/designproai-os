/**
 * ONE CANVAS FOR EVERY PROOF, APPLIED IN THE BROWSER AT UPLOAD TIME.
 *
 * Owner, 2026-09-15: "just create a container and i can place on admin side."
 *
 * The band wipes one photograph across another inside a single fixed box. That
 * only holds together if every frame shares one shape: give it a 4:3 and a 2:1
 * and the room visibly jumps as the handle crosses, which reads as two rooms
 * and the comparison collapses. Until now that was enforced by a script I ran;
 * a curator uploading from a browser needs the same rules to apply themselves,
 * or the first pair uploaded without me breaks the band.
 *
 * So this module is the geometry, and scripts/wallpro-proof-normalize.mjs is
 * the same geometry for files on disk. The numbers live HERE and the band reads
 * PROOF_CANVAS for its own aspect ratio, so the box and the pictures cannot
 * drift apart -- that drift is exactly what produced a letterboxed band earlier
 * today.
 *
 * TRIM IS PER EDGE, AND SHARED BETWEEN THE HALVES. A marketing frame often
 * carries a caption baked into its top corner; taking it off the top costs a
 * tenth of the frame, where a symmetric cut deep enough to lose it costs a
 * quarter and the room starts to look squashed. Asymmetry is safe because what
 * must match is the treatment of the two HALVES, not top against bottom.
 */

/** The shape every proof is normalised to. The band reads this for its box. */
export const PROOF_CANVAS = { width: 1400, height: 803 } as const;
export const PROOF_ASPECT = PROOF_CANVAS.width / PROOF_CANVAS.height;

export type ProofTrim = {
  /** Percent of the source height removed from the top. */
  top: number;
  /** Percent of the source height removed from the bottom. */
  bottom: number;
};

export const NO_TRIM: ProofTrim = { top: 0, bottom: 0 };

/** Below this the source is being enlarged enough to look soft beside a sharp
 *  partner, and the curator should be told rather than left to discover it. */
export const SOFT_BELOW = 0.6;

export function trimIsValid(trim: ProofTrim): boolean {
  return [trim.top, trim.bottom].every(v => Number.isFinite(v) && v >= 0 && v <= 30)
    && trim.top + trim.bottom <= 45;
}

/** How much this source is being enlarged onto the canvas. Above 1 is upscale. */
export function upscaleFactor(natural: { width: number; height: number }, trim: ProofTrim): number {
  const keptHeight = natural.height * (1 - (trim.top + trim.bottom) / 100);
  // The canvas is filled by `cover`, so the binding dimension is whichever axis
  // has to stretch furthest.
  return Math.max(PROOF_CANVAS.width / natural.width, PROOF_CANVAS.height / Math.max(1, keptHeight));
}

/**
 * Trim, then cover-fit onto the shared canvas, and return a JPEG blob.
 *
 * `cover` rather than `contain`: a room photograph padded to fit reads as a
 * mistake, and one squashed to fit is worse than one cropped. The trim is what
 * gives the curator control over WHICH part survives.
 */
export async function normalizeProofImage(file: File, trim: ProofTrim): Promise<Blob> {
  if (!trimIsValid(trim)) throw new Error('Trim must be 0–30% per edge and under 45% in total.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That file could not be read as an image. JPG, PNG or WebP.');
  });
  try {
    const top = Math.round((bitmap.height * trim.top) / 100);
    const bottom = Math.round((bitmap.height * trim.bottom) / 100);
    const srcH = Math.max(1, bitmap.height - top - bottom);
    const srcW = bitmap.width;

    // Cover: scale so the trimmed source fills the canvas, then centre it.
    const scale = Math.max(PROOF_CANVAS.width / srcW, PROOF_CANVAS.height / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;

    const canvas = document.createElement('canvas');
    canvas.width = PROOF_CANVAS.width;
    canvas.height = PROOF_CANVAS.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the image. Try a desktop browser.');
    // White under the draw so a transparent PNG does not land on black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      bitmap,
      0, top, srcW, srcH,
      (PROOF_CANVAS.width - drawW) / 2, (PROOF_CANVAS.height - drawH) / 2, drawW, drawH,
    );
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    canvas.width = 1; canvas.height = 1;
    if (!blob) throw new Error('The image could not be encoded.');
    return blob;
  } finally {
    bitmap.close?.();
  }
}
