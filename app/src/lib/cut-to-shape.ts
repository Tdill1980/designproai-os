/**
 * CUT-TO-SHAPE — deterministic background keying + measurable cut quality.
 *
 * A Logo Pack asset is only useful if it is a real CONTOUR: the logo's own
 * pixels opaque, everything around it fully transparent, and partial alpha
 * confined to anti-aliased edges. Anything else plots and prints as a ghosted
 * rectangle. Owner, 2026-07-30: "only real logos that are cut to shape
 * qualify ... if it cant contour cut just leave it off."
 *
 * WHY THE OLD KEY PRODUCED SQUARES
 * `alphaKeyByWrapColor` sampled EIGHT perimeter points, took the median as one
 * "wrap color", and knocked out every pixel within a tolerance of that single
 * colour. DesignPro wraps are layered by design — gradients, atmosphere,
 * mid-ground motion — so one median colour describes only part of the
 * background. Every background pixel of a DIFFERENT shade sat outside the
 * tolerance and stayed fully opaque, so the "cut" kept a slab of wrap around
 * the logo. That is the ghosted rectangle, and no amount of vector tracing
 * downstream can recover from it: VTracer faithfully traces the slab.
 *
 * THE FIX — FLOOD FILL FROM THE BORDER, NOT A GLOBAL COLOUR MATCH
 * Background is what the border is CONNECTED to. Seeding a flood fill from
 * every border pixel and walking to neighbours of a similar colour tracks a
 * gradient as it changes (each step compares to its own neighbour, never to a
 * global median), and it structurally cannot punch a hole in the middle of the
 * logo, because interior pixels are only reached through the logo's own edge.
 *
 * Everything here is pure pixel math on a plain {data,width,height} — no AI, no
 * canvas, no DOM — so it runs identically in the browser and under Vitest, and
 * the quality claim is MEASURED rather than eyeballed on a thumbnail.
 */

export interface PixelBuffer {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Shared with worker/index.js `/lift-overlays` so both paths judge identically. */
export const CUT_MIN_CLEAR = 0.15; // must actually cut something away
export const CUT_MAX_PARTIAL = 0.25; // soft pixels are edges only, not a ramp

/**
 * ...and something must SURVIVE the cut.
 *
 * The two thresholds above only describe what was removed, so a slice that got
 * erased entirely — uniform artwork with no background to key, where the fill
 * consumes the whole frame — measures 100% clear / 0% partial and "passes" as a
 * perfect cut while containing nothing at all. The fixture test caught exactly
 * that. A contour must retain a real element.
 *
 * This third threshold is client-side only; the worker's `/lift-overlays` gate
 * predates it (and that path is gated off), so the two shared thresholds above
 * still match it exactly.
 */
export const CUT_MIN_SOLID = 0.02;

export interface AlphaQuality {
  /** Fraction fully transparent (alpha < 16) — the area cut away. */
  clearPct: number;
  /** Fraction fully opaque (alpha > 239) — the element itself. */
  solidPct: number;
  /** Everything between — anti-aliasing when small, a soft ramp when large. */
  partialPct: number;
}

/** Measure the alpha distribution of an RGBA buffer. */
export function measureAlphaQuality(px: PixelBuffer): AlphaQuality {
  const { data } = px;
  const total = data.length / 4;
  if (total === 0) return { clearPct: 0, solidPct: 0, partialPct: 0 };
  let clear = 0;
  let solid = 0;
  for (let p = 3; p < data.length; p += 4) {
    const a = data[p];
    if (a < 16) clear++;
    else if (a > 239) solid++;
  }
  const clearPct = clear / total;
  const solidPct = solid / total;
  return { clearPct, solidPct, partialPct: 1 - clearPct - solidPct };
}

/**
 * A genuine cut has hard edges: real transparency around the shape, and
 * partial alpha confined to anti-aliasing. A translucent square fails both.
 */
export function isCutToShape(q: AlphaQuality): boolean {
  return (
    q.clearPct >= CUT_MIN_CLEAR &&
    q.partialPct <= CUT_MAX_PARTIAL &&
    q.solidPct >= CUT_MIN_SOLID
  );
}

/** Human-readable reason for a rejection, for honest UI/log messages. */
export function describeCutFailure(q: AlphaQuality): string {
  const bits: string[] = [];
  if (q.clearPct < CUT_MIN_CLEAR) {
    bits.push(
      `only ${(q.clearPct * 100).toFixed(1)}% transparent (need ${CUT_MIN_CLEAR * 100}%)`,
    );
  }
  if (q.partialPct > CUT_MAX_PARTIAL) {
    bits.push(
      `${(q.partialPct * 100).toFixed(1)}% partial alpha (max ${CUT_MAX_PARTIAL * 100}%)`,
    );
  }
  if (q.solidPct < CUT_MIN_SOLID) {
    bits.push(
      `nothing survived the cut (${(q.solidPct * 100).toFixed(1)}% opaque)`,
    );
  }
  return bits.join(", ") || "not cut to shape";
}

const sq = (n: number) => n * n;

/**
 * Knock the background to alpha 0 by flood-filling inward from the border.
 *
 * A pixel joins the background when it is within `tolerance` of the neighbour
 * it was reached from, which lets the fill follow a gradient across the whole
 * frame while stopping dead at the logo's edge. Border-connected only, so the
 * logo's interior can never be hollowed out.
 *
 * `feather` softens exactly one pixel at the resulting boundary so the cut
 * isn't aliased — that is the ONLY partial alpha this function creates, which
 * is why a clean cut measures far below CUT_MAX_PARTIAL.
 *
 * Returns a NEW buffer; the input is not mutated.
 */
export function keyBackgroundFromBorder(
  px: PixelBuffer,
  options?: { tolerance?: number; feather?: boolean },
): PixelBuffer {
  const { width: w, height: h } = px;
  const src = px.data;
  const out = new Uint8ClampedArray(src.length);
  out.set(src);
  if (w < 2 || h < 2) return { data: out, width: w, height: h };

  const tolerance = options?.tolerance ?? 28;
  const tol2 = sq(tolerance);
  const isBg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const push = (idx: number) => {
    if (!isBg[idx]) {
      isBg[idx] = 1;
      queue[tail++] = idx;
    }
  };

  // Seed every border pixel — the background is whatever touches the frame.
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx / w) | 0;
    const i = idx * 4;
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];

    // 4-connected: diagonals let the fill leak through anti-aliased corners.
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
      const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (isBg[nIdx]) continue;
      const ni = nIdx * 4;
      // Compare to the pixel we arrived from, so a gradient stays background
      // all the way across while a logo edge still stops the walk.
      const dist2 =
        sq(src[ni] - r) + sq(src[ni + 1] - g) + sq(src[ni + 2] - b);
      if (dist2 <= tol2) push(nIdx);
    }
  }

  for (let idx = 0; idx < w * h; idx++) {
    if (isBg[idx]) out[idx * 4 + 3] = 0;
  }

  if (options?.feather !== false) {
    // One-pixel feather on kept pixels that touch the cut, so the contour
    // reads as cut rather than stamped. Computed from the ORIGINAL mask so the
    // feather can't cascade inward.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (isBg[idx]) continue;
        let touchesBg = false;
        for (let d = 0; d < 4 && !touchesBg; d++) {
          const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
          const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (isBg[ny * w + nx]) touchesBg = true;
        }
        if (touchesBg) out[idx * 4 + 3] = Math.round(out[idx * 4 + 3] * 0.5);
      }
    }
  }

  return { data: out, width: w, height: h };
}
