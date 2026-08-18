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
const {
  BLEED_INCHES, SHEET_WIDTH, SHEET_HEIGHT, proofSheetLayout,
  _test: proofInternals,
} = require("./proof-sheet.cjs");
const { outlineString } = require("./opentype-outline.cjs");

const MASTER_PROOF_CONTRACT = "designpro.master-derived-2d-proof.v1";
// Versioned separately from the proof: a consumer that extracts against regions
// needs to know the region contract it is reading, and the sheet layout can
// change without the proof contract changing.
const PROOF_REGION_CONTRACT = "designpro.proof-region.v1";
const SURFACE_ORDER = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const ACCENT = "#059669";

const { containedPlacement, round2, inches } = proofInternals;

/**
 * Every label on this page is outlined from a pinned font file.
 *
 * An SVG <text> element resolves its family through fontconfig, which
 * substitutes without complaint — the same reason production typography is
 * outlined. A proof whose captions silently change face between hosts is not
 * reproducible, and the numbers beside those captions are what a customer signs.
 */
function label(fonts, string, { x, y, size, fill, anchor = "start", bold = false }) {
  const fontBytes = bold && fonts.bold ? fonts.bold : fonts.regular;
  const outlined = outlineString({ fontBytes, string: String(string), sizeIn: size, pxPerInch: 1 });
  const left = anchor === "end" ? x - outlined.advancePx : x;
  return `<g transform="translate(${round2(left)} ${round2(y - outlined.baselinePx)})"><path d="${outlined.path}" fill="${fill}"/></g>`;
}

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

function headerMarkup(fonts, { vehicleName, designName, finish, totalSqFt }) {
  return `<g>
    ${label(fonts, "DesignProAI 2D Production Proof", { x: 96, y: 150, size: 58, fill: INK, bold: true })}
    ${label(fonts, `${vehicleName} \u00b7 ${designName} \u00b7 ${finish} finish`, { x: 96, y: 205, size: 27, fill: MUTED })}
    ${label(fonts, `${inches(totalSqFt)} SQ FT`, { x: SHEET_WIDTH - 96, y: 150, size: 42, fill: ACCENT, anchor: "end", bold: true })}
    ${label(fonts, "rendered from the canonical Design Master", { x: SHEET_WIDTH - 96, y: 196, size: 23, fill: MUTED, anchor: "end" })}
    <line x1="96" y1="238" x2="${SHEET_WIDTH - 96}" y2="238" stroke="${RULE}" stroke-width="3"/>
  </g>`;
}

