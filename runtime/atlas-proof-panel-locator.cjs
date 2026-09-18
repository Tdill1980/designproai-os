"use strict";
/**
 * runtime/atlas-proof-panel-locator.cjs — FIND THE PANELS IN A RETURNED PROOF.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "It locks in the PROOF_REGIONS coordinate
 * slicer as an active enforcement gate before returning the payload to your
 * UI." This is the half of that which the first attempt got wrong.
 *
 * WHY NOT JUST SLICE AT THE CONTAINER'S COORDINATES.
 *
 * Because live sheet d5314267 proved the model does not draw them there.
 * `atlas-proof-zone-gate.cjs` assumed the container's own cell rectangles were
 * where the panels would be -- the container is attached and the prompt says
 * "fill it; do not re-flow it", so the assumption was reasonable and it was
 * still wrong. The model honoured the three ZONE BANDS and every panel's
 * identity and inches, then arranged the panels itself: driver and passenger
 * stacked on the left, roof tall in the middle, hood/front/rear in a two-row
 * block on the right, against a container that draws all six in one row. An
 * overlay of the assumed rectangles onto that sheet lands them on artwork
 * edges, white margin and the gaps between panels -- while reporting confident
 * numbers. A confident measurement of the wrong rectangle is worse than none.
 *
 * So PROOF_REGIONS keeps the job it can actually do -- naming the BAND each
 * zone occupies, which the model does honour -- and the panels are FOUND
 * inside that band.
 *
 * HOW, and it is deliberately dumb. A panel is a large solid rectangle that
 * DIFFERS FROM THE PAGE. Captions are small, dimension arrows are thin. So:
 * mask everything that is not page, label 4-connected components at a coarse
 * scale, keep the ones big enough that actually fill their own bounding box.
 * No model call, no learned threshold, nothing that drifts between runs.
 *
 * "NOT PAGE", NOT "DARK" -- and the first version of this file got that
 * backwards. It masked anything below luma 236 as ink, on the assumption the
 * page was white. Measured on d5314267's own histogram, the band is:
 *
 *     luma 255  16.3%   <- panel INTERIORS, which are white
 *     luma 233  14.7%   <- the PAGE, which is grey
 *     luma 232   7.1%
 *     luma  80   2.2%   <- artwork
 *
 * The page is grey and the panels contain white. A darkness threshold therefore
 * called the entire page ink and returned ONE component 5056px wide spanning
 * the whole band -- every panel bridged into the background. So the page colour
 * is MEASURED per band (its modal luma) and the mask is everything that
 * deviates from it in luma or carries chroma. Brighter than the page counts,
 * which is the whole correction.
 *
 * WHAT IT CATCHES THAT A FILL-DENSITY CHECK CANNOT. On that same live sheet
 * ZONE 1 carries SEVEN panels -- FRONT is drawn twice, both 50.0" x 22.0" --
 * and ZONE 3 leaves two of its boxes empty. Counting located panels convicts
 * both. A density check over assumed cells convicts neither, because it never
 * knew how many panels there were.
 */

const COARSE_WIDTH = 900;
/** How far from the page's own luma a pixel must sit to count as content. */
const PAGE_LUMA_TOLERANCE = 8;
/** ...or how much colour it must carry, for artwork at page brightness. */
const PAGE_CHROMA_TOLERANCE = 12;
/**
 * Thin structures are dissolved before labelling.
 *
 * Without this the DIMENSION LINES bridge the panels: on d5314267's ZONE 1 the
 * arrows and extension lines chained driver, passenger and roof into one
 * component 3050px wide. They are a few pixels thick at full resolution and
 * sub-pixel once the band is scaled to COARSE_WIDTH, so two erosion passes
 * remove them while a solid panel loses only its outermost ring -- which the
 * bounding box then restores anyway.
 */
const ERODE_PASSES = 2;
const MIN_PANEL_BAND_FRACTION = 0.004;
const MIN_BBOX_FILL = 0.55;
const MAX_PANEL_ASPECT = 22;

/** 3x3 minimum filter: a pixel survives only with all 4 neighbours set. */
function erode(mask, width, height, passes) {
  let current = mask;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (current[i] && current[i - 1] && current[i + 1]
          && current[i - width] && current[i + width]) next[i] = 1;
      }
    }
    current = next;
  }
  return current;
}

