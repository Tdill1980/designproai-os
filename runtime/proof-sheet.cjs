"use strict";

/**
 * The Call 8 DesignProAI 2D Production Proof sheet.
 *
 * This is the customer- and shop-facing document: THE SIX PRINT PANELS laid out
 * on one page, each with its GENIE trim callout, the print size at five inches
 * of bleed on all four edges, per-surface square footage, the total coverage,
 * and the approval block a human signs.
 *
 * ⛔ THE TILES ARE THE PANELS. THEY ARE NOT THE 3D PROOFS. (Trish 2026-08-29.)
 *
 * This function used to take `views` -- the seven persona-photographer renders,
 * photographs of a vehicle wearing the design -- and lay THOSE out under the
 * heading "2D Production Proof". A customer signed a page of studio
 * photographs; a shop received a page of studio photographs; and the same
 * pixels, flattened, became the print panels. The owner's word for the result
 * was accurate: screenshots presented as print files.
 *
 * The sheet now shows what will actually be printed. A production proof whose
 * tiles are not the production artwork proves nothing.
 *
 * It is drawn deterministically -- and now completely so, because there is no
 * generative step anywhere behind it. The same six Call-1 panels and the same
 * GENIE geometry always produce the same sheet, byte for byte, so the proof can
 * be rebuilt and compared instead of regenerated.
 */

const sharp = require("sharp");

const PROOF_SHEET_CONTRACT = "designpro.call8-2d-production-proof.v1";
const SHEET_WIDTH = 3300;
const SHEET_HEIGHT = 2550;
const MARGIN = 96;
const HEADER_HEIGHT = 232;
const FOOTER_HEIGHT = 486;
const CELL_PADDING = 26;
const CAPTION_HEIGHT = 92;
const DIMENSION_BAND = 46;
const BLEED_INCHES = 5;
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const ACCENT = "#059669";

// THE SIX CANONICAL SURFACES, IN SHEET ORDER. There is no seventh cell.
//
// The seventh used to be the Close-Up (or, on historical runs, the 3D Hero) --
// a photograph, on a production proof, in a slot where every other cell is now
// a printable panel. It is replaced by a drawn provenance block: same layout,
// same determinism, and nothing on the page that cannot be cut and printed.
const SURFACE_ORDER = Object.freeze(["driver", "roof", "passenger", "hood", "front", "rear"]);
const SURFACE_LABELS = Object.freeze({
  driver: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
});
// Column span, column index and row index for each surface. Fixed, never
// derived from data, so two runs of the same vehicle produce the same page.
const SURFACE_CELLS = Object.freeze({
  driver: { column: 0, row: 0, span: 2 },
  roof: { column: 2, row: 0, span: 1 },
  passenger: { column: 0, row: 1, span: 2 },
  hood: { column: 2, row: 1, span: 1 },
  front: { column: 0, row: 2, span: 1 },
  rear: { column: 1, row: 2, span: 1 },
});
// The vacated cell. Drawn, never generated.
const PROVENANCE_CELL = Object.freeze({ column: 2, row: 2, span: 1 });

class ProofSheetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[character]));
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function inches(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : String(round2(number));
}

/**
 * Deterministic page geometry. Pure function of nothing but the constants
 * above, so the claimant can assert it independently.
 */
