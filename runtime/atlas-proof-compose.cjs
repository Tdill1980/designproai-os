"use strict";
/**
 * runtime/atlas-proof-compose.cjs — THE NUMBERS ARE DRAWN, NEVER PROMPTED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Live sheet 35393135814 printed the driver panel as 195.7" x 89.6" in Zone 1,
 * 155.7" x 49.6" in Zone 2 and 105.7" x 49.6" in its own reference table — on a
 * request that said 141 x 78. Its template notes read "Drop-impertanli
 * zlomadte onteed: 1" frore the ican lew" and its legend "Banti sise (insfr
 * blood)".
 *
 * WHAT WAS ALREADY TRIED, AND IS NOT THE ANSWER.
 *
 * 1. BAKING THE NUMBERS INTO THE ATTACHED CONTAINER. Already shipped: the
 *    container handed to that very request carries "141.0" ten times and
 *    "78.0" twelve times, plus the complete reference row, notes and legend,
 *    burned into pixels. The model printed 195.7 anyway, because it does not
 *    FILL the template — it redraws a picture that resembles it, re-typing
 *    every glyph. A 8-pixel numeral re-typed by a diffusion model is a guess
 *    with a plausible shape.
 *
 * 2. A NEGATIVE CONSTRAINT — "modifying or recalculating these values is a
 *    failure". That is the prompt shape this repository has measured failing
 *    four times out of four: `atlasFieldContract` printed the panel map's
 *    coordinates and then said "None of the map is drawn", and four consecutive
 *    live runs painted the coordinates onto the customer's flanks. A negative
 *    standing next to the thing it forbids is an instruction to attend to it.
 *
 * WHAT THE ANSWER IS, AND IT IS NOT NEW HERE (RULE 1 — recover before you
 * invent). RestylePro hit this exact wall and its CLAUDE.md states the fix in
 * as many words: "the sheet is assembled by CODE (imagescript). Header, footer,
 * tile labels and per-tile GENIE callouts are DRAWN, never prompted, SO THEY
 * CANNOT BE HALLUCINATED."
 *
 * A number the model never types is a number it cannot get wrong.
 *
 * SO THE DIVISION IS RULE 0.27's, APPLIED TO THE DOCUMENT: the A.I. owns the
 * design, the code owns the geometry. The model returns ARTWORK in three bands.
 * This composites the entire document over it at full resolution — header, job
 * block, total coverage, zone titles, every dimension, the reference row, the
 * notes and the legend.
 *
 * WHAT STAYS MODEL-DRAWN, DELIBERATELY: every word that belongs to the WRAP —
 * the company name, the contact line, the services, the promotional text, set
 * in the design's own typeface on the panels. Those came back perfect on all
 * three live sheets, they are the design, and code cannot typeset them into
 * artwork it did not compose. Only the DOCUMENT's metadata moves.
 *
 * ALIGNMENT, HONESTLY. The chrome is drawn at the container's own cell
 * positions, and the model re-flows panels inside a band — `atlas-proof-zone-
 * gate.cjs` records that being proved on d5314267. What it has NOT done on any
 * of the three live sheets is reorder them or leave a band: driver, passenger,
 * roof, hood, front, rear, left to right, 3/3. So a caption sits under its own
 * panel by ORDER rather than by measurement, and the figures that must be exact
 * — the reference row, the coverage total, the job block — are page furniture
 * at fixed positions where no re-flow can reach them.
 */

const CHROME_CONTRACT = "designpro.atlas-proof-chrome.v1";

const { containerSvg, WIDTH, HEIGHT } = require("./atlas-proof-container-template.cjs");

/**
 * Draw the document over the returned artwork.
 *
 * @param proofBytes the sheet the model returned, any size, PNG or JPEG.
 * @returns PNG bytes at the sheet's own resolution.
 */
async function composeProofChrome({
  proofBytes, manifest, companyName = "", vehicle = "", bleedInches = 5,
  // The header job block. It used to be asked of the model; once the model was
  // told to draw no document, those four values had nowhere to land, so they
  // come through here instead. Absent fields draw the ruled line the blank
  // template draws, which is what an unfilled proof should look like.
  job = {},
  sharp = require("sharp"),
} = {}) {
  const meta = await sharp(proofBytes).metadata();
  if (!meta.width || !meta.height) throw new Error("atlas_proof_chrome_unreadable_sheet");

  // THE CHROME IS RENDERED AT THE SHEET'S OWN RESOLUTION, not scaled up from a
  // 1536px raster. It is vector, so the type stays sharp at 5056 wide — which
  // is the entire reason a 8px caption the model could not draw legibly is
  // legible here.
  const svg = containerSvg({ manifest, companyName, vehicle, bleedInches, job, mode: "chrome" });
  const chrome = await sharp(Buffer.from(svg), { density: 72 })
    .resize({ width: meta.width, height: meta.height, fit: "fill" })
    .png()
    .toBuffer();

  const composed = await sharp(proofBytes)
    .composite([{ input: chrome, top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    bytes: composed,
    contract: CHROME_CONTRACT,
    width: meta.width,
    height: meta.height,
    // The aspect the chrome was authored at, against what it was drawn onto. A
    // sheet returned at a different aspect stretches the chrome, so this is
    // reported rather than silently accepted -- the shape gate in the edge
    // already refuses a genuine re-flow before it reaches here.
    designAspect: Number((WIDTH / HEIGHT).toFixed(3)),
    sheetAspect: Number((meta.width / meta.height).toFixed(3)),
  };
}

module.exports = { CHROME_CONTRACT, composeProofChrome };
