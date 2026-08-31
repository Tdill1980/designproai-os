"use strict";

/**
 * Phase 3: the customer 2D Production Proof, derived from manufacturing truth.
 *
 * The direction is reversed here, and that reversal is the point of the whole
 * architecture. The retired path rendered a vehicle with an image model, showed
 * the customer those renders, and then tried to reconstruct production artwork
 * back out of them. So the customer approved one thing and the shop printed
 * another, and a real job proved the gap: two approved renders of one design
 * disagreed on the customer's own domain name, and every structural contract
 * still passed.
 *
 * This sheet is built from the six surfaces the deterministic renderer already
 * produced. The customer approves the artwork that will print, because it *is*
 * the artwork that will print, scaled to fit a page.
 *
 * Nothing here generates. There is no model, no prompt and no provider; the
 * only inputs are surface bytes that were composed from a frozen master, and a
 * GENIE manifest that supplies every number on the page. Dimensions are never
 * measured off pixels — pixels are a rendering of the dimensions, so reading
 * them back would be a second, weaker source of truth.
 *
 * PHASE 3 SCOPE. Nothing is wired to a stage, no schema changes, Call 8 keeps
 * production authority, and the 3D proof is not started.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { vehicleProofTemplate, vehicleProofSvg } = require("./vehicle-proof-template.cjs");
const { BLEED_INCHES, _test: proofInternals } = require("./proof-sheet.cjs");
const { BAND_LINE_GAP, BAND_MIN_FONT, bandHeight, fitBandFontSize } = require("./proof-band-fit.cjs");
// The sheet width the original composer laid out against. Every constant below
// is measured in this frame, so it is the frame, not a preference.
const PROOF_SHEET_W = 1800;
const { outlineString } = require("./opentype-outline.cjs");

const MASTER_PROOF_CONTRACT = "designpro.master-derived-2d-proof.v1";
// The customer 2D Design Proof. Its own contract, because a consumer must be
// able to tell the two sheets apart from the artifact alone -- one is signed by
// a shop against production geometry, the other is approved by a customer and
// carries none.
const DESIGN_PROOF_CONTRACT = "designpro.customer-2d-design-proof.v1";
// Versioned separately from the proof: a consumer that extracts against regions
// needs to know the region contract it is reading, and the sheet layout can
// change without the proof contract changing.
// The proof shows the design ON THE VEHICLE. These outlines are a DISPLAY MASK
// applied while composing the sheet -- the same approved surface pixels, shown
// through the shape of the vehicle. They never touch the surface itself, which
// is why Call 9 can still manufacture from full-resolution artwork: the proof
// and the panels are the same bytes rendered twice, once masked and once not.
const PROOF_VIEW_LABEL = Object.freeze({
  driver: "DRIVER SIDE", passenger: "PASSENGER SIDE",
  hood: "HOOD", roof: "ROOF", front: "FRONT", rear: "REAR",
});

const PROOF_REGION_CONTRACT = "designpro.proof-region.v1";
const SURFACE_ORDER = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const ACCENT = "#059669";

const { round2, inches } = proofInternals;

/**
 * Every label on this page is outlined from a pinned font file.
 *
 * An SVG <text> element resolves its family through fontconfig, which
 * substitutes without complaint — the same reason production typography is
 * outlined. A proof whose captions silently change face between hosts is not
 * reproducible, and the numbers beside those captions are what a customer signs.
 */
function label(fonts, string, { x, y, size, fill, anchor = "start", bold = false, rotate = 0 }) {
  const fontBytes = bold && fonts.bold ? fonts.bold : fonts.regular;
  const outlined = outlineString({ fontBytes, string: String(string), sizeIn: size, pxPerInch: 1 });
  const left = anchor === "end"
    ? x - outlined.advancePx
    : anchor === "middle" ? x - outlined.advancePx / 2 : x;
  const glyphs = `<g transform="translate(${round2(left)} ${round2(y - outlined.baselinePx)})"><path d="${outlined.path}" fill="${fill}"/></g>`;
  return rotate ? `<g transform="rotate(${rotate} ${round2(x)} ${round2(y)})">${glyphs}</g>` : glyphs;
}

/** Advance width of a string at a size, for the fitted captions below. */
function advanceOf(fonts, string, size, bold) {
  const fontBytes = bold && fonts.bold ? fonts.bold : fonts.regular;
  return outlineString({ fontBytes, string: String(string), sizeIn: size, pxPerInch: 1 }).advancePx;
}

