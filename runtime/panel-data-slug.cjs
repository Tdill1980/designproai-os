"use strict";

/**
 * THE PANEL DATA SLUG. (owner, 2026-09-02, from Brice's print sample)
 *
 * Every printed panel leaves the OS with its data printed along one edge,
 * OUTSIDE the bleed, in the same form as the Caldera RIP's own info band.
 * Owner: "You need to compare it to what Brice provides you an image of."
 * Brice's band, read from his photo, is:
 *
 *   - two column blocks of `Key ....: Value` rows with dotted leaders
 *     (left: Printer, Date, Job, File type, Media, Resolution, Mode, Quality;
 *     right: Color Management, Input profile, Rendering, Output Profile,
 *     Linearization, Scale, Screening);
 *   - one regular-weight sans face, keys and values the same size, nothing
 *     bold, no title, no rule, no marks -- a plain white band;
 *   - printed across the full width of the panel at the LEADING edge, before
 *     the artwork in the print direction.
 *
 * This strip is that form with our fields: identity, geometry, lineage and
 * approval (the RIP's own fields stay the RIP's). It sits on the TOP edge so
 * the printed sheet reads RIP band -> our band -> artwork as one block.
 *
 * Where it belongs, and where it never goes:
 *  - NEVER in Call 1. The canonical A.T.L.A.S. panel stays one pure rectangle
 *    of artwork (RULE 0.15). Nothing here reads or writes a canonical panel.
 *  - In the production outputs (output.build): 1.5" at the file's full-scale
 *    150 PPI = 225 px on the top edge. PNG, TIFF and EPS all carry it and all
 *    DECLARE it, so `output.verify` can prove the strip is exactly what the
 *    contract says and nothing downstream mistakes it for artwork.
 *  - On the six Call 11 QC duplicates: a fixed 120 px strip. Those are QC
 *    instruments at native 12-21 px/in, so the strip is sized to be readable
 *    on the PanelPro board, not to a physical inch.
 *
 * The artwork below the strip is not touched: the canvas is extended and the
 * strip composited into the extension only. Locked by
 * tests/panel-data-slug.test.mjs.
 *
 * Pure rendering: sharp + SVG text, the same mechanism as the QC certificate.
 */

const sharp = require("sharp");

const PANEL_DATA_SLUG_CONTRACT = "designpro.panel-data-slug.v1";
const SLUG_EDGE = "top";
const SLUG_INCHES = 1.5;
const OUTPUT_FULL_SCALE_PPI = 150;
const OUTPUT_SLUG_PIXELS = SLUG_INCHES * OUTPUT_FULL_SCALE_PPI; // 225
const QC_SLUG_PIXELS = 120;
const MAX_ROWS_PER_BLOCK = 10;
const MAX_KEY_CHARS = 24;
const MAX_VALUE_CHARS = 160;
const LEADER = ".";
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

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Rows are `{ left: [[key, value], ...], right: [[key, value], ...] }`: the two
 * column blocks of Brice's band. Every key must be present; a value may be
 * empty only when it is deliberately blank (the QC line before the stamp).
 */
function cleanRows(rows) {
  const blocks = {};
  for (const side of ["left", "right"]) {
    const list = rows?.[side];
    if (!Array.isArray(list) || !list.length || list.length > MAX_ROWS_PER_BLOCK) fail("panel_data_slug_rows_invalid", `${side} block needs 1-${MAX_ROWS_PER_BLOCK} rows`);
    blocks[side] = list.map((row) => {
      const key = cleanText(row?.[0], MAX_KEY_CHARS);
      const value = cleanText(row?.[1], MAX_VALUE_CHARS);
      if (!key) fail("panel_data_slug_rows_invalid", "a slug row has no key");
      return [key, value];
    });
  }
  return Object.freeze({ left: Object.freeze(blocks.left), right: Object.freeze(blocks.right) });
}

/** The flat `Key: Value` list, for artifact metadata and the board readout. */
function rowsToLines(rows) {
  const clean = cleanRows(rows);
  return Object.freeze([...clean.left, ...clean.right].map(([key, value]) => `${key}: ${value}`));
}

/**
 * Layout, matching Brice's band: two blocks side by side, each block a column
 * of keys, a run of leader dots, and the colons standing in ONE exact column
 * per block (his widest key -- "Color Management" -- shows a space and the
 * colon, no dots; the shorter keys fill the gap with dots). One regular-weight
 * sans face at one size, the rows tight so the type fills the band as his
 * does, sized so every row fits both the row height and the block width -- on
 * a narrow QC panel the type gets smaller rather than a value getting cut.
 *
 * The renderer does not honour `textLength`, so the colon column is placed
 * explicitly: the dot run is right-anchored at the block's stop, the key is
 * painted over the start of that run on a white cover, and the colon and
 * value start at the stop. Widths come from the Arial/Helvetica advance
 * table (Liberation Sans, which the renderer resolves "Arial" to, is
 * metric-compatible), so the cover ends where the key ends and the gap
 * before the dots is one narrow space on every row, as on his band.
 */
// Arial / Helvetica / Liberation Sans horizontal advances, per 1000 em.
const ADVANCE = (() => {
  const table = {};
  const set = (chars, w) => { for (const c of chars) table[c] = w; };
  set(" ", 278); set(".:,;!|", 278); set("ijl", 222); set("ftI/[]\\", 278); set("r", 333); set("-()", 333);
  set("cksvxyzJ", 500); set("abdeghnopqu0123456789#$_", 556); set("mM", 833); set("w", 722); set("W", 944);
  set("ABEFKPSTVXYZ", 667); set("F", 611); set("T", 611); set("L", 556); set("CDHNRU", 722); set("GOQ", 778);
  set("<>=+~", 584); set("^", 469); set("@", 1015); set("%", 889); set("&", 667); set("*", 389); set("\"", 355); set("'", 191); set("?", 556);
  return table;
})();
function advance(text, fontSize) {
  let total = 0;
  for (const c of String(text)) total += ADVANCE[c] ?? 600;
  return total * fontSize / 1000;
}