function proofSheetLayout(surfaceOrder = SURFACE_ORDER) {
  const bodyTop = MARGIN + HEADER_HEIGHT;
  const bodyHeight = SHEET_HEIGHT - MARGIN - FOOTER_HEIGHT - bodyTop;
  const bodyWidth = SHEET_WIDTH - MARGIN * 2;
  const columnWidth = Math.floor(bodyWidth / 3);
  const rowHeight = Math.floor(bodyHeight / 3);
  const placeCell = (position) => {
    const x = MARGIN + position.column * columnWidth;
    const y = bodyTop + position.row * rowHeight;
    const width = columnWidth * position.span;
    return {
      frame: { x, y, w: width, h: rowHeight },
      image: {
        x: x + CELL_PADDING,
        y: y + CELL_PADDING,
        w: width - CELL_PADDING * 2,
        h: rowHeight - CELL_PADDING * 2 - CAPTION_HEIGHT - DIMENSION_BAND,
      },
    };
  };
  const cells = {};
  for (const surfaceKey of surfaceOrder) {
    const { frame, image } = placeCell(SURFACE_CELLS[surfaceKey]);
    cells[surfaceKey] = { surfaceKey, frame, image, label: SURFACE_LABELS[surfaceKey] };
  }
  const provenance = placeCell(PROVENANCE_CELL);
  return {
    contract: PROOF_SHEET_CONTRACT,
    width: SHEET_WIDTH, height: SHEET_HEIGHT,
    margin: MARGIN, headerHeight: HEADER_HEIGHT, footerHeight: FOOTER_HEIGHT,
    bodyTop, bodyWidth, bodyHeight, columnWidth, rowHeight,
    cells,
    provenanceCell: { frame: provenance.frame },
  };
}

function normalizedSurfaces(surfaces) {
  const byKey = new Map();
  for (const surface of Array.isArray(surfaces) ? surfaces : []) {
    const surfaceKey = String(surface?.surfaceKey || surface?.key || "").trim().toLowerCase();
    const widthInches = Number(surface?.widthInches ?? surface?.trimWidthIn);
    const heightInches = Number(surface?.heightInches ?? surface?.trimHeightIn);
    if (!SURFACE_LABELS[surfaceKey] || !(widthInches > 0 && heightInches > 0)) continue;
    byKey.set(surfaceKey, {
      surfaceKey, widthInches, heightInches,
      printWidthInches: widthInches + BLEED_INCHES * 2,
      printHeightInches: heightInches + BLEED_INCHES * 2,
      surfaceSqFt: round2(widthInches * heightInches / 144),
    });
  }
  const ordered = ["driver", "passenger", "hood", "roof", "front", "rear"];
  if (ordered.some((key) => !byKey.has(key))) {
    throw new ProofSheetError("proof_sheet_surfaces_incomplete", "The 2D production proof requires all six validated GENIE surfaces");
  }
  return ordered.map((key) => byKey.get(key));
}

function horizontalDimension(x, y, width, label) {
  const tick = 11;
  const textX = x + width / 2;
  return `<g stroke="${INK}" stroke-width="2.5" fill="none">
    <line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}"/>
    <line x1="${x}" y1="${y - tick}" x2="${x}" y2="${y + tick}"/>
    <line x1="${x + width}" y1="${y - tick}" x2="${x + width}" y2="${y + tick}"/>
    <polyline points="${x + 16},${y - 7} ${x + 2},${y} ${x + 16},${y + 7}"/>
    <polyline points="${x + width - 16},${y - 7} ${x + width - 2},${y} ${x + width - 16},${y + 7}"/>
  </g>
  <rect x="${textX - 108}" y="${y - 21}" width="216" height="42" fill="#ffffff"/>
  <text x="${textX}" y="${y + 12}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="${INK}">${escapeXml(label)}</text>`;
}

function verticalDimension(x, y, height, label) {
  const tick = 11;
  const textY = y + height / 2;
  return `<g stroke="${INK}" stroke-width="2.5" fill="none">
    <line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}"/>
    <line x1="${x - tick}" y1="${y}" x2="${x + tick}" y2="${y}"/>
    <line x1="${x - tick}" y1="${y + height}" x2="${x + tick}" y2="${y + height}"/>
    <polyline points="${x - 7},${y + 16} ${x},${y + 2} ${x + 7},${y + 16}"/>
    <polyline points="${x - 7},${y + height - 16} ${x},${y + height - 2} ${x + 7},${y + height - 16}"/>
  </g>
  <g transform="translate(${x} ${textY}) rotate(-90)">
    <rect x="-88" y="-21" width="176" height="42" fill="#ffffff"/>
    <text x="0" y="11" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="${INK}">${escapeXml(label)}</text>
  </g>`;
}

