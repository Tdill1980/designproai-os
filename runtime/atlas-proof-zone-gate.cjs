"use strict";
/**
 * runtime/atlas-proof-zone-gate.cjs — THE INSPECTOR GATE, POINTED AT THE PANEL
 * CELLS INSTEAD OF THE SHEET.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "The validation logic must actively slice the
 * generated sheet using PROOF_REGIONS to evaluate individual panel cells
 * (checking edge hole ratios and non-black fractions) rather than judging the
 * blank white canvas around it."
 *
 * WHY THIS HAS TO EXIST BEFORE THE CONTRACT CAN SHIP.
 *
 * `deterministicMasterChecks` measures a MASTER: one 4096-square sheet whose
 * every pixel is printable artwork. Under that contract "the border of this
 * zone is 70% dark" means a die-cut silhouette, and "only 4% of this is
 * non-black" means a hole. Both are right, and both are meaningless about a
 * panel production PROOF, which is a white document with captions, dimension
 * lines and tables around six small pictures. Handed a correct proof, the
 * whole-sheet gates would convict it instantly -- the sheet is mostly paper.
 *
 * So the same predicates run, unchanged, over the CELLS. Nothing here redefines
 * "hole": `deterministicMasterChecks` is called with the cell rectangles as its
 * zones, so the cut-out detector, the fill and this gate keep one definition
 * between them -- the reason atlas-master-qc exports its thresholds at all.
 *
 * WHERE THE CELLS COME FROM, and why not from an image search. The container
 * template is drawn by code and the model is told to fill it without re-flowing
 * it, so `containerLayout()` -- the very function that placed those rectangles
 * -- already knows where they are. Detecting them again in the returned pixels
 * would be a second, weaker answer to a question the code can answer exactly.
 *
 * SLICING ALONE IS NOT ENOUGH, AND THE FIRST RUN OF THIS FILE PROVED IT.
 *
 * Measured on the two sheets that exist, both 1536x1024, ZONE 1 cells:
 *
 *     cell        container (EMPTY)   owner's filled twin
 *     driver      ink 0.023           ink 0.565
 *     front       ink 0.055           ink 0.255
 *     every cell  edgeHole 0.000      edgeHole 0.000-0.007
 *                 nonBlack 1.000      nonBlack 0.988-0.999
 *     blocking    0                   0
 *
 * The imported predicates pass the EMPTY container on every cell. They are all
 * DARKNESS tests -- `holeAt` is luma <= 24, `nearBlackAt` <= 40 -- so a blank
 * white panel is not a hole by any of them, and a proof with six empty boxes
 * would have sailed through a gate that only sliced. That is the same shape as
 * the efca5e03 defect this repo already recorded: "Every hole predicate is a
 * DARKNESS test and that surround is luma 88, so edgeHoleRatio read 0.073
 * against a 0.35 limit."
 *
 * `inkFraction` is therefore not a diagnostic extra, it is the discriminator.
 * It separates the two cases by an order of magnitude on every cell and by 4.6x
 * on the worst one (front, 0.055 against 0.255). Slice AND measure ink; slicing
 * by itself buys nothing.
 *
 * ⛔ ITS POSITIONAL PREMISE IS FALSIFIED. DO NOT WIRE THIS TO A GATE YET.
 *
 * Live sheet d5314267 (2026-09-18, the first real run of this contract) settles
 * it. The premise above -- "the model is told to fill the template without
 * re-flowing it, so containerLayout() already knows where the cells are" -- is
 * wrong about what the model actually does. It honoured the three ZONE BANDS
 * and every panel's identity and inches, and then ARRANGED the panels itself:
 * driver and passenger stacked as two rows on the left, roof tall in the middle,
 * hood/front/rear in a two-row block on the right. The container draws all six
 * in ONE row.
 *
 * The numbers this file printed on that sheet looked entirely plausible --
 * ink 0.599 driver, 0.137 hood, no blocking failures -- and an overlay of the
 * rectangles onto the sheet shows them landing on artwork edges, white margin
 * and the gaps between panels. A confident measurement of the wrong rectangle
 * is worse than no measurement, which is exactly what this file says about
 * aspect drift and then did to itself.
 *
 * WHAT THE NEXT BUILD IS: locate the panels IN the returned sheet -- each is a
 * framed rectangle with a dimension callout beside it -- and measure those.
 * The layout stays useful as the EXPECTED arrangement to score fidelity
 * against; it cannot be the source of truth for where to cut.
 *
 * Kept, not deleted, because the aspect refusal, the scaling and the ink
 * measurement are all correct and reusable, and because the falsification is
 * worth more written down than re-derived.
 *
 * IT REPORTS; IT DOES NOT REFUSE, and nothing consumes it. RULE 0.32's own
 * warning about the plain-surround detector is the precedent: built, measured,
 * deliberately left non-blocking until a discriminator exists.
 */

const { containerLayout } = require("./atlas-proof-container-template.cjs");
const { deterministicMasterChecks } = require("./atlas-master-qc.cjs");

const ZONE_GATE_CONTRACT = "designpro.atlas-proof-zone-gate.v1";

