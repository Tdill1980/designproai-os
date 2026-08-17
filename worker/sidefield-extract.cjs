/**
 * SIDEFIELD EXTRACT — the artboard as an EXTRACTION, not a generation
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * WHY THIS EXISTS. Across 923 panels ever produced, exactly ONE method has ever
 * yielded a genuinely deterministic, non-passenger panel: `artboard-slice`, a
 * pure geometric crop of the artboard — 125 of them. Every other producer
 * (`panel-pro-extract`, `mastersheet:*`, `genie-reproduce`, `edit-flatten`,
 * `genie-fill`, `proof-extract`; 268 panels between them) is an AI redraw and
 * has produced ZERO.
 *
 * But a geometric crop is only ever as good as what it crops, and the artboard
 * it crops is GENERATED — a Gemini image pass whose prompt asks it not to redraw
 * with nothing enforcing that. So the slicer faithfully cuts a reinvented
 * design. Live 2026-08-01, the gridslice rung was refused by its own judge for
 * "missing the '24/7 SERVICE WE KEEP YOU COOL' text block and the 'HVAC HEROES'
 * logo is too large and centered compared to the proof." The mechanism was
 * right. The input was invented.
 *
 * THE PRINCIPLE: MASK, DON'T REPAINT. A model may LOCATE — return coordinates —
 * and code does everything that touches a pixel. The design cannot drift,
 * because nothing is ever asked to draw it. This is the same split that made
 * the overlay lift safe (locate the boxes, paste real pixels) and the proof
 * text gate meaningful (the model reads, code decides).
 *
 * WHY IT IS TRACTABLE HERE. The driver-side view is not a 3/4 hero shot. Its
 * camera spec in `_shared/view-angles-os.ts` is explicit: "PERFECTLY STRAIGHT
 * side-on elevation. Camera is exactly 90 degrees perpendicular to the vehicle
 * body — NOT a 3/4 angle... Zero tilt, zero rotation... like a blueprint
 * elevation drawing." So the wrap is already essentially orthographic in image
 * space, and no perspective rectification is required — the extraction is a
 * crop of real approved pixels.
 *
 * HOLES. Glass and wheels are not wrap, but the print file is a solid rectangle
 * (the installer trims). They are filled by MIRRORING the nearest real wrap
 * pixels across the hole edge — the exact operation the 5" bleed already uses,
 * turned inward. It is deterministic, local, and it never invents content: every
 * output pixel is a real pixel from the approved render.
 */

/** Clamp a 0-1000 [ymin,xmin,ymax,xmax] box to pixel bounds. */
function boxToRect(box, W, H) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.min(W, Math.round((xmin / 1000) * W)));
  const y = Math.max(0, Math.min(H, Math.round((ymin / 1000) * H)));
  const x1 = Math.max(0, Math.min(W, Math.round((xmax / 1000) * W)));
  const y1 = Math.max(0, Math.min(H, Math.round((ymax / 1000) * H)));
  const w = x1 - x, h = y1 - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** Rects intersected with the crop, expressed in crop-local coordinates. */
function holesInCrop(holes, crop) {
  const out = [];
  for (const hole of holes || []) {
    if (!hole) continue;
    const x0 = Math.max(hole.x, crop.x);
    const y0 = Math.max(hole.y, crop.y);
    const x1 = Math.min(hole.x + hole.w, crop.x + crop.w);
    const y1 = Math.min(hole.y + hole.h, crop.y + crop.h);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({ x: x0 - crop.x, y: y0 - crop.y, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

/**
 * Fill each hole by mirroring real pixels across its nearer horizontal edge.
 *
 * Vertical, not horizontal: a wrap's graphics and lettering run ALONG the body,
 * so the pixels directly above a wheel arch — or below a window — are the same
 * band of artwork. Mirroring across the hole edge continues that band. Sampling
 * sideways would drag a letterform across the gap, which is the smear this
 * codebase has banned since the ClipDrop/liftoverlays era.
 *
 * Every written pixel is copied from a real pixel of the same image. Nothing is
 * synthesised, blended, or invented.
 *
 * @param {Buffer|Uint8Array} raw RGBA, W*H*4
 */
function fillHolesByMirror(raw, W, H, holes) {
  for (const hole of holes || []) {
    const hx0 = Math.max(0, hole.x);
    const hy0 = Math.max(0, hole.y);
    const hx1 = Math.min(W, hole.x + hole.w);
    const hy1 = Math.min(H, hole.y + hole.h);
    if (hx1 <= hx0 || hy1 <= hy0) continue;
    const height = hy1 - hy0;
    const mid = hy0 + height / 2;

    for (let y = hy0; y < hy1; y++) {
      // Reflect across whichever edge is nearer, so each half of the hole is
      // continued from the artwork it actually adjoins.
      const fromTop = y < mid;
      const dist = fromTop ? y - hy0 + 1 : hy1 - y;
      let src = fromTop ? hy0 - dist : hy1 - 1 + dist;
      // Ran out of image on that side — reflect from the other edge instead.
      if (src < 0 || src >= H) src = fromTop ? hy1 - 1 + dist : hy0 - dist;
      if (src < 0) src = 0;
      if (src >= H) src = H - 1;
      // Degenerate only if the hole spans the whole image; leave those pixels
      // rather than copying the hole onto itself.
      if (src >= hy0 && src < hy1) continue;
      for (let x = hx0; x < hx1; x++) {
        const d = (y * W + x) * 4;
        const s = (src * W + x) * 4;
        raw[d] = raw[s];
        raw[d + 1] = raw[s + 1];
        raw[d + 2] = raw[s + 2];
        raw[d + 3] = raw[s + 3];
      }
    }
  }
  return raw;
}

/**
 * Turn one LOCATE response into the pixel plan. Pure — no image work, no model.
 *
 * @param {object} opts
 * @param {number[]} opts.bodyBox   0-1000 [ymin,xmin,ymax,xmax] of the painted body
 * @param {number[][]} opts.holeBoxes 0-1000 boxes for glass/wheels/non-wrap
 * @param {number} opts.W source width
 * @param {number} opts.H source height
 * @returns {{crop:object, holes:object[]}|null}
 */
function planSidefieldExtract({ bodyBox, holeBoxes, W, H }) {
  const crop = boxToRect(bodyBox, W, H);
  if (!crop) return null;
  // A body box that covers almost the whole frame means the locate pass failed
  // to find the vehicle and returned the image. Cropping that ships the studio
  // floor and walls as wrap artwork, so refuse rather than guess.
  if (crop.w >= W * 0.995 && crop.h >= H * 0.995) return null;
  // Likewise a sliver: too small to be a vehicle side at any framing.
  if (crop.w < W * 0.2 || crop.h < H * 0.05) return null;

  const holes = holesInCrop(
    (holeBoxes || []).map((b) => boxToRect(b, W, H)).filter(Boolean),
    crop,
  );
  return { crop, holes };
}

module.exports = { boxToRect, holesInCrop, fillHolesByMirror, planSidefieldExtract };