function slugSvg({ rows, widthPx, heightPx }) {
  const blocks = cleanRows(rows);
  const width = Number(widthPx);
  const height = Number(heightPx);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 24) fail("panel_data_slug_geometry_invalid", "slug geometry is too small");
  const pad = Math.max(3, Math.round(height * 0.04));
  const rowCount = Math.max(blocks.left.length, blocks.right.length);
  const rowHeight = (height - pad * 2) / rowCount;
  const blockWidth = (width - pad * 3) / 2;
  // Per block, at 1 em: the colon column sits one space past the widest key,
  // and the block must hold its widest "key ...: value" row.
  const stopEm = (list) => Math.max(...list.map(([key]) => advance(key, 1))) + 0.4;
  const longestEm = Math.max(...[blocks.left, blocks.right].map((list) => {
    const stop = stopEm(list);
    return Math.max(...list.map(([, value]) => stop + advance(`: ${value}`, 1)));
  }));
  const widthFit = Math.floor(blockWidth / longestEm);
  const fontSize = Math.max(6, Math.min(Math.floor(rowHeight * 0.86), widthFit));
  const font = `font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" fill="#000000" xml:space="preserve"`;
  const draw = (list, originX) => {
    const stop = Math.round(originX + stopEm(list) * fontSize);
    // The run ends one space short of the colon, so the widest key reads
    // "key :" with no partial dot, exactly as "Color Management :" does.
    const dotsEnd = stop - Math.round(advance(" ", fontSize));
    const dots = Math.ceil((dotsEnd - originX) / advance(LEADER, fontSize));
    const coverX = Math.max(0, originX - Math.round(fontSize * 1.5));
    return list.map(([key, value], index) => {
      const y = Math.round(pad + rowHeight * index + rowHeight * 0.5 + fontSize * 0.35);
      const coverWidth = Math.round(originX - coverX + advance(key, fontSize) + fontSize * 0.2);
      const coverTop = Math.round(y - fontSize * 0.9);
      return [
        `<text x="${dotsEnd}" y="${y}" text-anchor="end" ${font}>${LEADER.repeat(dots)}</text>`,
        `<rect x="${coverX}" y="${coverTop}" width="${coverWidth}" height="${Math.round(fontSize * 1.2)}" fill="#ffffff"/>`,
        `<text x="${originX}" y="${y}" ${font}>${esc(key)}</text>`,
        `<text x="${stop}" y="${y}" ${font}>: ${esc(value)}</text>`,
      ].join("\n  ");
    }).join("\n  ");
  };
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  ${draw(blocks.left, pad)}
  ${draw(blocks.right, Math.round(pad * 2 + blockWidth))}
</svg>`);
}

async function renderPanelDataSlug({ rows, widthPx, heightPx }) {
  return sharp(slugSvg({ rows, widthPx, heightPx })).png().toBuffer();
}

/**
 * Extend the canvas by the strip on the TOP edge and composite the strip into
 * the extension. The rows from `artworkTop` down are the input's pixels,
 * untouched. Returns the new PNG bytes and the geometry the caller must
 * declare on the artifact.
 */
async function applyPanelDataSlug(bytes, { rows, heightPx, edge = SLUG_EDGE } = {}) {
  if (edge !== SLUG_EDGE) fail("panel_data_slug_edge_unsupported", `the slug contract places the strip on the ${SLUG_EDGE} edge only`);
  const height = Number(heightPx);
  if (!Number.isInteger(height) || height < 24) fail("panel_data_slug_geometry_invalid", "slug height must be an integer >= 24 px");
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height) fail("panel_data_slug_source_invalid", "the panel bytes are not a decodable image");
  const strip = await renderPanelDataSlug({ rows, widthPx: meta.width, heightPx: height });
  const out = await sharp(bytes, { limitInputPixels: false })
    .extend({ top: height, left: 0, right: 0, bottom: 0, background: WHITE })
    .composite([{ input: strip, left: 0, top: 0 }])
    .png()
    .toBuffer();
  return Object.freeze({
    bytes: out,
    width: meta.width,
    height: meta.height + height,
    artworkHeight: meta.height,
    artworkTop: height,
    slug: Object.freeze({ contract: PANEL_DATA_SLUG_CONTRACT, edge: SLUG_EDGE, heightPx: height }),
  });
}

/** The metadata every slugged artifact declares. Verification keys on these. */
function slugMetadata({ heightPx, inches = null, rows }) {
  const clean = cleanRows(rows);
  return Object.freeze({
    slugContract: PANEL_DATA_SLUG_CONTRACT,
    slugEdge: SLUG_EDGE,
    slugInches: inches,
    slugPixels: Number(heightPx),
    slugRows: clean,
    slugLines: rowsToLines(clean),
  });
}

module.exports = Object.freeze({
  PANEL_DATA_SLUG_CONTRACT,
  SLUG_EDGE,
  SLUG_INCHES,
  OUTPUT_FULL_SCALE_PPI,
  OUTPUT_SLUG_PIXELS,
  QC_SLUG_PIXELS,
  PanelDataSlugError,
  applyPanelDataSlug,
  renderPanelDataSlug,
  rowsToLines,
  slugMetadata,
  _test: { slugSvg, cleanRows },
});
