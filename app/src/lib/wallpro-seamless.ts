// Seamless repeat is an OS guarantee, never a model promise. The prompt asks
// Gemini for a tileable pattern; this module MEASURES whether the tile actually
// joins, and CLOSES the seam deterministically when it does not. No image
// request is ever issued to repair a seam. Everything here is pure pixel math
// on RGBA buffers so it runs identically in the browser and in node tests.

export type SeamReport = {
  width: number; height: number;
  /** Mean absolute RGB difference (0-255) across the wrap-around edges: the
   * larger of the left|right join and the top|bottom join. */
  edge: number;
  /** Mean absolute RGB difference between adjacent interior pixels: the
   * texture's own natural busyness, which the edge join is judged against. */
  interior: number;
  /** edge / interior. A tile whose edges join like any two neighbouring pixels
   * measures near 1. A hard seam measures many times higher. */
  ratio: number;
  seamless: boolean;
};
export type SeamlessMethod = 'verified' | 'mirror' | 'blend';
export type SeamlessPreference = 'auto' | 'mirror' | 'blend';
export type SeamlessReceipt = {
  contract: 'wallpro.seamless.v1';
  preference: SeamlessPreference;
  method: SeamlessMethod;
  before: SeamReport;
  /** Measurement of the pixels that actually print. Null for mirror, whose
   * join is identical columns/rows by construction and needs no measurement. */
  after: SeamReport | null;
  verified: boolean;
};

/** A join at least this much larger than the steps its neighbouring pixel pairs
 * take is a visible seam. A seamless tile measures near 1; a hard seam, tens. */
export const SEAM_RATIO_MAX = 1.75;
/** A join this close in absolute terms is invisible whatever the interior does
 * (flat colour fields have an interior near zero and would otherwise divide badly). */
export const SEAM_EDGE_FLOOR = 2.5;
/** Fraction of the tile on each side of the offset cross that the blend repairs. */
export const SEAM_BLEND_BAND = 0.12;

function rgbDelta(data: ArrayLike<number>, a: number, b: number) {
  return (Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2])) / 3;
}

export function measureSeam(data: ArrayLike<number>, width: number, height: number): SeamReport {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 3 || height < 3 || data.length < width * height * 4) throw new Error('Seam measurement needs an RGBA tile at least 3 pixels on each side.');
  // The join is judged against its own immediate neighbours: the column pairs
  // just inside each edge. A seam is a step that its neighbours do not take.
  // Judging against the whole tile's average would convict a busy edge region
  // of a genuinely seamless tile, and clear a soft seam in a busy tile.
  let joinH = 0, localH = 0, joinV = 0, localV = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    joinH += rgbDelta(data, row + (width - 1) * 4, row);
    localH += (rgbDelta(data, row + (width - 2) * 4, row + (width - 1) * 4) + rgbDelta(data, row, row + 4)) / 2;
  }
  for (let x = 0; x < width; x++) {
    const col = x * 4, last = ((height - 1) * width + x) * 4;
    joinV += rgbDelta(data, last, col);
    localV += (rgbDelta(data, last - width * 4, last) + rgbDelta(data, col, col + width * 4)) / 2;
  }
  joinH /= height; localH /= height; joinV /= width; localV /= width;
  const ratioH = joinH / Math.max(localH, 1e-6), ratioV = joinV / Math.max(localV, 1e-6);
  const horizontalWorse = ratioH >= ratioV;
  const edge = horizontalWorse ? joinH : joinV, interior = horizontalWorse ? localH : localV, ratio = horizontalWorse ? ratioH : ratioV;
  const seamless = [[joinH, ratioH], [joinV, ratioV]].every(([join, r]) => join <= SEAM_EDGE_FLOOR || r <= SEAM_RATIO_MAX);
  return { width, height, edge, interior, ratio, seamless };
}

/** Deterministic seam closure. A copy of the tile shifted by half its size has
 * outer edges that are interior neighbours of the original, so it wraps
 * seamlessly by construction; its only discontinuity is a cross through the
 * centre. The result keeps the original tile everywhere except an outer frame,
 * where it crossfades into the shifted copy. The frame never reaches the
 * centre cross, so every pixel of the result is continuous, and the four
 * outer edges join exactly as the shifted copy's do. Only the frame changes. */
