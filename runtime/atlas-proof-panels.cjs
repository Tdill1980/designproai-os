"use strict";
/**
 * runtime/atlas-proof-panels.cjs — THE THREE QUADRANTS, CUT OUT AND SHIPPED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-18, stating what the sheet IS: "the three quadrants ... panels
 * with the graphics, panels without the overlay graphic just the design, and
 * the graphic overlays by themselves." And: "each template will have different
 * size rectangles based on vehicle type."
 *
 * The proof sheet is a DOCUMENT. What production consumes are the rectangles
 * inside it, and until now nothing cut them: `atlas-proof-zone-gate.cjs`
 * measured the cells and threw the pixels away. This turns each cell into an
 * artifact.
 *
 *   zone 1  ->  the branded production panel     (design + text + logo)
 *   zone 2  ->  the clean/background panel       (the same design, no overlay)
 *   zone 3  ->  the cut graphics                 (the overlays by themselves)
 *
 * Zones 1/2 use the Studio template rectangles authored from GENIE geometry
 * before Gemini runs. Those coordinates are the surface identity; generated
 * pixels are never re-detected or counted. Zone 3 remains unverified raster slot crops
 * until the separate overlay-compositor phase.
 *
 * No model call or new artwork producer is introduced here.
 */

const PANELS_CONTRACT = "designpro.atlas-proof-panels.v2";

const { containerLayout } = require("./atlas-proof-container-template.cjs");
const { PROOF_REGIONS } = require("./atlas-panel-proof-contract.cjs");

/** The three quadrants, by the role each plays downstream. */
const QUADRANTS = Object.freeze({
  zone1: "branded",
  zone2: "clean",
  zone3: "cut-graphic",
});

/**
 * Scale a container cell onto the sheet that actually came back.
 *
 * The container is authored at 1536x1024 and the model returns ~5056x3392, so
 * every rectangle is proportional rather than absolute. Rounded OUTWARD on the
 * far edge and clamped to the sheet, because a half-pixel short on a panel edge
 * is a white hairline down the print and sharp throws on an extract that runs
 * past the image.
 */
function scaleCell(cell, layout, sheet) {
  const sx = sheet.width / layout.width;
  const sy = sheet.height / layout.height;
  const left = Math.max(0, Math.floor(cell.x * sx));
  const top = Math.max(0, Math.floor(cell.y * sy));
  const width = Math.min(sheet.width - left, Math.max(1, Math.ceil(cell.w * sx)));
  const height = Math.min(sheet.height - top, Math.max(1, Math.ceil(cell.h * sy)));
  return { left, top, width, height };
}

/**
 * HOW MUCH OF THE CELL IS ACTUALLY PAINTED.
 *
 * The one honest signal that the model filled this rectangle rather than
 * arranging its own. Deliberately the crudest possible measure — the share of
 * pixels that are not the page — because anything cleverer would be a second
 * definition of "artwork" competing with the gates that already own it.
 */
