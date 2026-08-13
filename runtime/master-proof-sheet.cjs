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

const MASTER_PROOF_CONTRACT = "designpro.master-derived-2d-proof.v1";
const SURFACE_ORDER = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const ACCENT = "#059669";

const { containedPlacement, escapeXml, round2, inches } = proofInternals;

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
      const key = `${identity.identityKey}:${identity.contentHash}`;
      if (!logos.has(key)) logos.set(key, { ...identity, surfaces: [] });
      logos.get(key).surfaces.push(surface.surfaceKey);
    }
  }
  return {
    text: [...text.values()].sort((a, b) => (a.textId < b.textId ? -1 : 1)),
    logos: [...logos.values()].sort((a, b) => (a.identityKey < b.identityKey ? -1 : 1)),
  };
}

function headerMarkup({ vehicleName, designName, finish, totalSqFt }) {
  return `<g font-family="Helvetica, Arial, sans-serif">
    <text x="96" y="150" font-size="58" font-weight="700" fill="${INK}">DesignProAI 2D Production Proof</text>
    <text x="96" y="205" font-size="27" fill="${MUTED}">${escapeXml(vehicleName)} &#183; ${escapeXml(designName)} &#183; ${escapeXml(finish)} finish</text>
    <text x="${SHEET_WIDTH - 96}" y="150" font-size="42" font-weight="700" fill="${ACCENT}" text-anchor="end">${inches(totalSqFt)} SQ FT</text>
    <text x="${SHEET_WIDTH - 96}" y="196" font-size="23" fill="${MUTED}" text-anchor="end">rendered from the canonical Design Master</text>
    <line x1="96" y1="238" x2="${SHEET_WIDTH - 96}" y2="238" stroke="${RULE}" stroke-width="3"/>
  </g>`;
}

function cellMarkup(cell, dimension, placement) {
  const captionY = cell.frame.y + cell.frame.h - 74;
  return `<g font-family="Helvetica, Arial, sans-serif">
    <rect x="${cell.frame.x + 8}" y="${cell.frame.y + 8}" width="${cell.frame.w - 16}" height="${cell.frame.h - 16}" fill="none" stroke="${RULE}" stroke-width="2"/>
    <rect x="${placement.x}" y="${placement.y}" width="${placement.w}" height="${placement.h}" fill="none" stroke="${RULE}" stroke-width="2"/>
    <text x="${cell.frame.x + 26}" y="${captionY}" font-size="26" font-weight="700" fill="${INK}">${escapeXml(cell.label)}</text>
    <text x="${cell.frame.x + 26}" y="${captionY + 34}" font-size="22" fill="${MUTED}">TRIM ${inches(dimension.widthInches)}&#8243; &#215; ${inches(dimension.heightInches)}&#8243; &#183; PRINT ${inches(dimension.printWidthInches)}&#8243; &#215; ${inches(dimension.printHeightInches)}&#8243; at ${inches(BLEED_INCHES)}&#8243; bleed</text>
    <text x="${cell.frame.x + cell.frame.w - 26}" y="${captionY}" font-size="26" font-weight="700" fill="${ACCENT}" text-anchor="end">${inches(dimension.surfaceSqFt)} sq ft</text>
  </g>`;
}

/** The cell the retired sheet gave to the 3D hero now carries identity. */
function identityMarkup(cell, identities, render) {
  const lines = [];
  let y = cell.frame.y + 62;
  lines.push(`<text x="${cell.frame.x + 26}" y="${y}" font-size="26" font-weight="700" fill="${INK}">CANONICAL IDENTITIES</text>`);
  y += 44;
  for (const item of identities.text) {
    lines.push(`<text x="${cell.frame.x + 26}" y="${y}" font-size="22" fill="${INK}">&#8220;${escapeXml(item.string)}&#8221;</text>`);
    y += 30;
  }
  for (const item of identities.logos) {
    lines.push(`<text x="${cell.frame.x + 26}" y="${y}" font-size="22" fill="${INK}">${escapeXml(item.identityKey)} &#183; ${escapeXml(item.contentHash.slice(0, 16))}</text>`);
    y += 30;
  }
  y += 14;
  lines.push(`<text x="${cell.frame.x + 26}" y="${y}" font-size="19" fill="${MUTED}">master ${escapeXml(render.masterHash.slice(0, 24))}</text>`);
  lines.push(`<text x="${cell.frame.x + 26}" y="${y + 28}" font-size="19" fill="${MUTED}">render ${escapeXml(render.renderHash.slice(0, 24))}</text>`);
  lines.push(`<text x="${cell.frame.x + 26}" y="${y + 56}" font-size="19" fill="${MUTED}">${render.pxPerInch} px/in &#183; no image generation</text>`);
  return `<g font-family="Helvetica, Arial, sans-serif">
    <rect x="${cell.frame.x + 8}" y="${cell.frame.y + 8}" width="${cell.frame.w - 16}" height="${cell.frame.h - 16}" fill="none" stroke="${RULE}" stroke-width="2"/>
    ${lines.join("")}
  </g>`;
}