function cellMarkup(fonts, cell, dimension, placement) {
  const captionY = cell.frame.y + cell.frame.h - 74;
  return `<g>
    <rect x="${cell.frame.x + 8}" y="${cell.frame.y + 8}" width="${cell.frame.w - 16}" height="${cell.frame.h - 16}" fill="none" stroke="${RULE}" stroke-width="2"/>
    <rect x="${placement.x}" y="${placement.y}" width="${placement.w}" height="${placement.h}" fill="none" stroke="${RULE}" stroke-width="2"/>
    ${label(fonts, cell.label, { x: cell.frame.x + 26, y: captionY, size: 26, fill: INK, bold: true })}
    ${label(fonts, `TRIM ${inches(dimension.widthInches)}" \u00d7 ${inches(dimension.heightInches)}" \u00b7 PRINT ${inches(dimension.printWidthInches)}" \u00d7 ${inches(dimension.printHeightInches)}" at ${inches(BLEED_INCHES)}" bleed`, { x: cell.frame.x + 26, y: captionY + 34, size: 22, fill: MUTED })}
    ${label(fonts, `${inches(dimension.surfaceSqFt)} sq ft`, { x: cell.frame.x + cell.frame.w - 26, y: captionY, size: 26, fill: ACCENT, anchor: "end", bold: true })}
  </g>`;
}

/** The cell the retired sheet gave to the 3D hero now carries identity. */
function identityMarkup(fonts, cell, identities, render) {
  const lines = [];
  let y = cell.frame.y + 62;
  lines.push(label(fonts, "CANONICAL IDENTITIES", { x: cell.frame.x + 26, y, size: 26, fill: INK, bold: true }));
  y += 44;
  for (const item of identities.text) {
    lines.push(label(fonts, `\u201c${item.string}\u201d`, { x: cell.frame.x + 26, y, size: 22, fill: INK }));
    y += 30;
  }
  for (const item of identities.logos) {
    lines.push(label(fonts, `${item.identityKey} \u00b7 ${item.contentHash.slice(0, 16)}`, { x: cell.frame.x + 26, y, size: 22, fill: INK }));
    y += 30;
  }
  y += 14;
  lines.push(label(fonts, `master ${render.masterHash.slice(0, 24)}`, { x: cell.frame.x + 26, y, size: 19, fill: MUTED }));
  lines.push(label(fonts, `render ${render.renderHash.slice(0, 24)}`, { x: cell.frame.x + 26, y: y + 28, size: 19, fill: MUTED }));
  lines.push(label(fonts, `${render.pxPerInch} px/in \u00b7 no image generation`, { x: cell.frame.x + 26, y: y + 56, size: 19, fill: MUTED }));
  return `<g>
    <rect x="${cell.frame.x + 8}" y="${cell.frame.y + 8}" width="${cell.frame.w - 16}" height="${cell.frame.h - 16}" fill="none" stroke="${RULE}" stroke-width="2"/>
    ${lines.join("")}
  </g>`;
}

function footerMarkup(fonts, dimensions, totalSqFt, { designId, orderNumber, render }) {
  const top = SHEET_HEIGHT - 486;
  const columns = dimensions.map((dimension, index) => {
    const x = 96 + index * Math.floor((SHEET_WIDTH - 192) / 6);
    return label(fonts, dimension.surfaceKey.toUpperCase(), { x, y: top + 96, size: 21, fill: INK, bold: true })
      + label(fonts, `${inches(dimension.surfaceSqFt)} sq ft`, { x, y: top + 126, size: 19, fill: MUTED })
      + label(fonts, `${inches(dimension.printWidthInches)}" \u00d7 ${inches(dimension.printHeightInches)}"`, { x, y: top + 152, size: 19, fill: MUTED });
  }).join("");
  return `<g>
    <line x1="96" y1="${top + 40}" x2="${SHEET_WIDTH - 96}" y2="${top + 40}" stroke="${RULE}" stroke-width="3"/>
    ${label(fonts, `PRODUCTION COVERAGE \u00b7 ${inches(totalSqFt)} SQ FT TOTAL`, { x: 96, y: top + 32, size: 24, fill: INK, bold: true })}
    ${columns}
    ${label(fonts, `DesignID ${designId} \u00b7 Order ${orderNumber} \u00b7 revision ${render.revisionId}`, { x: 96, y: top + 240, size: 21, fill: MUTED })}
    ${label(fonts, `Dimensions from the bound GENIE manifest ${String(render.dimensionManifestId)}. Artwork is the manufactured surface, not a visualisation of it.`, { x: 96, y: top + 274, size: 21, fill: MUTED })}
    <line x1="96" y1="${top + 356}" x2="1500" y2="${top + 356}" stroke="${INK}" stroke-width="2"/>
    ${label(fonts, "Customer approval", { x: 96, y: top + 392, size: 21, fill: MUTED })}
    <line x1="1700" y1="${top + 356}" x2="${SHEET_WIDTH - 96}" y2="${top + 356}" stroke="${INK}" stroke-width="2"/>
    ${label(fonts, "Date", { x: 1700, y: top + 392, size: 21, fill: MUTED })}
  </g>`;
}

/**
 * Build the customer proof from a completed production render.
 */
async function renderMasterProof({ render, manifest, proofFonts, vehicle, designName, finish, designId, orderNumber, bleedInches = BLEED_INCHES }) {
  if (!render || render.contract !== "designpro.production-surface-render.v1") {
    fail("proof_render_invalid", "the 2D proof must be derived from a completed production render");
  }
  // The proof page is typeset from a pinned file for the same reason production
  // artwork is: a family name resolves through fontconfig and substitutes.
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

  const layout = proofSheetLayout();
  const vehicleName = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle";
  const composites = [];
  const markup = [headerMarkup(fonts, {
    vehicleName,
    designName: designName || "Approved design",
    finish: finish || "standard",
    totalSqFt,
  })];

  // EVERY SIDE GETS AN EXPLICIT REGION IN THE APPROVED PROOF.
  //
  // The rect each surface occupies was always computed here and then thrown
  // away: `placement` went into the SVG and never into the return value, so the
  // proof shipped with surfaceHashes and perSurfaceDimensions but no statement
  // of WHERE each side sits on the sheet. Downstream had no per-side anchor to
  // extract against, which is the side-binding defect -- the same shape as the
  // proofTileRects that were computed on every RestylePro proof run and dropped
  // by the return, leaving extraction to locate each side by other means.
  //
  // Recording it makes the region a first-class part of the approved artifact:
  // one named region per side, in sheet pixel space, bound to the exact surface
  // content hash that was placed there. A panel can then be tied to its own
  // region of the proof the customer signed rather than to a side label.
  const proofRegions = [];

  for (const surfaceKey of SURFACE_ORDER) {
    const cell = layout.cells[surfaceKey];
    const surface = surfaceByKey.get(surfaceKey);
    // Placed from the surface's own declared pixel geometry, not by reading the
    // raster back. The renderer already stated what it produced.
    const placement = containedPlacement(cell.image, surface.pixelWidth, surface.pixelHeight);
    const resized = await sharp(surface.bytes, { limitInputPixels: false })
      .resize(placement.w, placement.h, { fit: "fill", kernel: "lanczos3" })
      .png(PNG_OPTIONS).toBuffer();
    composites.push({ input: resized, left: placement.x, top: placement.y });
    markup.push(cellMarkup(fonts, cell, dimensionByKey.get(surfaceKey), placement));
    proofRegions.push({
      surfaceKey,
      // Sheet pixel space, top-left origin -- the coordinates the region
      // occupies on the proof raster this call is producing.
      x: placement.x, y: placement.y, w: placement.w, h: placement.h,
      // Stated so a consumer never has to assume the sheet size it was measured
      // against; a region without its frame is not a location.
      sheetWidth: SHEET_WIDTH, sheetHeight: SHEET_HEIGHT,
      // What was actually drawn into this region. This is the binding that
      // makes the region checkable rather than declarative: the bytes at this
      // rect are a lanczos3 reduction of exactly this surface.
      surfaceContentHash: surface.contentHash,
      surfacePixelWidth: surface.pixelWidth,
      surfacePixelHeight: surface.pixelHeight,
      // The region is a REDUCTION of the surface, never the other way round.
      // Anything reading pixels back out of it recovers less than the surface
      // already holds, so the region is the anchor and the surface is the
      // artwork.
      scale: round2(placement.w / surface.pixelWidth),
    });
  }

  markup.push(identityMarkup(fonts, layout.cells.hero3d, identities, render));
  markup.push(footerMarkup(fonts, dimensions, totalSqFt, {
    designId: designId || "DesignID pending",
    orderNumber: orderNumber || "pending",
    render,
  }));

  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}">${markup.join("")}</svg>`);
  const bytes = await sharp({ create: { width: SHEET_WIDTH, height: SHEET_HEIGHT, channels: 3, background: "#ffffff" } })
    .composite([...composites, { input: overlay, left: 0, top: 0 }])
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();

  return Object.freeze({
    // Field names the claimant already records for the customer proof, so the
    // approval and UI integration ahead needs no rewrite.
    contract: MASTER_PROOF_CONTRACT,
    bytes,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
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
    proofRegionContract: PROOF_REGION_CONTRACT,
    proofRegions,
    textIdentities: identities.text.map(({ textId, string }) => ({ textId, string })),
    logoIdentities: identities.logos.map(({ identityKey, contentHash }) => ({ identityKey, contentHash })),
    perSurfaceDimensions: dimensions,
    generated: false,
  });
}

module.exports = {
  MASTER_PROOF_CONTRACT,
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
