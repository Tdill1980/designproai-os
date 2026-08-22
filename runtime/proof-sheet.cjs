"use strict";

/**
 * The Call 8 DesignProAI 2D Production Proof sheet.
 *
 * This is the customer- and shop-facing document: every approved vehicle view
 * laid out on one page with its GENIE trim callout, the print size at five
 * inches of bleed on all four edges, per-surface square footage, the total
 * coverage, and the approval block that a human signs.
 *
 * It is drawn deterministically. The same approved renders and the same
 * validated GENIE manifest always produce the same sheet, so the proof can be
 * rebuilt and compared instead of regenerated.
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

const VIEW_ORDER = Object.freeze(["driver", "roof", "passenger", "hood", "front", "rear", "hero3d"]);
const CLOSEUP_VIEW_ORDER = Object.freeze(["driver", "roof", "passenger", "hood", "front", "rear", "closeup"]);
const VIEW_LABELS = Object.freeze({
  driver: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
  closeup: "CLOSE-UP DETAIL",
  hero3d: "APPROVED 3D HERO",
});
// Column span, column index and row index for each view. Fixed, never derived
// from data, so two runs of the same vehicle produce the same page.
const VIEW_CELLS = Object.freeze({
  driver: { column: 0, row: 0, span: 2 },
  roof: { column: 2, row: 0, span: 1 },
  passenger: { column: 0, row: 1, span: 2 },
  hood: { column: 2, row: 1, span: 1 },
  front: { column: 0, row: 2, span: 1 },
  rear: { column: 1, row: 2, span: 1 },
  closeup: { column: 2, row: 2, span: 1 },
  hero3d: { column: 2, row: 2, span: 1 },
});

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
function proofSheetLayout(viewOrder = VIEW_ORDER) {
  const bodyTop = MARGIN + HEADER_HEIGHT;
  const bodyHeight = SHEET_HEIGHT - MARGIN - FOOTER_HEIGHT - bodyTop;
  const bodyWidth = SHEET_WIDTH - MARGIN * 2;
  const columnWidth = Math.floor(bodyWidth / 3);
  const rowHeight = Math.floor(bodyHeight / 3);
  const cells = {};
  for (const viewKey of viewOrder) {
    const position = VIEW_CELLS[viewKey];
    const x = MARGIN + position.column * columnWidth;
    const y = bodyTop + position.row * rowHeight;
    const width = columnWidth * position.span;
    const frame = { x, y, w: width, h: rowHeight };
    const image = {
      x: x + CELL_PADDING,
      y: y + CELL_PADDING,
      w: width - CELL_PADDING * 2,
      h: rowHeight - CELL_PADDING * 2 - CAPTION_HEIGHT - DIMENSION_BAND,
    };
    cells[viewKey] = { viewKey, frame, image, label: VIEW_LABELS[viewKey] };
  }
  return {
    contract: PROOF_SHEET_CONTRACT,
    width: SHEET_WIDTH, height: SHEET_HEIGHT,
    margin: MARGIN, headerHeight: HEADER_HEIGHT, footerHeight: FOOTER_HEIGHT,
    bodyTop, bodyWidth, bodyHeight, columnWidth, rowHeight,
    cells,
  };
}

function normalizedSurfaces(surfaces) {
  const byKey = new Map();
  for (const surface of Array.isArray(surfaces) ? surfaces : []) {
    const surfaceKey = String(surface?.surfaceKey || surface?.key || "").trim().toLowerCase();
    const widthInches = Number(surface?.widthInches ?? surface?.trimWidthIn);
    const heightInches = Number(surface?.heightInches ?? surface?.trimHeightIn);
    if (!VIEW_LABELS[surfaceKey] || ["closeup", "hero3d"].includes(surfaceKey) || !(widthInches > 0 && heightInches > 0)) continue;
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
  if (surface) {
    parts.push(`<text x="${cell.frame.x + cell.frame.w / 2}" y="${captionY + 72}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="${MUTED}">${escapeXml(`${inches(surface.widthInches)}" × ${inches(surface.heightInches)}" trim  ·  ${inches(surface.printWidthInches)}" × ${inches(surface.printHeightInches)}" with 5" bleed  ·  ${surface.surfaceSqFt.toFixed(2)} sq ft`)}</text>`);
  } else {
    parts.push(`<text x="${cell.frame.x + cell.frame.w / 2}" y="${captionY + 72}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="${MUTED}">Approved design reference · not a printed panel</text>`);
  }
  return parts.join("");
}

function footerMarkup(surfaces, totalSqFt, { designId, orderNumber, proofBinding }) {
  const top = SHEET_HEIGHT - MARGIN - FOOTER_HEIGHT;
  const trimRow = surfaces.map((surface) => `${VIEW_LABELS[surface.surfaceKey]} ${inches(surface.widthInches)}"×${inches(surface.heightInches)}"`).join("   |   ");
  const printRow = surfaces.map((surface) => `${VIEW_LABELS[surface.surfaceKey]} ${inches(surface.printWidthInches)}"×${inches(surface.printHeightInches)}"`).join("   |   ");
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
 * Composes the sheet. `views` maps every view key to the approved render bytes
 * for that view; the six production surfaces come from the validated GENIE
 * manifest and drive every callout on the page.
 */
async function renderProofSheet({ views, surfaces, vehicle, designName, finish, designId, orderNumber, proofBinding }) {
  const ordered = normalizedSurfaces(surfaces);
  const hasCloseup = Buffer.isBuffer(views?.closeup);
  const hasHero = Buffer.isBuffer(views?.hero3d);
  if (hasCloseup === hasHero) {
    throw new ProofSheetError(
      "proof_sheet_seventh_view_invalid",
      "The 2D production proof requires exactly one Close-Up or immutable historical Hero proof",
    );
  }
  const viewOrder = hasCloseup ? CLOSEUP_VIEW_ORDER : VIEW_ORDER;
  const layout = proofSheetLayout(viewOrder);
  const surfaceByKey = new Map(ordered.map((surface) => [surface.surfaceKey, surface]));
  const totalSqFt = round2(ordered.reduce((total, surface) => total + surface.widthInches * surface.heightInches / 144, 0));
  const vehicleName = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle";
  const composites = [];
  const markup = [headerMarkup({
    vehicleName,
    designName: designName || "Approved design",
    finish: finish || "standard",
    totalSqFt,
  })];

  for (const viewKey of viewOrder) {
    const cell = layout.cells[viewKey];
    const bytes = views?.[viewKey];
    if (!bytes) throw new ProofSheetError("proof_sheet_view_missing", `The 2D production proof requires the approved ${viewKey} view`);
    const source = sharp(bytes, { limitInputPixels: false }).rotate().flatten({ background: "#ffffff" });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height) throw new ProofSheetError("proof_sheet_view_unreadable", `${viewKey} approved render is unreadable`);
    const placement = containedPlacement(cell.image, metadata.width, metadata.height);
    const resized = await source.resize(placement.w, placement.h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
    composites.push({ input: resized, left: placement.x, top: placement.y });
    markup.push(cellMarkup(cell, surfaceByKey.get(viewKey) || null, placement));
  }

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
    layout,
  };
}

module.exports = {
  BLEED_INCHES,
  PROOF_SHEET_CONTRACT,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  VIEW_ORDER,
  CLOSEUP_VIEW_ORDER,
  ProofSheetError,
  proofSheetLayout,
  renderProofSheet,
  _test: { containedPlacement, escapeXml, inches, normalizedSurfaces, round2 },
};