/**
 * A returned sheet is NOT the container's pixel size. The request asks for 4K
 * at 3:2, so the model answers at whatever 3:2 raster it produces -- 1536x1024
 * is the container's own canvas and nothing promises the sheet matches it.
 * Every rectangle therefore scales by the sheet's own width.
 *
 * The ASPECT is what must agree, not the pixel count: a sheet returned at a
 * different ratio has re-flowed the layout, and scaled rectangles would then
 * point at the wrong parts of it. That is a refusal, because measuring the
 * wrong rectangle and reporting a number is worse than reporting nothing.
 */
const MAX_ASPECT_DRIFT = 0.02;

function scaleCells(cells, layout, sheet) {
  const sx = sheet.width / layout.width;
  const sy = sheet.height / layout.height;
  return cells.map((cell) => ({
    surfaceKey: cell.surfaceKey,
    x: Math.round(cell.x * sx),
    y: Math.round(cell.y * sy),
    // `w`/`h`, not `width`/`height`: that is the shape `validatedZone` reads,
    // and it throws atlas_master_qc_zone_invalid on anything else.
    w: Math.max(1, Math.round(cell.w * sx)),
    h: Math.max(1, Math.round(cell.h * sy)),
  }));
}

/**
 * How much of each cell is actually painted.
 *
 * This is the number that says whether the model filled the template or drew
 * its own arrangement, and it is deliberately the crudest possible measure --
 * not "is this good artwork" but "is there ink here at all". A cell the model
 * left as paper reads near zero; a filled panel reads near one. Judge the
 * fidelity before trusting any other number on that cell, because every other
 * number is about a rectangle we only BELIEVE is a panel.
 */
async function cellInkFraction(sharp, bytes, cell) {
  const { data, info } = await sharp(bytes)
    .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let inked = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1] ?? r;
    const b = data[i + 2] ?? r;
    // Paper is near-white and near-neutral. Anything else is ink of some kind:
    // artwork, a caption, a dimension line. A cell holding only a thin rule
    // still reads low, which is the point -- it is not a filled panel.
    if (r < 236 || g < 236 || b < 236) inked += 1;
  }
  return total ? inked / total : 0;
}

/**
 * Measure the panel cells of a returned proof sheet.
 *
 * @returns {{contract, sheet, cells, blocking, cutout, refused}} — `refused`
 *   is set only when the sheet's own shape makes the rectangles meaningless.
 */
async function inspectProofZones({ proofBytes, manifest, sharp = require("sharp"), band = "zone1" }) {
  const layout = containerLayout(manifest);
  const meta = await sharp(proofBytes).metadata();
  const sheet = { width: meta.width, height: meta.height };
  const wantAspect = layout.width / layout.height;
  const gotAspect = sheet.width / sheet.height;
  if (Math.abs(gotAspect - wantAspect) / wantAspect > MAX_ASPECT_DRIFT) {
    return {
      contract: ZONE_GATE_CONTRACT,
      sheet,
      refused: `proof_zone_gate_aspect_drift:${gotAspect.toFixed(3)}!=${wantAspect.toFixed(3)}`,
      cells: [],
      blocking: [],
      cutout: [],
    };
  }

  const cells = scaleCells(layout[band], layout, sheet);
  const fidelity = {};
  for (const cell of cells) fidelity[cell.surfaceKey] = await cellInkFraction(sharp, proofBytes, cell);

  // THE SAME PREDICATES, POINTED AT THE CELLS. `deterministicMasterChecks`
  // takes zones in pixel coordinates, so handing it the cell rectangles makes
  // it measure panels instead of the document -- with no second definition of
  // "hole" anywhere in this file.
  // POSITIONAL, and the zones carry the manifest's own key names. Calling it
  // with an options object silently hands sharp an object where bytes belong.
  const checks = await deterministicMasterChecks(proofBytes, { zones: cells });

  return {
    contract: ZONE_GATE_CONTRACT,
    sheet,
    band,
    // FALSIFIED ON LIVE SHEET d5314267: the model keeps the zone bands and the
    // panel identities and then arranges the panels itself, so these rectangles
    // are where the CONTAINER put them, not where the proof drew them. Every
    // per-cell number below is about a rectangle we only assumed was a panel.
    positionalPremiseVerified: false,
    cells: (checks.zones || []).map((zone) => ({
      surfaceKey: zone.surfaceKey,
      inkFraction: Number((fidelity[zone.surfaceKey] ?? 0).toFixed(4)),
      edgeHoleRatio: Number((zone.edgeHoleRatio ?? 0).toFixed(5)),
      nonBlackFraction: Number((zone.nonBlackFraction ?? 0).toFixed(5)),
      opaqueRatio: Number((zone.opaqueRatio ?? 0).toFixed(5)),
      plainSurroundRingRatio: Number((zone.plainSurroundRingRatio ?? 0).toFixed(4)),
    })),
    // Reported, never thrown. See the header: these thresholds were calibrated
    // against the container, not against a real returned sheet.
    blocking: checks.blockingFailures || [],
    cutout: checks.cutoutFindings || [],
  };
}

module.exports = {
  ZONE_GATE_CONTRACT,
  MAX_ASPECT_DRIFT,
  inspectProofZones,
  _test: { scaleCells, cellInkFraction },
};