function headerMarkup({ vehicleName, designName, finish, totalSqFt }) {
  const detail = [
    `Vehicle: ${vehicleName}`,
    `Design: ${designName}`,
    `Finish: ${finish}`,
    `Coverage: ${totalSqFt.toFixed(2)} sq ft`,
  ].join("   |   ");
  return `<text x="${SHEET_WIDTH / 2}" y="${MARGIN + 74}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="66" font-weight="700" fill="${INK}" letter-spacing="1">DesignProAI™ — 2D Production Proof</text>
  <text x="${SHEET_WIDTH / 2}" y="${MARGIN + 132}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="${MUTED}">${escapeXml(detail)}</text>
  <text x="${SHEET_WIDTH / 2}" y="${MARGIN + 184}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="${ACCENT}" letter-spacing="2">EVERY PANEL DIMENSIONED BY UNIVERSAL GENIE · 5" BLEED ON ALL FOUR EDGES</text>
  <line x1="${MARGIN}" y1="${MARGIN + HEADER_HEIGHT - 26}" x2="${SHEET_WIDTH - MARGIN}" y2="${MARGIN + HEADER_HEIGHT - 26}" stroke="${INK}" stroke-width="3"/>`;
}

function cellMarkup(cell, surface, placement) {
  const parts = [`<rect x="${cell.frame.x + 6}" y="${cell.frame.y + 6}" width="${cell.frame.w - 12}" height="${cell.frame.h - 12}" fill="none" stroke="${RULE}" stroke-width="2"/>`];
  const captionY = cell.frame.y + cell.frame.h - CAPTION_HEIGHT;
  if (surface && placement) {
    parts.push(horizontalDimension(placement.x, placement.y + placement.h + 24, placement.w, `${inches(surface.widthInches)}"`));
    parts.push(verticalDimension(placement.x + placement.w + 26, placement.y, placement.h, `${inches(surface.heightInches)}"`));
    parts.push(`<rect x="${placement.x}" y="${placement.y}" width="${placement.w}" height="${placement.h}" fill="none" stroke="${RULE}" stroke-width="1.5" stroke-dasharray="8 8"/>`);
  }
  parts.push(`<text x="${cell.frame.x + cell.frame.w / 2}" y="${captionY + 34}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="${INK}" letter-spacing="2">${escapeXml(cell.label)}</text>`);
  // EVERY CELL IS A PRINTED PANEL NOW, so the "not a printed panel" caption is
  // gone with the seventh cell it described. A surface that cannot be
  // dimensioned never reaches here — `normalizedSurfaces` throws first.
  parts.push(`<text x="${cell.frame.x + cell.frame.w / 2}" y="${captionY + 72}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="${MUTED}">${escapeXml(`${inches(surface.widthInches)}" × ${inches(surface.heightInches)}" trim  ·  ${inches(surface.printWidthInches)}" × ${inches(surface.printHeightInches)}" with 5" bleed  ·  ${surface.surfaceSqFt.toFixed(2)} sq ft`)}</text>`);
  return parts.join("");
}

/**
 * The block in the cell the Close-Up photograph used to occupy.
 *
 * It states, on the page the customer signs, what the six tiles above it are:
 * the deterministic Call-1 panels, named by the master they were cut from. A
 * proof that cannot say what it is made of is how a page of studio photographs
 * passed as print files.
 */
function provenanceMarkup(cell, { masterHash, panelCount, sourceLabel }) {
  const centerX = cell.frame.x + cell.frame.w / 2;
  const top = cell.frame.y + 6;
  const line = (offset, size, weight, fill, text, spacing = 0) =>
    `<text x="${centerX}" y="${top + offset}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" letter-spacing="${spacing}">${escapeXml(text)}</text>`;
  return [
    `<rect x="${cell.frame.x + 6}" y="${top}" width="${cell.frame.w - 12}" height="${cell.frame.h - 12}" fill="none" stroke="${ACCENT}" stroke-width="3"/>`,
    line(74, 30, 700, ACCENT, "SOURCE OF THESE PANELS", 2),
    line(140, 26, 400, INK, `${panelCount} deterministic panels`),
    line(184, 26, 400, INK, sourceLabel),
    line(240, 24, 700, INK, "A.T.L.A.S. MASTER", 1),
    line(282, 22, 400, MUTED, String(masterHash || "unbound").slice(0, 32)),
    line(348, 22, 400, MUTED, "Geometric crop. No AI step."),
  ].join("");
}

function footerMarkup(surfaces, totalSqFt, { designId, orderNumber, proofBinding }) {
  const top = SHEET_HEIGHT - MARGIN - FOOTER_HEIGHT;
  const trimRow = surfaces.map((surface) => `${SURFACE_LABELS[surface.surfaceKey]} ${inches(surface.widthInches)}"×${inches(surface.heightInches)}"`).join("   |   ");
  const printRow = surfaces.map((surface) => `${SURFACE_LABELS[surface.surfaceKey]} ${inches(surface.printWidthInches)}"×${inches(surface.printHeightInches)}"`).join("   |   ");
  const line = (label, x, width, y) => `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="${INK}" stroke-width="2.5"/>
    <text x="${x}" y="${y + 36}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="${MUTED}">${escapeXml(label)}</text>`;
  const signatureY = top + 232;
  return `<line x1="${MARGIN}" y1="${top}" x2="${SHEET_WIDTH - MARGIN}" y2="${top}" stroke="${INK}" stroke-width="3"/>
  <text x="${MARGIN}" y="${top + 52}" font-family="Helvetica, Arial, sans-serif" font-size="25" font-weight="700" fill="${INK}" letter-spacing="1">TRIM SIZE</text>
  <text x="${MARGIN + 190}" y="${top + 52}" font-family="Helvetica, Arial, sans-serif" font-size="25" fill="${INK}">${escapeXml(trimRow)}</text>
  <text x="${MARGIN}" y="${top + 100}" font-family="Helvetica, Arial, sans-serif" font-size="25" font-weight="700" fill="${ACCENT}" letter-spacing="1">PRINT SIZE</text>
  <text x="${MARGIN + 190}" y="${top + 100}" font-family="Helvetica, Arial, sans-serif" font-size="25" fill="${ACCENT}">${escapeXml(printRow)}</text>
  <text x="${MARGIN}" y="${top + 142}" font-family="Helvetica, Arial, sans-serif" font-size="23" fill="${MUTED}">PRINT SIZE INCLUDES 5" BLEED ON ALL FOUR EDGES. CUT ON THE TRIM LINE.</text>
  ${line("Approved By", MARGIN, 620, signatureY)}
  ${line("Signature", MARGIN + 700, 620, signatureY)}
  ${line("Date", MARGIN + 1400, 420, signatureY)}
  <rect x="${SHEET_WIDTH - MARGIN - 700}" y="${signatureY - 96}" width="700" height="132" rx="14" fill="none" stroke="${ACCENT}" stroke-width="4"/>
  <text x="${SHEET_WIDTH - MARGIN - 350}" y="${signatureY - 52}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="${ACCENT}" letter-spacing="2">TOTAL COVERAGE</text>
  <text x="${SHEET_WIDTH - MARGIN - 350}" y="${signatureY + 4}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="52" font-weight="700" fill="${ACCENT}">${escapeXml(totalSqFt.toFixed(2))} SQ FT</text>
  <text x="${MARGIN}" y="${SHEET_HEIGHT - MARGIN - 12}" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="${MUTED}">Prepared by DesignProAI · ${escapeXml(designId)} · Order # ${escapeXml(orderNumber)}</text>
  <text x="${SHEET_WIDTH - MARGIN}" y="${SHEET_HEIGHT - MARGIN - 12}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="${MUTED}">Proof binding ${escapeXml(String(proofBinding).slice(0, 24))}</text>`;
}

function containedPlacement(area, imageWidth, imageHeight) {
  const scale = Math.min(area.w / imageWidth, area.h / imageHeight);
  const w = Math.max(1, Math.round(imageWidth * scale));
  const h = Math.max(1, Math.round(imageHeight * scale));
  return { x: Math.round(area.x + (area.w - w) / 2), y: Math.round(area.y + (area.h - h) / 2), w, h };
}

/**
 * Composes the sheet.
 *
 * `panels` maps every canonical surface key to that surface's Call-1 panel
 * bytes -- the exact artifact the print file is made of. The six production
 * surfaces come from the GENIE manifest and drive every callout on the page.
 *
 * There is no `views` parameter and there must not be one again. A caller that
 * wants to show the customer the 3D proofs has RevisionStudioIQ and PanelPro
 * for that; they are presentation surfaces. This is the production document.
 */
async function renderProofSheet({ panels, surfaces, vehicle, designName, finish, designId, orderNumber, proofBinding, masterHash }) {
  const ordered = normalizedSurfaces(surfaces);
  const layout = proofSheetLayout(SURFACE_ORDER);
  const surfaceByKey = new Map(ordered.map((surface) => [surface.surfaceKey, surface]));
  const totalSqFt = round2(ordered.reduce((total, surface) => total + surface.widthInches * surface.heightInches / 144, 0));
  const vehicleName = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle";
  const composites = [];
  const tiles = [];
  const markup = [headerMarkup({
    vehicleName,
    designName: designName || "Approved design",
    finish: finish || "standard",
    totalSqFt,
  })];

  for (const surfaceKey of SURFACE_ORDER) {
    const cell = layout.cells[surfaceKey];
    const bytes = panels?.[surfaceKey];
    if (!Buffer.isBuffer(bytes)) {
      throw new ProofSheetError("proof_sheet_panel_missing", `The 2D production proof requires the deterministic ${surfaceKey} panel`);
    }
    // `.rotate()` applies an EXIF orientation a panel should never carry, and
    // is kept only so a re-encoded panel cannot arrive sideways. `flatten` is
    // the white ground: a panel is opaque corner to corner (RULE 0.15), so on a
    // correct panel it changes nothing.
    const source = sharp(bytes, { limitInputPixels: false }).rotate().flatten({ background: "#ffffff" });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height) {
      throw new ProofSheetError("proof_sheet_panel_unreadable", `${surfaceKey} panel is unreadable`);
    }
    const surface = surfaceByKey.get(surfaceKey);
    const placement = containedPlacement(cell.image, metadata.width, metadata.height);
    const resized = await source.resize(placement.w, placement.h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
    composites.push({ input: resized, left: placement.x, top: placement.y });
    markup.push(cellMarkup(cell, surface, placement));
    tiles.push({
      surfaceKey,
      placement,
      trimWidthIn: surface.widthInches,
      trimHeightIn: surface.heightInches,
      printWidthIn: surface.printWidthInches,
      printHeightIn: surface.printHeightInches,
      sourcePixelWidth: metadata.width,
      sourcePixelHeight: metadata.height,
    });
  }

  markup.push(provenanceMarkup(layout.provenanceCell, {
    masterHash,
    panelCount: SURFACE_ORDER.length,
    sourceLabel: "cut from one A.T.L.A.S. master",
  }));

  markup.push(footerMarkup(ordered, totalSqFt, {
    designId: designId || "DesignID pending",
    orderNumber: orderNumber || "pending",
    proofBinding: proofBinding || "unbound",
  }));

  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}">${markup.join("")}</svg>`);
  const bytes = await sharp({ create: { width: SHEET_WIDTH, height: SHEET_HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([...composites, { input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, force: true })
    .toBuffer();
  return {
    contract: PROOF_SHEET_CONTRACT,
    bytes, width: SHEET_WIDTH, height: SHEET_HEIGHT,
    totalSqFt,
    surfaces: ordered,
    tiles,
    layout,
  };
}

module.exports = {
  BLEED_INCHES,
  PROOF_SHEET_CONTRACT,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  SURFACE_ORDER,
  SURFACE_LABELS,
  ProofSheetError,
  proofSheetLayout,
  renderProofSheet,
  _test: { containedPlacement, escapeXml, inches, normalizedSurfaces, provenanceMarkup, round2 },
};
