/**
 * LIFT-OVERLAYS CROP GEOMETRY
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Pure geometry for the per-box erase pass in `/lift-overlays`. It lives in its
 * own module so the invariants below are unit-tested against the real code
 * rather than asserted with a regex over the express handler.
 *
 * WHY THE CROP IS GROWN TO AN EXACT ASPECT. `geminiImageEdit` can only emit one
 * of seven fixed aspect ratios, and its output is resized onto the target grid
 * with `fit:"fill"`. Feeding it a whole driver-side panel (~3.24:1) meant the
 * nearest offered aspect was 21:9 (2.33:1), so the erase output came back
 * stretched ~39% horizontally before anything compared it. That stretch — not a
 * repainted design — is what the whole-panel alignment gate was measuring when
 * it failed five of six live entice packs on 2026-08-01 at diffs of 27.7 to
 * 76.5 against a limit of 26.
 *
 * WHY ELONGATED BOXES ARE SPLIT. The first per-box build (run fe075ac0) failed
 * with `ring diff 44.0 > 26` on a "services list" — a ~2100x70 contact bar. Two
 * compounding mistakes, both here, neither of them Gemini's fault:
 *
 *   1. The pad was PROPORTIONAL to the box (45%), so a 2100px-wide bar asked
 *      for 945px of context on each side. The ring only has to prove local
 *      alignment and give the model something to continue — that needs tens of
 *      pixels, not hundreds. The pad is now clamped to an absolute range.
 *   2. Growing an 18:1 strip to the nearest emitted aspect (21:9) demands a
 *      height taller than the panel, so the crop clamped to the FULL 3000x926
 *      panel. That element was still being erased whole-panel, and the ring
 *      covered 95% of the crop — so the gate was measuring the entire design
 *      drifting, exactly the bug the per-box rewrite existed to remove.
 *
 * A long box is therefore SPLIT along its long axis into chunks that each reach
 * a supported aspect within a bounded area. Each chunk is an ordinary small
 * crop, judged and pasted on its own, so no path re-inflates to the panel.
 *
 * INVARIANTS (locked by tests/lift-crop-geometry.test.ts):
 *   1. Chunks tile the box exactly — no gap, no overlap, nothing left branded.
 *   2. Every chunk is fully inside its crop, and every crop inside the panel.
 *   3. Every crop matches the aspect the model emits, so no rescale stretches.
 *   4. No crop balloons to swallow the panel.
 */

// Must stay identical to CLEAN_ASPECTS in worker/index.js — the crop is grown to
// the ratio that function will actually emit.
const CLEAN_ASPECTS = [
  ["21:9", 21 / 9],
  ["16:9", 16 / 9],
  ["3:2", 1.5],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 0.75],
  ["9:16", 9 / 16],
];

// Context ring, in absolute pixels. Enough for the model to continue the
// pattern and for the gate to read alignment; never a fraction of a wide box.
const PAD_MIN = 24;
const PAD_MAX = 160;
const PAD_FRACTION = 0.45;

// A crop may not exceed this multiple of the area it exists to erase. Past it,
// the box is split rather than the crop grown.
const MAX_CROP_AREA_RATIO = 8;

// How far a crop's real ratio may sit from the aspect the model is asked for
// before the `fit:"fill"` rescale stops being a pure scale. 1% is below the
// resampler's own rounding on a 3000px panel; anything above it moves pixels.
const ASPECT_TOLERANCE = 0.01;

function pickCleanAspect(width, height) {
  const r = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 0;
  if (r <= 0) return "16:9";
  let best = Infinity;
  let chosen = "16:9";
  for (const [label, ratio] of CLEAN_ASPECTS) {
    const e = Math.abs(ratio - r);
    if (e < best) {
      best = e;
      chosen = label;
    }
  }
  return chosen;
}

const pad = (extent) =>
  Math.max(PAD_MIN, Math.min(PAD_MAX, Math.round(extent * PAD_FRACTION)));

/**
 * The padded, aspect-exact crop around one box.
 *
 * @param {{x:number,y:number,w:number,h:number}} bx box in panel pixels
 * @param {number} W panel width
 * @param {number} H panel height
 * @returns {{cx0:number,cy0:number,cw:number,ch:number,aspect:string}}
 */
function liftCropRect(bx, W, H) {
  const padX = pad(bx.w);
  const padY = pad(bx.h);
  let cx0 = Math.max(0, bx.x - padX);
  let cy0 = Math.max(0, bx.y - padY);
  let cx1 = Math.min(W, bx.x + bx.w + padX);
  let cy1 = Math.min(H, bx.y + bx.h + padY);

  // Grow — never shrink, so the box cannot fall outside its crop — to the exact
  // ratio the model will return. Where the panel runs out, bounds win and the
  // aspect label is re-derived from the crop we actually got, so the residual
  // stretch is the smallest available rather than the full mismatch.
  const want =
    (CLEAN_ASPECTS.find(([l]) => l === pickCleanAspect(cx1 - cx0, cy1 - cy0)) || [])[1] ||
    (cx1 - cx0) / (cy1 - cy0);
  if ((cx1 - cx0) / (cy1 - cy0) < want) {
    const targetW = Math.min(W, Math.round((cy1 - cy0) * want));
    cx0 = Math.max(0, cx0 - Math.round((targetW - (cx1 - cx0)) / 2));
    cx1 = Math.min(W, cx0 + targetW);
    cx0 = Math.max(0, cx1 - targetW);
  } else {
    const targetH = Math.min(H, Math.round((cx1 - cx0) / want));
    cy0 = Math.max(0, cy0 - Math.round((targetH - (cy1 - cy0)) / 2));
    cy1 = Math.min(H, cy0 + targetH);
    cy0 = Math.max(0, cy1 - targetH);
  }

  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  return { cx0, cy0, cw, ch, aspect: pickCleanAspect(cw, ch) };
}

