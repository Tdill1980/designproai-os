"use strict";

/**
 * THE DETERMINISTIC COMPOSITOR: ground artwork in, canonical master out.
 *
 * Call 1 authors the GROUND -- palette, texture, motion, depth, the mascot
 * illustration and any photographic scene -- as one continuous full-bleed
 * field. It no longer draws the company name, the URL, the phone number or the
 * contact bar, because a raster the model painted is a raster the cutter can
 * saw in half, and it did: `Www.Arct` on Arctic Air's hood and `ticAir.com` on
 * its rear were one string that Gemini had no way to know would be cut.
 *
 * This module puts those elements on afterwards, at rectangles
 * `atlas-element-plan.cjs` proved are inside one surface's trim box. It runs
 * BEFORE canonical master acceptance, so every downstream consumer -- the
 * deterministic QC, the output-class gate, the cut-out fill, the six panels,
 * the seven proofs, Call 8, the ZIP -- sees the finished sheet and nothing
 * needs to know composition happened.
 *
 * IT MAKES NO NETWORK CALL AND NO CREATIVE DECISION. Every rectangle arrives in
 * the plan; every string arrives from the frozen request; every image arrives
 * as resolved bytes with a digest. Compose the same inputs twice and the bytes
 * are identical, which is what lets `panelSourceHash` mean anything.
 *
 * TYPE IS OUTLINED FROM PINNED FONT BYTES, NEVER A FAMILY NAME. libvips
 * resolves `font-family` through fontconfig and substitutes silently -- DejaVu
 * Serif Bold, DejaVu Sans Mono and a family that does not exist all rasterise
 * without complaint, and nothing downstream could tell which one printed.
 * `opentype-outline.cjs` reads the glyph contours out of the exact bytes we
 * hash, which is also how wraps are actually sent to print: type converted to
 * curves so no font has to exist at output time.
 *
 * WHY THIS IS NOT "LAYERING TEXT OVER CLIPPED LETTERING". The owner's
 * requirement is explicit and this module depends on it: the ground must arrive
 * WITHOUT the lettering. `assertGroundIsLetteringFree` cannot read pixels for
 * intent, so the guarantee is contractual and upstream -- the Call-1 field
 * contract at `designpro.atlas-field-prompt.v3` asks for ground only, and the
 * composition receipt records which contract authored the ground it composed
 * onto. Compositing onto a v24 ground is refused by version, not by hope.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { verifyPlanContainment } = require("./atlas-element-plan.cjs");
const { outlineString } = require("./opentype-outline.cjs");

const COMPOSE_CONTRACT = "designpro.atlas-compose-master.v1";

/**
 * The ground contracts this compositor will paint onto. A ground authored by a
 * contract that still draws its own lettering is refused: composing over it
 * would stack a correct URL on top of a severed one, which is the failure mode
 * the owner ruled out by name.
 */
const COMPOSABLE_GROUND_CONTRACTS = Object.freeze(["designpro.atlas-field-prompt.v3"]);

/** Nominal outlining resolution for measuring a string's intrinsic aspect. */
const MEASURE_PPI = 1000;

/** A wrap sets a name on one, two or three lines. Four is a paragraph. */
const MAX_TEXT_LINES = 3;

/**
 * A contact line has to stay legible over whatever the ground did, and a wrap
 * designer solves that with a bar rather than by hoping. The scrim is a flat
 * rounded plate under the contact text only; it is deterministic, it is inside
 * the same proven rectangle, and it can be turned off per run.
 */
const DEFAULT_PLATE = Object.freeze({
  kinds: Object.freeze(["contact"]),
  fill: "#0b1f3a",
  opacity: 0.62,
  radiusFraction: 0.22,
  padFraction: 0.14,
});

class ComposeError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "ComposeError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new ComposeError(code, message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Break a string into `lines` roughly balanced lines, on word boundaries.
 *
 * Greedy-balanced rather than greedy: a two-line set of "Precision Climate
 * Solutions" reads "Precision Climate / Solutions", not "Precision / Climate
 * Solutions". A word longer than a whole line is never split -- hyphenating a
 * company name is a worse outcome than a wide line, and the caller can always
 * fall back to fewer lines.
 */
