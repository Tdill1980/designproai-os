"use strict";

/**
 * THE PANEL DATA SLUG. (owner, 2026-09-02, from Brice's print sample)
 *
 * Every printed panel leaves the OS with its data printed along one edge,
 * OUTSIDE the bleed, the way the Caldera RIP prints its own info band. The
 * RIP's band says how the file was printed; this strip says what the file IS:
 * order, DesignID, generation, revision, customer, vehicle, surface, trim,
 * print, bleed, square feet, hashes, density, build time, and the QC line.
 *
 * Where it belongs, and where it never goes:
 *  - NEVER in Call 1. The canonical A.T.L.A.S. panel stays one pure rectangle
 *    of artwork (RULE 0.15). Nothing here reads or writes a canonical panel.
 *  - In the production outputs (output.build): 1.5" at the file's full-scale
 *    150 PPI = 225 px on the bottom edge. PNG, TIFF and EPS all carry it and
 *    all DECLARE it, so `output.verify` can prove the strip is exactly what the
 *    contract says and nothing downstream mistakes it for artwork.
 *  - On the six Call 11 QC duplicates: a fixed 120 px strip. Those are QC
 *    instruments at native 12-21 px/in, so the strip is sized to be readable
 *    on the PanelPro board, not to a physical inch.
 *
 * The strip is white ground, black text, a hairline across its top, a cut mark
 * at each end, and the words TRIM STRIP - NOT ARTWORK at its right end. The
 * artwork above the strip is not touched: the canvas is extended and the strip
 * composited into the extension only. Locked by tests/panel-data-slug.test.mjs.
 *
 * Pure rendering: sharp + SVG text, the same mechanism as the QC certificate.
 */

const sharp = require("sharp");

const PANEL_DATA_SLUG_CONTRACT = "designpro.panel-data-slug.v1";
const SLUG_EDGE = "bottom";
const SLUG_INCHES = 1.5;
const OUTPUT_FULL_SCALE_PPI = 150;
const OUTPUT_SLUG_PIXELS = SLUG_INCHES * OUTPUT_FULL_SCALE_PPI; // 225
const QC_SLUG_PIXELS = 120;
const SLUG_TITLE = "TRIM STRIP - NOT ARTWORK";
const MAX_LINES = 8;
const MAX_LINE_CHARS = 220;
const WHITE = Object.freeze({ r: 255, g: 255, b: 255, alpha: 1 });
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

class PanelDataSlugError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PanelDataSlugError";
  }
}

function fail(code, message) {
  throw new PanelDataSlugError(code, message);
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) fail("panel_data_slug_lines_invalid", `slug needs 1-${MAX_LINES} lines`);
  return lines.map((line) => {
    const string = String(line == null ? "" : line).replace(CONTROL_RE, " ").trim();
    if (!string || string.length > MAX_LINE_CHARS) fail("panel_data_slug_lines_invalid", "a slug line is empty or too long");
    return string;
  });
}

/**
 * Layout: the strip is `heightPx` tall and `widthPx` wide. Text is sized so
 * every line fits both the row height and the strip width; the widest line
 * decides the font, so nothing is ever clipped -- on a narrow QC panel the
 * type gets smaller rather than the data getting cut.
 */
function slugSvg({ lines, widthPx, heightPx }) {
  const rows = cleanLines(lines);
  const width = Number(widthPx);
  const height = Number(heightPx);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 24) fail("panel_data_slug_geometry_invalid", "slug geometry is too small");
  const pad = Math.max(4, Math.round(height * 0.06));
  const markLength = Math.max(8, Math.round(height * 0.25));
  const rowHeight = (height - pad * 2) / rows.length;
  const longest = Math.max(SLUG_TITLE.length + 4, ...rows.map((row) => row.length));
  // 0.62em is the average advance of a sans-serif glyph at these sizes; the
  // width fit is deliberately conservative so a long customer name still lands.
  const widthFit = Math.floor((width - pad * 2 - markLength * 2) / (longest * 0.62));
  const fontSize = Math.max(6, Math.min(Math.floor(rowHeight * 0.74), widthFit));
  const x = pad + markLength;
  const text = rows.map((row, index) => {
    const y = Math.round(pad + rowHeight * index + rowHeight * 0.5 + fontSize * 0.35);
    const weight = index === 0 ? "700" : "400";
    return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="#000000">${esc(row)}</text>`;
  }).join("\n  ");
  const titleSize = Math.max(6, Math.round(fontSize * 0.8));
  const markWidth = Math.max(2, Math.round(height * 0.03));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <rect x="0" y="0" width="${width}" height="${Math.max(1, Math.round(height * 0.012))}" fill="#000000"/>
  <rect x="0" y="0" width="${markWidth}" height="${markLength}" fill="#000000"/>
  <rect x="${width - markWidth}" y="0" width="${markWidth}" height="${markLength}" fill="#000000"/>
  ${text}
  <text x="${width - pad - markLength}" y="${height - pad}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="${titleSize}" font-weight="700" fill="#000000">${esc(SLUG_TITLE)}</text>
</svg>`);
}

async function renderPanelDataSlug({ lines, widthPx, heightPx }) {
  return sharp(slugSvg({ lines, widthPx, heightPx })).png().toBuffer();
}

/**
 * Extend the canvas by the strip on the bottom edge and composite the strip
 * into the extension. The rows above `artworkHeight` are the input's pixels,
 * untouched. Returns the new PNG bytes and the geometry the caller must
 * declare on the artifact.
 */
async function applyPanelDataSlug(bytes, { lines, heightPx, edge = SLUG_EDGE } = {}) {
  if (edge !== SLUG_EDGE) fail("panel_data_slug_edge_unsupported", `the slug contract places the strip on the ${SLUG_EDGE} edge only`);
  const height = Number(heightPx);
  if (!Number.isInteger(height) || height < 24) fail("panel_data_slug_geometry_invalid", "slug height must be an integer >= 24 px");
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height) fail("panel_data_slug_source_invalid", "the panel bytes are not a decodable image");
  const strip = await renderPanelDataSlug({ lines, widthPx: meta.width, heightPx: height });
  const out = await sharp(bytes, { limitInputPixels: false })
    .extend({ top: 0, left: 0, right: 0, bottom: height, background: WHITE })
    .composite([{ input: strip, left: 0, top: meta.height }])
    .png()
    .toBuffer();
  return Object.freeze({
    bytes: out,
    width: meta.width,
    height: meta.height + height,
    artworkHeight: meta.height,
    slug: Object.freeze({ contract: PANEL_DATA_SLUG_CONTRACT, edge: SLUG_EDGE, heightPx: height }),
  });
}

/** The metadata every slugged artifact declares. Verification keys on these. */
function slugMetadata({ heightPx, inches = null, lines }) {
  return Object.freeze({
    slugContract: PANEL_DATA_SLUG_CONTRACT,
    slugEdge: SLUG_EDGE,
    slugInches: inches,
    slugPixels: Number(heightPx),
    slugLines: cleanLines(lines),
  });
}

module.exports = Object.freeze({
  PANEL_DATA_SLUG_CONTRACT,
  SLUG_EDGE,
  SLUG_INCHES,
  SLUG_TITLE,
  OUTPUT_FULL_SCALE_PPI,
  OUTPUT_SLUG_PIXELS,
  QC_SLUG_PIXELS,
  PanelDataSlugError,
  applyPanelDataSlug,
  renderPanelDataSlug,
  slugMetadata,
  _test: { slugSvg, cleanLines },
});