/** Area blow-up of the crop that would be built for this box. */
function cropAreaRatio(bx, W, H) {
  const { cw, ch } = liftCropRect(bx, W, H);
  const boxArea = Math.max(1, bx.w * bx.h);
  return (cw * ch) / boxArea;
}

/**
 * Fractional stretch the `fit:"fill"` rescale would apply to this crop — the
 * gap between the ratio the model is ASKED for and the ratio it is resized ONTO.
 *
 * `liftCropRect` grows toward an exact aspect but the panel edge wins, and when
 * it does the label is re-derived from the clamped crop. That label is then a
 * claim the crop does not satisfy. Measuring the gap is what lets the planner
 * split instead of shipping the mismatch to the model.
 */
function aspectStretchOf(cw, ch, aspect) {
  const want = (CLEAN_ASPECTS.find(([l]) => l === aspect) || [])[1];
  if (!want || !(ch > 0)) return 0;
  return Math.abs(cw / ch - want) / want;
}

/** Stretch of the crop that would be built for this box. */
function cropAspectStretch(bx, W, H) {
  const { cw, ch, aspect } = liftCropRect(bx, W, H);
  return aspectStretchOf(cw, ch, aspect);
}

/** The chunks a given split count produces, each with its own real crop. */
function chunksFor(bx, W, H, parts) {
  const splitHorizontally = bx.w >= bx.h;
  const longEdge = splitHorizontally ? bx.w : bx.h;
  const plan = [];
  for (let i = 0; i < parts; i += 1) {
    // Exact tiling: each chunk starts where the previous ended, and the last
    // one absorbs the rounding remainder, so the union is the original box.
    const start = Math.round((longEdge * i) / parts);
    const end = Math.round((longEdge * (i + 1)) / parts);
    const chunk = splitHorizontally
      ? { ...bx, x: bx.x + start, w: end - start }
      : { ...bx, y: bx.y + start, h: end - start };
    if (chunk.w <= 0 || chunk.h <= 0) continue;
    const rect = liftCropRect(chunk, W, H);
    plan.push({
      bx: chunk,
      ...rect,
      aspectStretch: aspectStretchOf(rect.cw, rect.ch, rect.aspect),
    });
  }
  return plan;
}

/**
 * Split one branding box into the chunks that will actually be erased, then
 * return each chunk with its own crop. Chunks tile the box exactly.
 *
 * @returns {Array<{bx:object,cx0:number,cy0:number,cw:number,ch:number,aspect:string}>}
 */
function liftCropPlan(bx, W, H) {
  // Grow the split until every chunk's crop is BOTH proportionate AND exactly
  // the aspect the model emits. Area alone was not enough: clamping a wide box
  // to the panel edge CAPS its crop area, so a 2700x140 banner scored a
  // respectable 7.3 area ratio while its 3000x926 crop sat 38.8% off the 21:9 it
  // told the model to return. The split never fired, the rescale stretched, and
  // the ring gate reported the stretch as `erase pass repainted the design
  // around "company name"` — blaming Gemini for geometry chosen here.
  //
  // Splitting shrinks the crop's long edge, which is precisely what lets the
  // short edge reach the target ratio inside the panel, so this converges.
  //
  // Bounded so a pathological box can never mint unbounded Gemini calls; the
  // last usable split is kept regardless, because an imperfect crop that the
  // caller can still refuse honestly beats no plan at all.
  const MAX_PARTS = 8;
  let fallback = null;
  for (let parts = 1; parts <= MAX_PARTS; parts += 1) {
    const plan = chunksFor(bx, W, H, parts);
    if (!plan.length) break;
    // A chunk below the pad floor stops being a crop with a ring around it.
    if (plan.some((u) => u.bx.w < 16 || u.bx.h < 16)) break;
    fallback = plan;
    const proportionate = plan.every(
      (u) => (u.cw * u.ch) / Math.max(1, u.bx.w * u.bx.h) <= MAX_CROP_AREA_RATIO,
    );
    const aspectExact = plan.every((u) => u.aspectStretch <= ASPECT_TOLERANCE);
    if (proportionate && aspectExact) return plan;
  }
  return fallback || chunksFor(bx, W, H, 1);
}

module.exports = {
  CLEAN_ASPECTS,
  MAX_CROP_AREA_RATIO,
  ASPECT_TOLERANCE,
  pickCleanAspect,
  liftCropRect,
  cropAreaRatio,
  cropAspectStretch,
  aspectStretchOf,
  liftCropPlan,
};