export function blendSeamless(data: ArrayLike<number>, width: number, height: number, band = SEAM_BLEND_BAND): Uint8ClampedArray {
  if (!(band > 0 && band < 0.5)) throw new Error('The seam blend band must be between 0 and 0.5 of the tile.');
  const out = new Uint8ClampedArray(width * height * 4);
  const halfX = Math.floor(width / 2), halfY = Math.floor(height / 2);
  const bandX = Math.max(1, band * width), bandY = Math.max(1, band * height);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  // 0 at the outer edge, 1 once a full band inside it.
  const inside = (distance: number, extent: number) => distance >= extent ? 1 : smooth(distance / extent);
  for (let y = 0; y < height; y++) {
    const my = inside(Math.min(y + 0.5, height - y - 0.5), bandY);
    const sy = (y + halfY) % height;
    for (let x = 0; x < width; x++) {
      const m = Math.min(inside(Math.min(x + 0.5, width - x - 0.5), bandX), my);
      const sx = (x + halfX) % width;
      const shifted = (sy * width + sx) * 4, original = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[original + c] = Math.round(data[original + c] * m + data[shifted + c] * (1 - m));
    }
  }
  return out;
}

/**
 * ONE SEAM LADDER, FOR THE CUSTOMER AND THE BATCH ALIKE (2026-09-22).
 *
 * Owner, on a generated repeat: "Why did it make a poor design?" The design
 * was not poor when it left the model. `chooseSeamlessMethod` — which this
 * replaces — read, in full:
 *
 *     return report.seamless ? 'verified' : 'mirror';
 *
 * So EVERY tile the measurement did not clear became a MIRROR repeat: alternate
 * tiles flipped, which is kaleidoscope symmetry. On abstract texture that is
 * invisible. On the botanicals, palms and line work WallPro actually generates
 * it is the single most recognisable "AI wallpaper" artefact there is —
 * butterflied leaves, mirrored stems, a hard axis of symmetry every tile width
 * across her wall. She was looking at the fallback, not at the design.
 *
 * The batch path had already been corrected (`batchSeamDecision`, 2026-09-14)
 * and its comment names the reason: mirror "is invisible on abstract texture
 * and plainly wrong on cranes, leaves or lettering". The customer path never
 * got that fix, so the two halves of one product disagreed about the same tile.
 * They now share this function, which is that ladder:
 *
 *     verified  — it already joins, print it as generated
 *     blend     — the deterministic crossfaded outer frame, motifs upright
 *     mirror    — only when a MEASURED blend still does not join
 *
 * ⚠️ BLEND CANNOT BE CHOSEN WITHOUT MEASURING IT. That is why this takes
 * `blendedAfter` rather than deciding from `before` alone: the crossfade is a
 * real repair whose result is a fact, not a promise. Pass null only when no
 * blend was attempted (an explicit preference, or a tile that already joins).
 */
export function seamLadder(before: SeamReport, blendedAfter: SeamReport | null, preference: SeamlessPreference): SeamlessMethod {
  if (preference === 'mirror' || preference === 'blend') return preference;
  if (before.seamless) return 'verified';
  if (blendedAfter?.seamless) return 'blend';
  return 'mirror';
}

/** Whether `auto` should spend a blend attempt on this tile at all. A tile that
 * already joins needs no repair; an explicit preference has already decided. */
export function shouldTryBlend(before: SeamReport, preference: SeamlessPreference): boolean {
  return preference === 'blend' || (preference === 'auto' && !before.seamless);
}

/** Mirror repeat: every odd tile is flipped, so each join places a column (or
 * row) against its own copy. Returns the tile index and the in-tile coordinate. */
export function tileCoordinate(t: number, mirror: boolean): { index: number; u: number } {
  const index = Math.floor(t);
  const u = t - index;
  return { index, u: mirror && ((index % 2) + 2) % 2 === 1 ? 1 - u : u };
}

/**
 * `method` is REQUIRED — it is the ladder's answer, and the ladder needs a
 * measured blend to give one. It used to default to a decision made from
 * `before` alone, which is exactly how the mirror fallback stayed invisible.
 *
 * `verified` stays TRUE for mirror, and that is not a loophole: a mirrored
 * join places a column against its own copy, so there is provably no seam.
 * `verified` is the PRINT gate ("does this tile join") and it is answered
 * correctly. What mirror costs is not seam quality but ARTWORK — the flip is a
 * visible change to the customer's design — so the surfaces read `method`, not
 * `verified`, before telling her the wall is as she designed it.
 */
export function seamlessReceipt(preference: SeamlessPreference, before: SeamReport, after: SeamReport | null, method: SeamlessMethod): SeamlessReceipt {
  const verified = method === 'mirror' ? true : method === 'verified' ? before.seamless : !!after?.seamless;
  return { contract: 'wallpro.seamless.v1', preference, method, before, after, verified };
}