async function inkFraction(sharp, bytes, rect) {
  const { data, info } = await sharp(bytes)
    .extract(rect)
    .resize({ width: 64, height: 64, fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    // Page is white; anything meaningfully darker is paint.
    if (data[i] < 246 || data[i + 1] < 246 || data[i + 2] < 246) ink += 1;
  }
  return total ? Number((ink / total).toFixed(4)) : 0;
}

/**
 * ⛔ A PANEL IS A FULL RECTANGLE (owner rule, 2026-09-25: "the hood must NEVER
 * be cut to shape; it's always a full rectangle").
 *
 * Live 9999ec65 / revision 677d34fb: the model drew the hood cell as a
 * hood-shaped island on white (fit 0.83 in BOTH bands, so the die-cut band
 * comparison only raised a notice), and the roof cell carried a thin white
 * strip on its left edge. The cut below stored both verbatim, and the same
 * quadrant bytes became the Call-11 QC panel, the master hood/roof zone and
 * the Calls 2-7 conditioning. This is the one place that repairs all three.
 *
 * Two deterministic pixel passes, zero model calls, and the output is ALWAYS
 * the exact width x height of the cell, so `rect`, inches, master placement
 * and every downstream geometry contract are unchanged:
 *
 *   trimEdgeStrips         every Zone 1/2 cell. Removes edge rows/columns that
 *                          are >= 92% page white, at most max(6px, 2%) per edge,
 *                          then scales back to the cell size. A strip that
 *                          reaches the cap is a design (white ground), not an
 *                          artefact, and is left alone.
 *   enforceRectangularPanel  HOOD only. A border-connected page-white surround
 *                          of 4%..35% of the cell that takes >= 3 corners, or
 *                          both corners of one edge while that edge's midpoint
 *                          is artwork (a hood narrowing to the windshield), is a
 *                          die-cut silhouette; it is repaired by cropping to the
 *                          largest inner artwork rectangle (only when that is
 *                          >= 50% of the cell) and cover-scaling back. A white
 *                          ground design (surround > 35%), a white logo or band
 *                          (< 3 corners) or an unrepairable cell is left exactly
 *                          as drawn and only reported.
 *
 * Nothing here throws into the cut: a guard failure keeps the original bytes
 * and records the reason.
 *
 * POLICY (owner, 2026-09-25: "hood fix in report-only mode"). The default is
 * REPORT: with `DESIGNPRO_RECT_GUARD_POLICY` unset (or empty, or any value not
 * listed below) both passes MEASURE and record `rectGuard` on the panel but
 * never modify a pixel, so production ships measure-only without a server env
 * change. `=repair` explicitly enables the pixel repairs described above;
 * `=report` is the default spelled out; `=off` restores the exact previous
 * behaviour (no measurement at all, no `rectGuard` field).
 */
const RECT_GUARD_CONTRACT = "designpro.rect-panel-guard.v1";
const RECT_GUARD = Object.freeze({
  whiteMin: 245,
  alphaMax: 16,
  stripCoverage: 0.92,
  maxStripFrac: 0.02,
  maxStripPxFloor: 6,
  surroundMinRatio: 0.04,
  surroundMaxRatio: 0.35,
  minCornersTouched: 3,
  cornerFrac: 0.03,
  minInnerRectRatio: 0.5,
});
const RECT_ENFORCED_SURFACES = Object.freeze(["hood"]);

const RECT_GUARD_DEFAULT_POLICY = "report";

function rectGuardPolicy(env = process.env) {
  const value = String(env?.DESIGNPRO_RECT_GUARD_POLICY || "").trim().toLowerCase();
  // Only an explicit, exact opt-in repairs pixels; anything else fails safe to
  // measure-only. No policy value may throw into the cut.
  return value === "off" || value === "report" || value === "repair" ? value : RECT_GUARD_DEFAULT_POLICY;
}

function isPage(data, i, o) {
  if (data[i + 3] <= o.alphaMax) return true;
  return data[i] >= o.whiteMin && data[i + 1] >= o.whiteMin && data[i + 2] >= o.whiteMin;
}

async function rawRgba(sharp, bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Leading page-white strips on each edge; a strip that hits the cap counts as 0. */
function measureEdgeStrips(data, w, h, opts = {}) {
  const o = { ...RECT_GUARD, ...opts };
  const colPage = (x) => { let n = 0; for (let y = 0; y < h; y++) if (isPage(data, (y * w + x) * 4, o)) n++; return n / h; };
  const rowPage = (y) => { let n = 0; for (let x = 0; x < w; x++) if (isPage(data, (y * w + x) * 4, o)) n++; return n / w; };
  const maxX = Math.min(Math.floor(w / 4), Math.max(o.maxStripPxFloor, Math.floor(w * o.maxStripFrac)));
  const maxY = Math.min(Math.floor(h / 4), Math.max(o.maxStripPxFloor, Math.floor(h * o.maxStripFrac)));
  const run = (limit, probe) => { let k = 0; while (k < limit && probe(k) >= o.stripCoverage) k++; return k; };
  const strips = {
    left: run(maxX, (k) => colPage(k)),
    right: run(maxX, (k) => colPage(w - 1 - k)),
    top: run(maxY, (k) => rowPage(k)),
    bottom: run(maxY, (k) => rowPage(h - 1 - k)),
  };
  if (strips.left >= maxX) strips.left = 0;
  if (strips.right >= maxX) strips.right = 0;
  if (strips.top >= maxY) strips.top = 0;
  if (strips.bottom >= maxY) strips.bottom = 0;
  return strips;
}

/** Border-connected page region (4-neighbour flood fill) and the corners it takes. */
function measureSurround(data, w, h, opts = {}) {
  const o = { ...RECT_GUARD, ...opts };
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p) => { if (!seen[p] && isPage(data, p * 4, o)) { seen[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let count = 0;
  while (sp > 0) {
    const p = stack[--sp]; count++;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p + w < w * h) push(p + w);
  }
  const c = Math.max(3, Math.min(Math.floor(Math.min(w, h) / 2), Math.round(Math.min(w, h) * o.cornerFrac)));
  const cornerTaken = (x0, y0) => {
    let n = 0;
    for (let y = y0; y < y0 + c; y++) for (let x = x0; x < x0 + c; x++) if (seen[y * w + x]) n++;
    return n / (c * c) >= 0.5;
  };
  // [top-left, top-right, bottom-left, bottom-right]
  const corners = [cornerTaken(0, 0), cornerTaken(w - c, 0), cornerTaken(0, h - c), cornerTaken(w - c, h - c)];
  const midX = Math.max(0, Math.floor((w - c) / 2));
  const midY = Math.max(0, Math.floor((h - c) / 2));
  // Two taken corners on ONE edge whose midpoint is artwork are cut-outs from
  // that edge (a hood narrowing toward the windshield). Two taken corners on an
  // edge whose midpoint is page are a band along it (a white sky): not a cut.
  const edgePairs = [
    corners[0] && corners[1] && !cornerTaken(midX, 0),
    corners[2] && corners[3] && !cornerTaken(midX, h - c),
    corners[0] && corners[2] && !cornerTaken(0, midY),
    corners[1] && corners[3] && !cornerTaken(w - c, midY),
  ];
  return { mask: seen, ratio: count / (w * h), cornersTouched: corners.filter(Boolean).length,
    cornerCutEdge: edgePairs.some(Boolean) };
}

/** Largest axis-aligned rectangle with no surround pixel (histogram method). */
function largestInnerRect(mask, w, h) {
  const heights = new Int32Array(w);
  const st = new Int32Array(w + 1);
  let best = { x: 0, y: 0, w: 0, h: 0, area: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = mask[y * w + x] ? 0 : heights[x] + 1;
    let sp = 0;
    for (let x = 0; x <= w; x++) {
      const cur = x === w ? 0 : heights[x];
      while (sp > 0 && heights[st[sp - 1]] >= cur) {
        const hh = heights[st[--sp]];
        const left = sp > 0 ? st[sp - 1] + 1 : 0;
        const area = hh * (x - left);
        if (area > best.area) best = { x: left, y: y - hh + 1, w: x - left, h: hh, area };
      }
      st[sp++] = x;
    }
  }
  return best;
}

async function trimEdgeStrips(sharp, bytes, opts = {}) {
  const { data, w, h } = await rawRgba(sharp, bytes);
  const strips = measureEdgeStrips(data, w, h, opts);
  if (!strips.left && !strips.right && !strips.top && !strips.bottom) return { bytes, changed: false, strips: null };
  const out = await sharp(bytes)
    .extract({ left: strips.left, top: strips.top, width: w - strips.left - strips.right, height: h - strips.top - strips.bottom })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes: out, changed: true, strips };
}

async function enforceRectangularPanel(sharp, bytes, { policy = "repair", ...opts } = {}) {
  const o = { ...RECT_GUARD, ...opts };
  const { data, w, h } = await rawRgba(sharp, bytes);
  const s = measureSurround(data, w, h, o);
  const silhouette = s.ratio >= o.surroundMinRatio && s.ratio <= o.surroundMaxRatio
    && (s.cornersTouched >= o.minCornersTouched || s.cornerCutEdge);
  const report = { surroundRatio: Number(s.ratio.toFixed(4)), cornersTouched: s.cornersTouched,
    cornerCutEdge: s.cornerCutEdge, silhouette };
  if (!silhouette || policy !== "repair") return { bytes, changed: false, report };
  const r = largestInnerRect(s.mask, w, h);
  const innerRatio = Number((r.area / (w * h)).toFixed(4));
  if (innerRatio < o.minInnerRectRatio) {
    return { bytes, changed: false, report: { ...report, innerRectRatio: innerRatio, repaired: false, reason: "inner_rect_too_small" } };
  }
  const out = await sharp(bytes)
    .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
    .resize(w, h, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes: out, changed: true,
    report: { ...report, repaired: true, innerRectRatio: innerRatio, innerRect: { x: r.x, y: r.y, w: r.w, h: r.h } } };
}

/** Both passes on one Zone 1/2 cell. Never throws; the original bytes survive any failure. */
async function guardPanelRectangle(sharp, bytes, { surfaceKey, policy = rectGuardPolicy() } = {}) {
  if (policy === "off") return { bytes, rectGuard: null };
  const rectGuard = { contract: RECT_GUARD_CONTRACT, policy, edgeStrips: null, changed: false };
  let out = bytes;
  try {
    const edge = await trimEdgeStrips(sharp, out);
    if (edge.strips) rectGuard.edgeStrips = edge.strips;
    if (edge.changed && policy === "repair") { out = edge.bytes; rectGuard.changed = true; }
    if (RECT_ENFORCED_SURFACES.includes(surfaceKey)) {
      const rect = await enforceRectangularPanel(sharp, out, { policy });
      rectGuard.surround = rect.report;
      if (rect.changed) { out = rect.bytes; rectGuard.changed = true; }
    }
  } catch (cause) {
    return { bytes, rectGuard: { ...rectGuard, changed: false, error: String(cause?.message || cause).slice(0, 200) } };
  }
  return { bytes: out, rectGuard };
}

/**
 * Cut every quadrant's cells out of a returned proof sheet.
 *
 * @returns {{contract, sheet, panels, refused}} — `panels` carry BYTES; the
 *   caller stores them under their own sha256 and is what binds them to a
 *   revision. Storing is deliberately not this function's job: it is pure
 *   pixels in, pixels out, which is what makes it testable without a bucket.
 */
async function cutProofPanels({
  proofBytes,
  manifest,
  zones = ["zone1", "zone2", "zone3"],
  sharp = require("sharp"),
  rectPolicy = rectGuardPolicy(),
} = {}) {
  const layout = containerLayout(manifest);
  const meta = await sharp(proofBytes).metadata();
  if (!meta.width || !meta.height) throw new Error("atlas_proof_panels_unreadable_sheet");
  const sheet = { width: meta.width, height: meta.height };

  // A SHEET OF THE WRONG SHAPE MAKES EVERY RECTANGLE MEANINGLESS. The edge's
  // own shape gate already refuses a genuine re-flow before it reaches here;
  // this is the second door, because cutting against a stretched sheet would
  // produce six plausible panels of the wrong regions.
  const wantAspect = layout.width / layout.height;
  const gotAspect = sheet.width / sheet.height;
  if (Math.abs(gotAspect - wantAspect) / wantAspect > 0.02) {
    return {
      contract: PANELS_CONTRACT,
      sheet,
      panels: [],
      refused: `atlas_proof_panels_aspect_drift:${gotAspect.toFixed(3)}!=${wantAspect.toFixed(3)}`,
    };
  }

  const panels = [];
  for (const zone of zones) {
    const cells = layout[zone];
    if (!Array.isArray(cells)) throw new Error(`atlas_proof_panels_unknown_zone:${zone}`);
    let assignments;
    if (zone === "zone1" || zone === "zone2") {
      // Studio authored these cells from GENIE geometry before Gemini ran.
      // Their coordinates are therefore the authority. Do NOT re-detect/count
      // rectangles from generated pixels: that redundant locator produced the
      // live 3<6 / 5<6 / 7!=6 false refusals and blocked valid customer work.
      assignments = cells.map((cell) => ({
        cell,
        rect: scaleCell(cell, layout, sheet),
        identity: {
          method: "studio-template-cell",
          surfaceKey: cell.surfaceKey,
          geometryAuthority: "GENIE",
        },
        opaqueEdgeExtensionPx: 0,
        opaqueEdgeExtensionBoundedToBand: true,
      }));
    } else {
      // Phase 2 owns overlay extraction. These remain explicitly unverified.
      assignments = cells.map((cell) => ({ cell, rect: scaleCell(cell, layout, sheet), identity: null, opaqueEdgeExtensionPx: 0, opaqueEdgeExtensionBoundedToBand: false }));
    }
    for (const { cell, rect, identity, opaqueEdgeExtensionPx = 0, opaqueEdgeExtensionBoundedToBand = false } of assignments) {
      const cellBytes = await sharp(proofBytes)
        .extract(rect)
        .png({ compressionLevel: 9 })
        .toBuffer();
      // Zones 1/2 are full-bleed production panels; Zone 3 slots are marks on
      // a ground and are never squared up.
      const guarded = zone === "zone1" || zone === "zone2"
        ? await guardPanelRectangle(sharp, cellBytes, { surfaceKey: cell.surfaceKey, policy: rectPolicy })
        : { bytes: cellBytes, rectGuard: null };
      const bytes = guarded.bytes;
      panels.push({
        zone,
        role: QUADRANTS[zone],
        surfaceKey: cell.surfaceKey,
        // The PRINT geometry this rectangle stands for, carried through from
        // GENIE so the panel knows its own inches without a second lookup.
        // Zone 3 slots have none: a cut graphic is sized at the plotter.
        widthIn: cell.widthIn ?? null,
        heightIn: cell.heightIn ?? null,
        rect,
        bytes,
        byteSize: bytes.length,
        fit: await inkFraction(sharp, proofBytes, rect),
        positionalPremiseVerified: identity !== null,
        identity,
        opaqueEdgeExtensionPx,
        opaqueEdgeExtensionBoundedToBand,
        // Geometric identity is not semantic/logo correctness or human QC.
        productionApproved: false,
        ...(guarded.rectGuard ? { rectGuard: guarded.rectGuard } : {}),
      });
    }
  }

  return { contract: PANELS_CONTRACT, sheet, panels, refused: null };
}

module.exports = {
  PANELS_CONTRACT, QUADRANTS, cutProofPanels, scaleCell,
  RECT_GUARD_CONTRACT, RECT_GUARD, RECT_ENFORCED_SURFACES, RECT_GUARD_DEFAULT_POLICY, rectGuardPolicy,
  measureEdgeStrips, measureSurround, largestInnerRect,
  trimEdgeStrips, enforceRectangularPanel, guardPanelRectangle,
};