function footerMarkup(dimensions, totalSqFt, { designId, orderNumber, render }) {
  const top = SHEET_HEIGHT - 486;
  const columns = dimensions.map((dimension, index) => {
    const x = 96 + index * Math.floor((SHEET_WIDTH - 192) / 6);
    return `<text x="${x}" y="${top + 96}" font-size="21" font-weight="700" fill="${INK}">${escapeXml(dimension.surfaceKey.toUpperCase())}</text>
      <text x="${x}" y="${top + 126}" font-size="19" fill="${MUTED}">${inches(dimension.surfaceSqFt)} sq ft</text>
      <text x="${x}" y="${top + 152}" font-size="19" fill="${MUTED}">${inches(dimension.printWidthInches)}&#8243; &#215; ${inches(dimension.printHeightInches)}&#8243;</text>`;
  }).join("");
  return `<g font-family="Helvetica, Arial, sans-serif">
    <line x1="96" y1="${top + 40}" x2="${SHEET_WIDTH - 96}" y2="${top + 40}" stroke="${RULE}" stroke-width="3"/>
    <text x="96" y="${top + 32}" font-size="24" font-weight="700" fill="${INK}">PRODUCTION COVERAGE &#183; ${inches(totalSqFt)} SQ FT TOTAL</text>
    ${columns}
    <text x="96" y="${top + 240}" font-size="21" fill="${MUTED}">DesignID ${escapeXml(designId)} &#183; Order ${escapeXml(orderNumber)} &#183; revision ${escapeXml(render.revisionId)}</text>
    <text x="96" y="${top + 274}" font-size="21" fill="${MUTED}">Dimensions from the bound GENIE manifest ${escapeXml(String(render.dimensionManifestId))}. Artwork is the manufactured surface, not a visualisation of it.</text>
    <line x1="96" y1="${top + 356}" x2="1500" y2="${top + 356}" stroke="${INK}" stroke-width="2"/>
    <text x="96" y="${top + 392}" font-size="21" fill="${MUTED}">Customer approval</text>
    <line x1="1700" y1="${top + 356}" x2="${SHEET_WIDTH - 96}" y2="${top + 356}" stroke="${INK}" stroke-width="2"/>
    <text x="1700" y="${top + 392}" font-size="21" fill="${MUTED}">Date</text>
  </g>`;
}

/**
 * Build the customer proof from a completed production render.
 */
async function renderMasterProof({ render, manifest, vehicle, designName, finish, designId, orderNumber, bleedInches = BLEED_INCHES }) {
  if (!render || render.contract !== "designpro.production-surface-render.v1") {
    fail("proof_render_invalid", "the 2D proof must be derived from a completed production render");
  }
  const surfaces = Array.isArray(render.surfaces) ? render.surfaces : [];
  if (surfaces.length !== SURFACE_ORDER.length) fail("proof_surface_set_incomplete", "all six production surfaces are required");

  const dimensions = dimensionsFromManifest(manifest, surfaces, bleedInches);
  const dimensionByKey = new Map(dimensions.map((item) => [item.surfaceKey, item]));
  const surfaceByKey = new Map(surfaces.map((item) => [item.surfaceKey, item]));
  const identities = canonicalIdentities(surfaces);
  const totalSqFt = round2(dimensions.reduce((total, item) => total + item.surfaceSqFt, 0));

  const layout = proofSheetLayout();
  const vehicleName = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle";
  const composites = [];
  const markup = [headerMarkup({
    vehicleName,
    designName: designName || "Approved design",
    finish: finish || "standard",
    totalSqFt,
  })];

  for (const surfaceKey of SURFACE_ORDER) {
    const cell = layout.cells[surfaceKey];
    const surface = surfaceByKey.get(surfaceKey);
    if (!surface || !Buffer.isBuffer(surface.bytes)) fail("proof_surface_missing", `the 2D proof requires the rendered ${surfaceKey} surface`);
    // Placed from the surface's own declared pixel geometry, not by reading the
    // raster back. The renderer already stated what it produced.
    const placement = containedPlacement(cell.image, surface.pixelWidth, surface.pixelHeight);
    const resized = await sharp(surface.bytes, { limitInputPixels: false })
      .resize(placement.w, placement.h, { fit: "fill", kernel: "lanczos3" })
      .png(PNG_OPTIONS).toBuffer();
    composites.push({ input: resized, left: placement.x, top: placement.y });
    markup.push(cellMarkup(cell, dimensionByKey.get(surfaceKey), placement));
  }

  markup.push(identityMarkup(layout.cells.hero3d, identities, render));
  markup.push(footerMarkup(dimensions, totalSqFt, {
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
    textIdentities: identities.text.map(({ textId, string }) => ({ textId, string })),
    logoIdentities: identities.logos.map(({ identityKey, contentHash }) => ({ identityKey, contentHash })),
    perSurfaceDimensions: dimensions,
    generated: false,
  });
}

module.exports = {
  MASTER_PROOF_CONTRACT,
  SURFACE_ORDER,
  MasterProofError,
  renderMasterProof,
  _test: { dimensionsFromManifest, canonicalIdentities },
};