/** Label 4-connected ink components with an explicit stack. */
function components(mask, width, height, minPixels) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const found = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top] = start; top += 1; seen[start] = 1;
    let size = 0;
    let minX = width; let maxX = -1; let minY = height; let maxY = -1;
    while (top > 0) {
      top -= 1;
      const index = stack[top];
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      let n = 0;
      if (x > 0) { n = index - 1; if (mask[n] && !seen[n]) { seen[n] = 1; stack[top] = n; top += 1; } }
      if (x + 1 < width) { n = index + 1; if (mask[n] && !seen[n]) { seen[n] = 1; stack[top] = n; top += 1; } }
      if (y > 0) { n = index - width; if (mask[n] && !seen[n]) { seen[n] = 1; stack[top] = n; top += 1; } }
      if (y + 1 < height) { n = index + width; if (mask[n] && !seen[n]) { seen[n] = 1; stack[top] = n; top += 1; } }
    }
    if (size < minPixels) continue;
    found.push({ size, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return found;
}

/**
 * Locate the panel rectangles inside one zone band of a returned proof.
 *
 * @param band {x,y,w,h} in FRACTIONS of the sheet — PROOF_REGIONS' own shape.
 * @returns panels in FULL-RESOLUTION pixel coordinates, left to right.
 */
async function locatePanels({ proofBytes, band, sharp = require("sharp") }) {
  const meta = await sharp(proofBytes).metadata();
  const region = {
    left: Math.round(band.x * meta.width),
    top: Math.round(band.y * meta.height),
    width: Math.round(band.w * meta.width),
    height: Math.round(band.h * meta.height),
  };
  const scale = COARSE_WIDTH / region.width;
  const { data, info } = await sharp(proofBytes)
    .extract(region)
    .resize({ width: COARSE_WIDTH })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  // THE PAGE COLOUR IS MEASURED, NEVER ASSUMED. Its modal luma is the page:
  // on a proof sheet the single commonest tone is the paper the document is
  // printed on, and on d5314267 that is grey 233 rather than white.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1] ?? r;
    const b = data[i + 2] ?? r;
    histogram[Math.round(0.299 * r + 0.587 * g + 0.114 * b)] += 1;
  }
  let pageLuma = 0;
  for (let l = 1; l < 256; l += 1) if (histogram[l] > histogram[pageLuma]) pageLuma = l;

  const mask = new Uint8Array(info.width * info.height);
  for (let i = 0, p = 0; i < data.length; i += info.channels, p += 1) {
    const r = data[i];
    const g = data[i + 1] ?? r;
    const b = data[i + 2] ?? r;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (Math.abs(luma - pageLuma) > PAGE_LUMA_TOLERANCE || chroma > PAGE_CHROMA_TOLERANCE) {
      mask[p] = 1;
    }
  }

  const solid = erode(mask, info.width, info.height, ERODE_PASSES);
  const floor = Math.max(32, Math.round(mask.length * MIN_PANEL_BAND_FRACTION));
  const panels = components(solid, info.width, info.height, floor)
    // A PANEL FILLS ITS OWN BOX. This is what separates a solid printed
    // rectangle from a dimension arrow, an underline or a caption row, all of
    // which sprawl across a wide bounding box while colouring almost none of
    // it. It is also what stops two panels bridged by a stray rule from being
    // reported as one enormous panel.
    .filter((c) => c.size / (c.w * c.h) >= MIN_BBOX_FILL)
    .filter((c) => {
      const aspect = c.w / c.h;
      return aspect <= MAX_PANEL_ASPECT && aspect >= 1 / MAX_PANEL_ASPECT;
    })
    .map((c) => ({
      x: region.left + Math.round(c.x / scale),
      y: region.top + Math.round(c.y / scale),
      w: Math.max(1, Math.round(c.w / scale)),
      h: Math.max(1, Math.round(c.h / scale)),
      bboxFill: Number((c.size / (c.w * c.h)).toFixed(3)),
      bandAreaFraction: Number((c.size / mask.length).toFixed(4)),
    }))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  return { sheet: { width: meta.width, height: meta.height }, region, pageLuma, panels };
}

module.exports = {
  COARSE_WIDTH,
  PAGE_LUMA_TOLERANCE,
  PAGE_CHROMA_TOLERANCE,
  MIN_PANEL_BAND_FRACTION,
  MIN_BBOX_FILL,
  ERODE_PASSES,
  locatePanels,
  _test: { components, erode },
};