/**
 * `fittedText` from the original composer. It shrank a caption by estimating
 * an average glyph advance; outlined text can measure the real advance, so the
 * fit is exact instead of estimated. Same clamp, same call sites.
 */
function fittedLabel(fonts, string, { x, y, maxWidth, maxSize, minSize, fill, bold = false }) {
  const value = String(string || "").trim();
  if (!value) return "";
  const at = advanceOf(fonts, value, maxSize, bold);
  const size = at <= maxWidth ? maxSize : Math.max(minSize, Math.floor(maxSize * maxWidth / at));
  return label(fonts, value, { x, y, size, fill, anchor: "middle", bold });
}

const line = (x1, y1, x2, y2, w = 2, stroke = INK) =>
  `<line x1="${round2(x1)}" y1="${round2(y1)}" x2="${round2(x2)}" y2="${round2(y2)}" stroke="${stroke}" stroke-width="${w}"/>`;
/** Dimension-rule arrowhead. Ported shape, unchanged. */
const arrow = (x, y, dx, dy) =>
  `<path d="M${round2(x)},${round2(y)} l${dx},${-5 - dy} l0,${10 + dy * 2} z" fill="${INK}"/>`;

class MasterProofError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "MasterProofError";
  }
}

function fail(code, message) {
  throw new MasterProofError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Every number the customer reads comes from the bound manifest.
 *
 * The surfaces are checked against it rather than measured: a surface whose
 * geometry disagrees with the manifest it was supposedly built from means the
 * render and the proof are describing different vehicles, and the proof must
 * not paper over that by believing the pixels.
 */
function dimensionsFromManifest(manifest, surfaces, bleedInches) {
  const expected = Array.isArray(manifest?.expectedSurfaces) ? manifest.expectedSurfaces : null;
  if (!expected) fail("proof_manifest_missing", "the 2D proof requires the bound GENIE dimension manifest");

  const byKey = new Map();
  for (const entry of expected) {
    const surfaceKey = String(entry?.surfaceKey || "").trim().toLowerCase();
    const widthInches = Number(entry?.widthInches);
    const heightInches = Number(entry?.heightInches);
    if (!SURFACE_ORDER.includes(surfaceKey) || !(widthInches > 0) || !(heightInches > 0)) continue;
    byKey.set(surfaceKey, {
      surfaceKey, widthInches, heightInches,
      printWidthInches: round2(widthInches + bleedInches * 2),
      printHeightInches: round2(heightInches + bleedInches * 2),
      surfaceSqFt: round2(widthInches * heightInches / 144),
    });
  }
  if (SURFACE_ORDER.some((key) => !byKey.has(key))) {
    fail("proof_manifest_incomplete", "the bound manifest must carry all six validated GENIE surfaces");
  }

  for (const surface of surfaces) {
    const declared = byKey.get(surface.surfaceKey);
    if (round2(surface.trimWidthIn) !== round2(declared.widthInches) || round2(surface.trimHeightIn) !== round2(declared.heightInches)) {
      fail("proof_surface_manifest_drift",
        `${surface.surfaceKey} rendered at ${surface.trimWidthIn}x${surface.trimHeightIn}in but the manifest binds ${declared.widthInches}x${declared.heightInches}in`);
    }
    if (round2(surface.bleedIn) !== round2(bleedInches)) {
      fail("proof_surface_bleed_drift", `${surface.surfaceKey} carries ${surface.bleedIn}in of bleed, not the ${bleedInches}in the proof states`);
    }
  }
  return SURFACE_ORDER.map((key) => byKey.get(key));
}

/**
 * The total the customer reads is the manifest's, checked against the geometry
 * rather than accumulated from per-surface figures that have each already been
 * rounded. Summing rounded parts drifts; rounding the sum once does not.
 */
function totalSqFtFromManifest(manifest, dimensions) {
  const computed = round2(dimensions.reduce((total, item) => total + item.widthInches * item.heightInches, 0) / 144);
  const declared = Number(manifest?.totalSqFt);
  if (!Number.isFinite(declared)) fail("proof_manifest_total_missing", "the bound manifest must declare totalSqFt");
  if (round2(declared) !== computed) {
    fail("proof_manifest_total_drift", `the manifest declares ${declared} sq ft but its six surfaces measure ${computed}`);
  }
  return round2(declared);
}

/**
 * Exactly one of each of the six surfaces, each carrying the bytes it claims.
 *
 * The proof is the document a customer signs, so it re-derives the digest from
 * the bytes it is about to draw rather than trusting the field beside them. A
 * surface whose bytes and hash disagree is not the surface that was verified
 * upstream, whatever it says about itself.
 */
function verifiedSurfaces(surfaces) {
  const byKey = new Map();
  for (const surface of surfaces) {
    const surfaceKey = String(surface?.surfaceKey || "");
    if (!SURFACE_ORDER.includes(surfaceKey)) fail("proof_surface_unknown", `${surfaceKey || "an unnamed surface"} is not a production surface`);
    if (byKey.has(surfaceKey)) fail("proof_surface_duplicated", `${surfaceKey} appears more than once in the render`);
    if (!Buffer.isBuffer(surface.bytes) || !surface.bytes.length) fail("proof_surface_missing", `the 2D proof requires the rendered ${surfaceKey} surface`);
    const observed = sha256(surface.bytes);
    if (observed !== String(surface.contentHash || "").toLowerCase()) {
      fail("proof_surface_hash_mismatch", `${surfaceKey} bytes hash to ${observed.slice(0, 16)} but the render declares ${String(surface.contentHash).slice(0, 16)}`);
    }
    byKey.set(surfaceKey, surface);
  }
  if (SURFACE_ORDER.some((key) => !byKey.has(key))) fail("proof_surface_set_incomplete", "all six production surfaces are required");
  return byKey;
}

/**
 * The canonical strings and logo identities the production surfaces actually
 * carry, gathered from the surfaces themselves rather than from the master, so
 * the proof cannot show a string the manufactured artwork does not contain.
 */
function canonicalIdentities(surfaces) {
  const text = new Map();
  const logos = new Map();
  for (const surface of surfaces) {
    for (const identity of surface.textIdentities || []) {
      const seen = text.get(identity.textId);
      if (seen && seen.string !== identity.string) {
        fail("proof_text_identity_conflict", `${identity.textId} renders as two different strings across surfaces`);
      }
      if (!seen) text.set(identity.textId, { textId: identity.textId, string: identity.string, surfaces: [] });
      text.get(identity.textId).surfaces.push(surface.surfaceKey);
    }
    for (const identity of surface.logoIdentities || []) {
      // One identity, one file. The same mark may be placed on many surfaces,
      // but a mark that is a different file on different panels is two logos
      // wearing one name, and the proof would show only one of them.
      const seen = logos.get(identity.identityKey);
      if (seen && seen.contentHash !== identity.contentHash) {
        fail("proof_logo_identity_conflict", `${identity.identityKey} is a different file on ${seen.surfaces.join(", ")} than on ${surface.surfaceKey}`);
      }
      if (!seen) logos.set(identity.identityKey, { ...identity, surfaces: [] });
      logos.get(identity.identityKey).surfaces.push(surface.surfaceKey);
    }
  }
  return {
    text: [...text.values()].sort((a, b) => (a.textId < b.textId ? -1 : 1)),
    logos: [...logos.values()].sort((a, b) => (a.identityKey < b.identityKey ? -1 : 1)),
  };
}

/**
 * THE 2D PRODUCTION PROOF — a port of restylepro-os
 * `supabase/functions/generate-2d-proof/proof-sheet.ts` `composeProofSheet`
 * (layout, L420-700), the implementation that drew the July-24 proofs.
 *
 * Ported as-is: the 1800px sheet, the driver/passenger stack beside the
 * two-column small grid, the dimension gutters, per-tile sizing from GENIE trim
 * plus real bleed (never a 16:9 presentation box), the dimension rules with
 * arrowheads, dashed TRIM against solid PRINT EDGE, the bleed caption, the
 * per-tile TRIM/BLEED/PRINT line, the coverage line, the footer approval line
 * and the GENIE size band.
 *
 * Adapted at the infrastructure seam only:
 *   - imagescript over a Deno URL, plus the Railway worker hop that composited
 *     tiles as base64, becomes an in-process `sharp` composite. The original
 *     moved pixel work off the edge function for a CPU budget this runtime does
 *     not have.
 *   - `<text font-family="DejaVu Sans">` and the CDN `getFont()` fetch become
 *     the runtime's pinned outlined-font labeller. Same strings, same
 *     positions, same sizes; a family name resolves through fontconfig and
 *     substitutes, and the numbers beside these captions are what a customer
 *     signs.
 *   - the vehicle silhouette is applied as a sharp alpha mask rather than an
 *     SVG <clipPath> reference, because the composite happens in sharp. Same
 *     path, from the same `vehicleProofTemplate`.
 *
 * NOT ported: `renderFlatTile` and `readTileText`. Those are the per-view
 * Gemini redraw the edge function needed because it started from 3D views.
 * This runtime's Call 8 already holds the approved per-surface artwork, and no
 * model may run in Calls 8-11.
 */
async function renderMasterProof({ render, manifest, proofFonts, vehicle, designName, finish, designId, orderNumber, generationId, bleedInches = BLEED_INCHES, variant = "production" }) {
  if (!render || render.contract !== "designpro.production-surface-render.v1") {
    fail("proof_render_invalid", "the 2D proof must be derived from a completed production render");
  }
  // TWO SHEETS, ONE COMPOSITION, ONE SET OF ARTWORK BYTES. (Trish 2026-08-31)
  //
  // Owner contract §5/§6: the customer 2D DESIGN Proof and the internal
  // PRODUCTION Proof are different artifacts and were being served by one.
  // "The customer 2D Proof ... must NOT expose internal production topology,
  // hashes, manufacturing metadata or production controls." This sheet exposed
  // all four -- TRIM/PRINT/BLEED rules per tile, the GENIE size band, total sq
  // ft, the approval block, and a footer naming the revision, generation and
  // master/render hashes -- and it was stamped `customer-2d-production-proof`
  // and selected as CUSTOMER_PROOF_ROLE.
  //
  // The remedy is a VARIANT of this composer, not a second producer: identical
  // surface verification, identical GENIE-proportioned tiles, identical vehicle
  // elevations, identical artwork bytes. The design variant simply does not
  // draw the production layer. So the two sheets cannot disagree about the
  // design, because there is one composition and one set of pixels.
  //
  // `production` is the default and every production-only push below is gated
  // on it, so the Production Proof stays byte-identical to what it was.
  if (variant !== "production" && variant !== "design") {
    fail("proof_variant_invalid", `${variant} is not a proof variant`);
  }
  const showProduction = variant === "production";
  const fonts = { regular: proofFonts?.regular, bold: proofFonts?.bold };
  if (!Buffer.isBuffer(fonts.regular) || !fonts.regular.length) {
    fail("proof_font_required", "the 2D proof must be typeset from a pinned font file, not a system family name");
  }

  const surfaceByKey = verifiedSurfaces(Array.isArray(render.surfaces) ? render.surfaces : []);
  const surfaces = SURFACE_ORDER.map((key) => surfaceByKey.get(key));
  const dimensions = dimensionsFromManifest(manifest, surfaces, bleedInches);
  const dimensionByKey = new Map(dimensions.map((item) => [item.surfaceKey, item]));
  const identities = canonicalIdentities(surfaces);
  const totalSqFt = totalSqFtFromManifest(manifest, dimensions);
  const vehicleName = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle";

  // ── LAYOUT (ported constants and arithmetic) ──────────────────────────────
  const W = PROOF_SHEET_W;
  const MARGIN = 40;
  const GAP = 18;
  const HEADER_H = 118;
  // The footer carries the approval block and the identity/hash lines; the
  // label block carries the per-tile TRIM/BLEED/PRINT line under the surface
  // name; the gutter exists to hold the height dimension rule. None of the
  // three has anything to hold on a design proof, so the design sheet reclaims
  // that space rather than printing empty bands.
  const FOOTER_H = showProduction ? 78 : 0;
  const LABEL_H = showProduction ? 108 : 62;
  const DIM_GUTTER = showProduction ? 74 : 0;

  const bigKeys = SURFACE_ORDER.filter((key) => key === "driver" || key === "passenger");
  const smallKeys = SURFACE_ORDER.filter((key) => key !== "driver" && key !== "passenger");
  const contentW = W - MARGIN * 2;
  const COL_GAP = GAP * 2;

  const gutters = (bigKeys.length ? DIM_GUTTER : 0) + (smallKeys.length ? DIM_GUTTER : 0);
  const drawableW = contentW - gutters;
  const bigW = bigKeys.length ? (smallKeys.length ? Math.floor((drawableW - COL_GAP) / 2) : drawableW) : 0;
  const rightW = smallKeys.length ? (bigKeys.length ? drawableW - COL_GAP - bigW : drawableW) : 0;
  const smallCols = smallKeys.length ? (bigKeys.length ? Math.min(2, smallKeys.length) : Math.min(4, smallKeys.length)) : 1;
  const smallW = smallKeys.length ? Math.floor((rightW - GAP * (smallCols - 1)) / smallCols) : 0;
  const smallRows = smallKeys.length ? Math.ceil(smallKeys.length / smallCols) : 0;

  // Every region is sized from GENIE trim + the real bleed, so the compositor
  // never stretches a side, face, hood or roof to fit a presentation box.
  const tileHeight = (surfaceKey, widthPx) => {
    const dimension = dimensionByKey.get(surfaceKey);
    const trimW = Number(dimension.widthInches);
    const trimH = Number(dimension.heightInches);
    if (!(trimW > 0 && trimH > 0)) fail("proof_tile_dimensions_missing", `${surfaceKey} has no GENIE trim dimensions`);
    return Math.max(1, Math.round(widthPx * (trimH + bleedInches * 2) / (trimW + bleedInches * 2)));
  };
  const bigHeights = bigKeys.map((key) => tileHeight(key, bigW));
  const smallHeights = smallKeys.map((key) => tileHeight(key, smallW));
  const smallRowHeights = Array.from({ length: smallRows }, (_, row) => {
    const begin = row * smallCols;
    return Math.max(...smallHeights.slice(begin, begin + smallCols), 0);
  });

  const coverageLine = `TOTAL COVERAGE: ${totalSqFt.toFixed(2)} SQ FT`;
  const COVERAGE_H = showProduction ? 52 : 0;
  // The GENIE size band, the two lines the July proof carried under the sheet.
  // It is production geometry by definition, so the design sheet has none.
  const bandLines = (showProduction ? [
    `TRIM SIZE   ${dimensions.map((d) => `${d.surfaceKey.toUpperCase()} ${inches(d.widthInches)}" x ${inches(d.heightInches)}"`).join("   |   ")}`,
    `PRINT SIZE (+${inches(bleedInches)}" BLEED ALL AROUND)   ${dimensions.map((d) => `${d.surfaceKey.toUpperCase()} ${inches(d.printWidthInches)}" x ${inches(d.printHeightInches)}"`).join("   |   ")}`,
  ] : []).filter((entry) => String(entry || "").trim());
  const bandFontSize = fitBandFontSize(bandLines, W - MARGIN * 2);
  const BAND_H = bandHeight(bandLines, bandFontSize);

  const bodyH = Math.max(
    bigHeights.reduce((sum, height) => sum + height + LABEL_H + GAP, 0),
    smallRowHeights.reduce((sum, height) => sum + height + LABEL_H + GAP, 0),
  );
  const H = HEADER_H + bodyH + COVERAGE_H + FOOTER_H + MARGIN + BAND_H;

  const markup = [];
  const composites = [];
  const proofRegions = [];

  // Header.
  markup.push(label(fonts, showProduction ? "DesignProAI™ — 2D Production Proof" : "DesignProAI™ — 2D Design Proof", { x: MARGIN, y: 26 + 34, size: 34, fill: INK, bold: true }));
  // Coverage in square feet is production geometry, so the design sheet names
  // the vehicle, the design and the finish and stops there.
  markup.push(label(fonts, showProduction
    ? `${vehicleName}  ·  ${designName || "Approved design"}  ·  ${finish || "Gloss"} finish  ·  ${totalSqFt.toFixed(2)} sq ft`
    : `${vehicleName}  ·  ${designName || "Approved design"}  ·  ${finish || "Gloss"} finish`,
    { x: MARGIN, y: 80 + 17, size: 17, fill: MUTED }));
  markup.push(line(MARGIN, HEADER_H, W - MARGIN, HEADER_H));

  const bodyTop = HEADER_H + GAP;

  /** One tile: the masked artwork, its elevation strokes, its dimension rules. */
  const place = async (surfaceKey, x, y, w, h) => {
    const surface = surfaceByKey.get(surfaceKey);
    const dimension = dimensionByKey.get(surfaceKey);

    // Placed from the surface's own declared pixel geometry, not by reading the
    // raster back. The renderer already stated what it produced.
    const resized = await sharp(surface.bytes, { limitInputPixels: false })
      .resize(w, h, { fit: "fill", kernel: "lanczos3" })
      .png(PNG_OPTIONS).toBuffer();

    // The vehicle elevation. Drawn twice from one template: tile-local for the
    // clip mask, sheet-space for the outline and detail strokes that ride over
    // the artwork so the wrap reads as applied to a vehicle rather than as a
    // sticker in a vehicle-shaped hole.
    const template = vehicleProofTemplate(vehicle?.type ?? vehicle?.vehicleType, PROOF_VIEW_LABEL[surfaceKey]);
    const local = vehicleProofSvg(template, `clip-${surfaceKey}`, 0, 0, w, h);
    let placed = resized;
    if (!local.rectangular) {
      placed = await sharp(resized, { limitInputPixels: false })
        .ensureAlpha()
        .composite([{
          input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${local.silhouette}" fill="#ffffff"/></svg>`),
          blend: "dest-in",
        }])
        .png(PNG_OPTIONS).toBuffer();
      const onSheet = vehicleProofSvg(template, `sheet-${surfaceKey}`, x, y, w, h);
      markup.push(...onSheet.overlay);
    }
    composites.push({ input: placed, left: x, top: y });

    const wIn = Number(dimension.widthInches);
    const hIn = Number(dimension.heightInches);
    const bleedX = w * bleedInches / (wIn + bleedInches * 2);
    const bleedY = h * bleedInches / (hIn + bleedInches * 2);
    const trimLeft = x + bleedX;
    const trimRight = x + w - bleedX;
    const trimTop = y + bleedY;
    const trimBottom = y + h - bleedY;

    // ── THE PRODUCTION LAYER ────────────────────────────────────────────────
    // Everything from here to the surface name is production topology: the
    // trim/print boundary, the bleed, and the dimension rules that measure
    // them. Owner contract §5 forbids all of it on the customer sheet, so the
    // design variant draws the artwork on the vehicle and nothing else.
    if (showProduction) {
      // Solid outer rectangle = full print edge. Dashed inner rectangle = trim.
      // Their proportional separation is exactly the bleed on all four edges,
      // because the tile itself is sized from trim + twice the bleed.
      markup.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="2"/>`);
      markup.push(`<rect x="${round2(trimLeft)}" y="${round2(trimTop)}" width="${round2(trimRight - trimLeft)}" height="${round2(trimBottom - trimTop)}" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="10 7"/>`);
      markup.push(fittedLabel(fonts, `DASHED = TRIM  ·  SOLID = PRINT EDGE  ·  ${inches(bleedInches)}" BLEED EACH EDGE`, {
        x: x + w / 2, y: y + Math.max(16, bleedY - 6), maxWidth: w - 8, maxSize: 13, minSize: 8, fill: INK, bold: true,
      }));

      // Width rule. It names TRIM width, so its endpoints are the dashed trim
      // line, not the outer print rectangle that includes the bleed.
      const ruleY = y + h + 20;
      markup.push(line(trimLeft, ruleY, trimRight, ruleY));
      markup.push(arrow(trimLeft, ruleY, 9, 0));
      markup.push(arrow(trimRight, ruleY, -9, 0));
      markup.push(line(trimLeft, ruleY - 7, trimLeft, ruleY + 7));
      markup.push(line(trimRight, ruleY - 7, trimRight, ruleY + 7));
      markup.push(label(fonts, `${inches(wIn)}" W`, { x: x + w / 2, y: ruleY + 26, size: 16, fill: INK, anchor: "middle" }));

      // Height rule, same truth: the figure spans only the trim boundary.
      const ruleX = x - Math.round(DIM_GUTTER / 2);
      markup.push(line(ruleX, trimTop, ruleX, trimBottom));
      markup.push(line(ruleX - 7, trimTop, ruleX + 7, trimTop));
      markup.push(line(ruleX - 7, trimBottom, ruleX + 7, trimBottom));
      const cy = (trimTop + trimBottom) / 2;
      const verticalAxis = surfaceKey === "hood" || surfaceKey === "roof" ? "L" : "H";
      markup.push(label(fonts, `${inches(hIn)}" ${verticalAxis}`, { x: ruleX - 10, y: cy, size: 16, fill: INK, anchor: "middle", rotate: -90 }));
    }

    // The surface NAME is on both sheets: a customer approving a wrap has to
    // know which side they are looking at. Its measurements do not follow it.
    const labelY = y + h + (showProduction ? 46 : 8);
    markup.push(label(fonts, PROOF_VIEW_LABEL[surfaceKey], { x: x + w / 2, y: labelY + 17, size: 17, fill: INK, anchor: "middle", bold: true }));
    if (showProduction) {
      markup.push(fittedLabel(fonts, `TRIM ${inches(wIn)}" x ${inches(hIn)}"  ·  BLEED ${inches(bleedInches)}" EACH EDGE  ·  PRINT ${inches(dimension.printWidthInches)}" x ${inches(dimension.printHeightInches)}"`, {
        x: x + w / 2, y: labelY + 42, maxWidth: w - 8, maxSize: 14, minSize: 9, fill: MUTED,
      }));
    }

    // THE PER-SIDE ANCHOR. One named region per surface, in sheet pixel space,
    // bound to the content hash of the surface drawn into it. This is the
    // `rects` the original returned and `proofTileBoxes` normalized -- computed
    // on every run and dropped by the return, which is what left extraction
    // with no per-side anchor to bind against.
    proofRegions.push({
      surfaceKey,
      x, y, w, h,
      sheetWidth: W, sheetHeight: H,
      surfaceContentHash: surface.contentHash,
      surfacePixelWidth: surface.pixelWidth,
      surfacePixelHeight: surface.pixelHeight,
      // The region is a REDUCTION of the surface, never the other way round.
      // Anything reading pixels back out of it recovers less than the surface
      // already holds, so the region is the anchor and the surface is the
      // artwork.
      scale: round2(w / surface.pixelWidth),
      // Presentation only, recorded so a reader can tell the proof's masked
      // appearance from the unmasked surface Call 9 manufactures.
      displayMask: { view: PROOF_VIEW_LABEL[surfaceKey], bodyFamily: template.bodyFamily || null, rectangular: local.rectangular, mirrored: template.mirrored },
    });
  };

  let leftY = bodyTop;
  for (let index = 0; index < bigKeys.length; index++) {
    await place(bigKeys[index], MARGIN + DIM_GUTTER, leftY, bigW, bigHeights[index]);
    leftY += bigHeights[index] + LABEL_H + GAP;
  }
  if (smallKeys.length) {
    const rightX = (bigKeys.length ? MARGIN + DIM_GUTTER + bigW + COL_GAP : MARGIN) + DIM_GUTTER;
    for (let index = 0; index < smallKeys.length; index++) {
      const col = index % smallCols;
      const row = Math.floor(index / smallCols);
      await place(
        smallKeys[index],
        rightX + col * (smallW + GAP),
        bodyTop + smallRowHeights.slice(0, row).reduce((sum, height) => sum + height + LABEL_H + GAP, 0),
        smallW,
        smallHeights[index],
      );
    }
  }

  // THE FOOTER IS ENTIRELY PRODUCTION. Coverage in square feet, the approval
  // signature block, the DesignID/Order/revision/generation line and the
  // master/render/GENIE hash line are the four things owner contract §5 names
  // by category -- topology, manufacturing metadata, hashes, production
  // controls. The design sheet ends at the artwork.
  if (showProduction) {
    markup.push(label(fonts, coverageLine, { x: W / 2, y: bodyTop + bodyH + 8 + 22, size: 22, fill: ACCENT, anchor: "middle", bold: true }));
    const footerY = bodyTop + bodyH + COVERAGE_H;
    markup.push(line(MARGIN, footerY, W - MARGIN, footerY));
    markup.push(label(fonts, `Approved By: ______________________    Signature: ______________________    Date: ____________`, { x: MARGIN, y: footerY + 20 + 17, size: 17, fill: INK }));
    // THE GENERATION ID BELONGS ON THE SHEET. (Trish 2026-08-28)
    //
    // "Production proof ie a screenshot of the panels on a sheet with vehicle
    // make model, design order #, generation id, dimensions." Every other item
    // was already stamped -- the vehicle line above, the per-surface W/H rules
    // beside each panel, the Design ID and Order # here. The generation id was
    // the one identity a shop could not read off the page, and it is the id that
    // every other table carries forward and the one PanelPro is opened on.
    //
    // It is the FIRST permanent identity a design has: minted at Create Design,
    // before Call 1 runs, while the Design ID and Order # are assigned later when
    // the Production Pack is purchased. So a proof printed before that purchase
    // could name neither -- and now always names one.
    markup.push(label(fonts, `${designId || "DesignID pending"}  ·  Order # ${orderNumber || "pending"}  ·  revision ${render.revisionId}  ·  generation ${generationId || "pending"}`, { x: MARGIN, y: footerY + 46 + 17, size: 15, fill: MUTED }));
    markup.push(label(fonts, `master ${String(render.masterHash).slice(0, 16)}  ·  render ${String(render.renderHash).slice(0, 16)}  ·  GENIE ${String(render.dimensionManifestId)}  ·  no image generation`, { x: W - MARGIN, y: footerY + 46 + 17, size: 15, fill: MUTED, anchor: "end" }));
  }

  if (BAND_H) {
    const bandTop = H - BAND_H;
    markup.push(line(0, bandTop + 1, W, bandTop + 1));
    const step = Math.round(bandFontSize * BAND_LINE_GAP);
    const firstBaseline = bandTop + Math.round(bandFontSize * 1.35);
    for (let index = 0; index < bandLines.length; index++) {
      markup.push(fittedLabel(fonts, bandLines[index], {
        x: W / 2, y: firstBaseline + index * step, maxWidth: W - MARGIN * 2, maxSize: bandFontSize, minSize: BAND_MIN_FONT, fill: INK, bold: true,
      }));
    }
  }

  // Ported from restylepro-os worker/designpro-proof-extract-v3.cjs
  // canonicalTileBoxes: exactly one region per expected side, and no two sides
  // pointing at the same rectangle. Two sides sharing a rect is how every panel
  // ends up carrying the driver's artwork -- the extractor is handed one
  // location under six names and cannot tell.
  if (proofRegions.length !== SURFACE_ORDER.length
    || new Set(proofRegions.map((region) => region.surfaceKey)).size !== SURFACE_ORDER.length) {
    fail("proof_required_surface_missing", "the proof must state one region for each of the six production surfaces");
  }
  if (new Set(proofRegions.map((region) => `${region.x}:${region.y}:${region.w}:${region.h}`)).size !== SURFACE_ORDER.length) {
    fail("proof_region_duplicate", "two production surfaces point at the same region of the proof");
  }

  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${markup.join("")}</svg>`);
  const bytes = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite([...composites, { input: overlay, left: 0, top: 0 }])
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();

  return Object.freeze({
    // Field names the claimant already records for the customer proof, so the
    // approval and UI integration ahead needs no rewrite.
    contract: showProduction ? MASTER_PROOF_CONTRACT : DESIGN_PROOF_CONTRACT,
    variant,
    bytes,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    width: W,
    height: H,
    totalSqFt,
    bleedInches,
    dimensionsAuthority: "genie-universal-panelizer",
    // Provenance that makes the reversal checkable: this proof came from these
    // exact surfaces, which came from this exact master.
    masterHash: render.masterHash,
    renderHash: render.renderHash,
    revisionId: render.revisionId,
    dimensionManifestId: render.dimensionManifestId,
    manifestHash: render.manifestHash,
    surfaceHashes: SURFACE_ORDER.map((key) => ({ surfaceKey: key, contentHash: surfaceByKey.get(key).contentHash })),
    // The per-side anchor on the approved sheet: one region per surface, in
    // sheet pixel space, each bound to the surface hash drawn into it.
    // ⛔ THE DESIGN PROOF PUBLISHES NO REGIONS. Owner contract §5: "It is NOT a
    // source of production artwork." A region set is exactly what an extractor
    // binds against, so handing one out is how a presentation sheet becomes a
    // production source. The production proof keeps its six anchors.
    proofRegionContract: showProduction ? PROOF_REGION_CONTRACT : null,
    proofRegions: showProduction ? proofRegions : Object.freeze([]),
    textIdentities: identities.text.map(({ textId, string }) => ({ textId, string })),
    logoIdentities: identities.logos.map(({ identityKey, contentHash }) => ({ identityKey, contentHash })),
    perSurfaceDimensions: dimensions,
    generated: false,
  });
}

module.exports = {
  MASTER_PROOF_CONTRACT,
  DESIGN_PROOF_CONTRACT,
  PROOF_REGION_CONTRACT,
  SURFACE_ORDER,
  MasterProofError,
  renderMasterProof,
  // Shared with the 3D proof deliberately. Both proofs re-derive surface
  // digests the same way and typeset from pinned bytes the same way; two
  // implementations of a fail-closed check are one implementation and one
  // liability, because only the one under test stays correct.
  verifiedSurfaces,
  canonicalIdentities,
  outlinedLabel: label,
  _test: { dimensionsFromManifest, canonicalIdentities, verifiedSurfaces, totalSqFtFromManifest, label },
};