function wrapStringToLines(string, lines) {
  const words = String(string).trim().split(/\s+/).filter(Boolean);
  if (lines <= 1 || words.length <= 1) return [words.join(" ")];
  const target = Math.ceil(words.length / lines);
  const out = [];
  for (let i = 0; i < words.length; i += target) out.push(words.slice(i, i + target).join(" "));
  // Never return more rows than asked for: the remainder joins the last line.
  while (out.length > lines) out[out.length - 2] = `${out[out.length - 2]} ${out.pop()}`;
  return out;
}

/**
 * Measure a string's intrinsic aspect from the pinned font, so the planner
 * sizes a rectangle the type actually fills. Outlined once at a nominal size;
 * the ratio is resolution-independent.
 *
 * `lines` measures the string SET ON THAT MANY LINES -- width is the widest
 * line, height is the line count times the em box. This is what makes a long
 * company name placeable: "Precision Climate Solutions" is 13.3:1 on one line
 * and cannot reach a legible cap height inside a flank's wordmark slot, and is
 * 6.0:1 on two, which fits with room to spare. Refusing the design instead
 * would have been correct and useless.
 */
function measureOutlinedString({ fontBytes, string, lines = 1 }) {
  const textLines = wrapStringToLines(string, lines);
  let widthPx = 0;
  let lineHeightPx = 0;
  for (const line of textLines) {
    const outlined = outlineString({ fontBytes, string: line || " ", sizeIn: 1, pxPerInch: MEASURE_PPI });
    widthPx = Math.max(widthPx, outlined.widthPx);
    lineHeightPx = Math.max(lineHeightPx, outlined.heightPx);
  }
  const heightPx = lineHeightPx * textLines.length;
  return { aspect: widthPx / heightPx, widthPx, heightPx, lines: textLines.length, textLines };
}

/**
 * Every line-count a string could reasonably be set on, cheapest first.
 *
 * The planner picks the variant that yields the greatest physical cap height
 * inside the slot it has -- so a short name stays on one line and a long one
 * reflows, and neither outcome is a refusal.
 */
function textVariants({ fontBytes, string, maxLines = MAX_TEXT_LINES }) {
  const words = String(string).trim().split(/\s+/).filter(Boolean).length;
  const ceiling = Math.max(1, Math.min(maxLines, words));
  const variants = [];
  for (let lines = 1; lines <= ceiling; lines += 1) {
    const measured = measureOutlinedString({ fontBytes, string, lines });
    // Two line counts that wrap identically are one variant.
    if (variants.some((v) => v.textLines.join("\u0000") === measured.textLines.join("\u0000"))) continue;
    variants.push({ lines: measured.lines, textLines: measured.textLines, aspect: measured.aspect });
  }
  return variants;
}

/** Measure a resolved image asset's intrinsic aspect and pixel size. */
async function measureImageAsset(bytes) {
  const meta = await sharp(bytes).metadata();
  const width = Number(meta.width);
  const height = Number(meta.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    fail("atlas_compose_asset_undecodable", "an element asset did not decode to a positive pixel size");
  }
  return { aspect: width / height, widthPx: width, heightPx: height, hasAlpha: Boolean(meta.hasAlpha) };
}

/** The outlined string as an SVG buffer that exactly fills `rect`. */
function typeLayerSvg({ fontBytes, string, rect, fill, lines = 1 }) {
  const measured = measureOutlinedString({ fontBytes, string, lines });
  const scale = Math.min(rect.w / measured.widthPx, rect.h / measured.heightPx);
  if (!(scale > 0)) fail("atlas_compose_type_unscalable", `"${string}" does not scale into ${rect.w}x${rect.h}px`);

  // Each line is outlined at the SAME size, so the set reads as one block and
  // a two-line name does not arrive with mismatched cap heights.
  const drawn = measured.textLines.map((line) =>
    outlineString({ fontBytes, string: line || " ", sizeIn: 1, pxPerInch: MEASURE_PPI * scale }));
  const lineHeight = Math.max(...drawn.map((d) => d.heightPx));
  const blockWidth = Math.max(...drawn.map((d) => d.widthPx));
  const blockHeight = lineHeight * drawn.length;
  const originY = Math.max(0, Math.round((rect.h - blockHeight) / 2));

  // Lines are CENTRED on each other, which is how a wrap sets a stacked name.
  const paths = drawn.map((d, index) => {
    const dx = Math.round((rect.w - d.widthPx) / 2);
    const dy = originY + index * lineHeight;
    return `<g transform="translate(${dx} ${dy})"><path d="${d.path}" fill="${fill}" fill-rule="nonzero"/></g>`;
  }).join("");

  return {
    svg: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${rect.w} ${rect.h}">`
      + `${paths}</svg>`,
    ),
    drawnWidthPx: blockWidth,
    drawnHeightPx: blockHeight,
    lines: drawn.length,
    textLines: measured.textLines,
  };
}

/** The legibility plate that sits under a contact line. */
function plateSvg(rect, plate) {
  const radius = Math.round(Math.min(rect.w, rect.h) * plate.radiusFraction);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${rect.w} ${rect.h}">`
    + `<rect x="0" y="0" width="${rect.w}" height="${rect.h}" rx="${radius}" ry="${radius}" `
    + `fill="${plate.fill}" fill-opacity="${plate.opacity}"/></svg>`,
  );
}

/** Grow a rectangle by a fraction of its own height, clamped to `bounds`. */
function padRect(rect, fraction, bounds) {
  const pad = Math.round(rect.h * fraction);
  const x = Math.max(bounds.x, rect.x - pad);
  const y = Math.max(bounds.y, rect.y - pad);
  const right = Math.min(bounds.x + bounds.w, rect.x + rect.w + pad);
  const bottom = Math.min(bounds.y + bounds.h, rect.y + rect.h + pad);
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

/**
 * Compose the canonical master.
 *
 * @param groundBytes  the normalized Call-1 ground field, 4096x4096
 * @param manifest     the GENIE manifest the plan was proved against
 * @param plan         the output of `planAtlasElements`
 * @param sources      elementRef -> { kind, bytes?, string?, fill?, contentHash? }
 * @param fontBytes    the pinned font file, for every outlined-type element
 * @param groundContract  the Call-1 field contract that authored `groundBytes`
 */
async function composeAtlasMaster({
  groundBytes,
  manifest,
  plan,
  sources,
  fontBytes,
  groundContract,
  plate = DEFAULT_PLATE,
  composableGroundContracts = COMPOSABLE_GROUND_CONTRACTS,
} = {}) {
  if (!Buffer.isBuffer(groundBytes)) fail("atlas_compose_ground_missing", "the ground master bytes are required");
  if (!plan || !Array.isArray(plan.placements)) fail("atlas_compose_plan_missing", "an element plan is required");

  // REFUSED BY VERSION, NOT BY HOPE. A ground authored by a contract that still
  // paints its own lettering must never be composed onto.
  if (!composableGroundContracts.includes(String(groundContract || ""))) {
    fail(
      "atlas_compose_ground_contract_unsupported",
      `ground contract ${JSON.stringify(groundContract)} still authors its own lettering; `
      + `composable contracts are ${composableGroundContracts.join(", ")}`,
    );
  }

  // The plan is re-verified here, by a second code path, before a pixel moves.
  const containment = verifyPlanContainment(plan, manifest);
  if (!containment.contained) {
    fail(
      "atlas_compose_plan_not_contained",
      `the element plan escapes its surfaces: ${containment.violations.map((v) => `${v.elementId}:${v.reason}`).join(", ")}`,
    );
  }

  const meta = await sharp(groundBytes).metadata();
  const canvas = {
    x: 0, y: 0,
    w: Number(manifest?.canvas?.widthPx) || Number(meta.width),
    h: Number(manifest?.canvas?.heightPx) || Number(meta.height),
  };
  if (Number(meta.width) !== canvas.w || Number(meta.height) !== canvas.h) {
    fail(
      "atlas_compose_ground_dimensions",
      `the ground is ${meta.width}x${meta.height}; the manifest canvas is ${canvas.w}x${canvas.h}`,
    );
  }

  const layers = [];
  const composed = [];

  for (const placement of plan.placements) {
    const source = sources?.[placement.elementRef];
    if (!source) fail("atlas_compose_source_missing", `no resolved source for element ${placement.elementRef}`);
    const rect = placement.rectPx;

    if (plate && plate.kinds.includes(placement.kind)) {
      const plateRect = padRect(rect, plate.padFraction, canvas);
      layers.push({ input: plateSvg(plateRect, plate), left: plateRect.x, top: plateRect.y });
    }

    if (source.kind === "outlined-type") {
      if (!Buffer.isBuffer(fontBytes)) {
        fail("atlas_compose_font_missing", `element ${placement.elementRef} is typeset and no pinned font file was supplied`);
      }
      const string = String(source.string || "");
      if (!string) fail("atlas_compose_string_empty", `element ${placement.elementRef} has no canonical string`);
      // The planner already chose how many lines this element is set on and
      // sized the rectangle for it; rendering must use the same choice or the
      // block will not fill the box the plan proved.
      const typed = typeLayerSvg({
        fontBytes, string, rect, fill: source.fill || "#ffffff",
        lines: placement.lines || source.lines || 1,
      });
      layers.push({ input: typed.svg, left: rect.x, top: rect.y });
      composed.push({
        elementId: placement.elementId,
        elementRef: placement.elementRef,
        kind: placement.kind,
        surfaceKey: placement.surfaceKey,
        rectPx: rect,
        rectIn: placement.rectIn,
        sourceKind: "outlined-type",
        // The exact string that printed, recorded next to the rectangle it
        // printed in, so a spelling question is answerable from the receipt.
        string,
        // The exact lines that printed, so a two-line set is answerable from
        // the receipt as well as a one-line one.
        textLines: typed.textLines,
        drawnPx: { w: typed.drawnWidthPx, h: typed.drawnHeightPx },
        fontSha256: sha256(fontBytes),
      });
      continue;
    }

    if (source.kind === "image") {
      if (!Buffer.isBuffer(source.bytes)) fail("atlas_compose_source_missing", `element ${placement.elementRef} has no bytes`);
      // `contain` rather than `fill`: the plan already matched the rectangle to
      // this asset's measured aspect, so the letterbox is at most a rounding
      // pixel -- and a rounding pixel of transparency is a better outcome than
      // silently stretching a customer's logo.
      const resized = await sharp(source.bytes)
        .resize(rect.w, rect.h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      layers.push({ input: resized, left: rect.x, top: rect.y });
      composed.push({
        elementId: placement.elementId,
        elementRef: placement.elementRef,
        kind: placement.kind,
        surfaceKey: placement.surfaceKey,
        rectPx: rect,
        rectIn: placement.rectIn,
        sourceKind: "image",
        sourceContentHash: source.contentHash || sha256(source.bytes),
      });
      continue;
    }

    fail("atlas_compose_source_kind_unknown", `element ${placement.elementRef} has unsupported source kind ${source.kind}`);
  }

  const bytes = layers.length === 0
    ? groundBytes
    : await sharp(groundBytes).composite(layers).png({ compressionLevel: 9 }).toBuffer();

  const receipt = {
    contract: COMPOSE_CONTRACT,
    groundContract,
    groundHash: sha256(groundBytes),
    composedHash: sha256(bytes),
    planHash: plan.planHash || null,
    safeInsetInches: plan.safeInsetInches,
    layerCount: layers.length,
    placedCount: composed.length,
    skipped: plan.skipped || [],
    plateApplied: Boolean(plate) ? plate.kinds : [],
    elements: composed,
  };

  return { bytes, changed: layers.length > 0, receipt };
}

module.exports = {
  COMPOSE_CONTRACT,
  COMPOSABLE_GROUND_CONTRACTS,
  DEFAULT_PLATE,
  MEASURE_PPI,
  ComposeError,
  composeAtlasMaster,
  measureOutlinedString,
  measureImageAsset,
  textVariants,
  wrapStringToLines,
  MAX_TEXT_LINES,
  _test: { typeLayerSvg, plateSvg, padRect },
};
