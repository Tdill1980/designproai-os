"use strict";

/**
 * Glyph outlines straight out of the pinned font file.
 *
 * Typography cannot go through fontconfig. libvips resolves font-family by name
 * and substitutes silently: an embedded @font-face data URI is discarded, and
 * DejaVu Serif Bold, DejaVu Sans Mono and a family that does not exist all
 * rasterise byte-identically. Type produced that way is not the type the master
 * specifies, and nothing downstream could tell.
 *
 * So the font file itself is the authority. This reads the TrueType tables out
 * of the exact bytes the master pins, converts the glyphs the canonical string
 * needs into outline geometry, and hands back a path. Different font bytes
 * necessarily produce different geometry, because the geometry *is* the font.
 * Outlining also matches how wraps are actually sent to print: type is
 * converted to curves so no font has to exist at output time.
 *
 * LIMITS, STATED RATHER THAN HIDDEN. Advance-width positioning only: no GPOS
 * kerning, no GSUB substitution, no bidi, no complex-script shaping. Latin
 * copy set from a pinned file is exact; anything needing a shaper is not
 * supported and must fail closed rather than be approximated.
 */

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT_FLAG = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

class FontError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "FontError";
  }
}

function fail(code, message) {
  throw new FontError(code, message);
}

function readTableDirectory(bytes) {
  if (bytes.length < 12) fail("font_truncated", "font file is too short to contain a table directory");
  const tag = bytes.readUInt32BE(0);
  // 0x00010000 is TrueType outlines; 'true' is the legacy Apple tag. 'OTTO'
  // carries CFF outlines, which this reader does not implement.
  if (tag === 0x4f54544f) fail("font_cff_unsupported", "CFF/OTTO outlines are not supported; supply a TrueType (glyf) font");
  if (tag !== 0x00010000 && tag !== 0x74727565) fail("font_format_unsupported", "not a TrueType font");
  const numTables = bytes.readUInt16BE(4);
  const tables = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > bytes.length) fail("font_truncated", "table directory runs past the end of the file");
    tables.set(bytes.toString("latin1", record, record + 4), {
      offset: bytes.readUInt32BE(record + 8),
      length: bytes.readUInt32BE(record + 12),
    });
  }
  return tables;
}

/** Unicode code point to glyph id, from the cmap format 4 subtable. */
function readCmap(bytes, table) {
  const base = table.offset;
  const numSubtables = bytes.readUInt16BE(base + 2);
  let best = null;
  for (let index = 0; index < numSubtables; index += 1) {
    const record = base + 4 + index * 8;
    const platformId = bytes.readUInt16BE(record);
    const encodingId = bytes.readUInt16BE(record + 2);
    const offset = bytes.readUInt32BE(record + 4);
    const format = bytes.readUInt16BE(base + offset);
    if (format === 4 && (platformId === 3 || platformId === 0) && (encodingId === 1 || encodingId === 3 || platformId === 0)) {
      best = base + offset;
      break;
    }
  }
  if (best === null) fail("font_cmap_unsupported", "font has no Unicode cmap format 4 subtable");

  const segCount = bytes.readUInt16BE(best + 6) / 2;
  const endBase = best + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;

  return (codePoint) => {
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = bytes.readUInt16BE(endBase + segment * 2);
      if (codePoint > end) continue;
      const start = bytes.readUInt16BE(startBase + segment * 2);
      if (codePoint < start) return 0;
      const delta = bytes.readInt16BE(deltaBase + segment * 2);
      const rangeOffset = bytes.readUInt16BE(rangeBase + segment * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyphAddress = rangeBase + segment * 2 + rangeOffset + (codePoint - start) * 2;
      if (glyphAddress + 2 > bytes.length) return 0;
      const glyphId = bytes.readUInt16BE(glyphAddress);
      return glyphId === 0 ? 0 : (glyphId + delta) & 0xffff;
    }
    return 0;
  };
}

function readLoca(bytes, table, numGlyphs, longFormat) {
  const offsets = new Array(numGlyphs + 1);
  for (let index = 0; index <= numGlyphs; index += 1) {
    offsets[index] = longFormat
      ? bytes.readUInt32BE(table.offset + index * 4)
      : bytes.readUInt16BE(table.offset + index * 2) * 2;
  }
  return offsets;
}

function readHmtx(bytes, table, numberOfHMetrics, numGlyphs) {
  const advances = new Array(numGlyphs);
  let last = 0;
  for (let index = 0; index < numGlyphs; index += 1) {
    if (index < numberOfHMetrics) last = bytes.readUInt16BE(table.offset + index * 4);
    advances[index] = last;
  }
  return advances;
}

/** Parse only what outlining needs. */
function parseFont(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) fail("font_empty", "font bytes are required");
  const tables = readTableDirectory(bytes);
  for (const required of ["head", "maxp", "cmap", "loca", "glyf", "hhea", "hmtx"]) {
    if (!tables.has(required)) fail("font_table_missing", `font is missing the ${required} table`);
  }
  const head = tables.get("head");
  const unitsPerEm = bytes.readUInt16BE(head.offset + 18);
  const indexToLocFormat = bytes.readInt16BE(head.offset + 50);
  const numGlyphs = bytes.readUInt16BE(tables.get("maxp").offset + 4);
  const hhea = tables.get("hhea");
  const ascender = bytes.readInt16BE(hhea.offset + 4);
  const descender = bytes.readInt16BE(hhea.offset + 6);
  const numberOfHMetrics = bytes.readUInt16BE(hhea.offset + 34);

  return Object.freeze({
    bytes, unitsPerEm, ascender, descender, numGlyphs,
    glyf: tables.get("glyf"),
    loca: readLoca(bytes, tables.get("loca"), numGlyphs, indexToLocFormat === 1),
    advances: readHmtx(bytes, tables.get("hmtx"), numberOfHMetrics, numGlyphs),
    glyphIdFor: readCmap(bytes, tables.get("cmap")),
  });
}

/** One glyph's contours, in font units, y up. */
function glyphContours(font, glyphId, depth = 0) {
  if (depth > 5) fail("font_composite_too_deep", "composite glyph nesting is too deep");
  if (glyphId < 0 || glyphId >= font.numGlyphs) return [];
  const start = font.glyf.offset + font.loca[glyphId];
  const end = font.glyf.offset + font.loca[glyphId + 1];
  if (end <= start) return [];                       // empty glyph, e.g. space
  const bytes = font.bytes;
  const numberOfContours = bytes.readInt16BE(start);

  if (numberOfContours < 0) {
    // Composite: accumulate the components' contours with their offsets.
    const contours = [];
    let cursor = start + 10;
    for (;;) {
      const flags = bytes.readUInt16BE(cursor);
      const componentGlyph = bytes.readUInt16BE(cursor + 2);
      cursor += 4;
      let dx = 0;
      let dy = 0;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        if (flags & ARGS_ARE_XY_VALUES) { dx = bytes.readInt16BE(cursor); dy = bytes.readInt16BE(cursor + 2); }
        cursor += 4;
      } else {
        if (flags & ARGS_ARE_XY_VALUES) { dx = bytes.readInt8(cursor); dy = bytes.readInt8(cursor + 1); }
        cursor += 2;
      }
      // Scaled components are rare in text faces and would need a full 2x2
      // transform to be exact; refusing beats rendering them wrong.
      if (flags & (WE_HAVE_A_SCALE | WE_HAVE_AN_X_AND_Y_SCALE | WE_HAVE_A_TWO_BY_TWO)) {
        fail("font_composite_scaled_unsupported", "scaled composite glyphs are not supported");
      }
      for (const contour of glyphContours(font, componentGlyph, depth + 1)) {
        contours.push(contour.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })));
      }
      if (!(flags & MORE_COMPONENTS)) break;
    }
    return contours;
  }

  const endPts = [];
  let cursor = start + 10;
  for (let index = 0; index < numberOfContours; index += 1) { endPts.push(bytes.readUInt16BE(cursor)); cursor += 2; }
  const pointCount = numberOfContours ? endPts[endPts.length - 1] + 1 : 0;
  cursor += 2 + bytes.readUInt16BE(cursor);          // skip hinting instructions

  const flags = [];
  while (flags.length < pointCount) {
    const flag = bytes.readUInt8(cursor); cursor += 1;
    flags.push(flag);
    if (flag & REPEAT_FLAG) {
      let repeats = bytes.readUInt8(cursor); cursor += 1;
      while (repeats-- > 0 && flags.length < pointCount) flags.push(flag);
    }
  }

  const xs = [];
  let x = 0;
  for (const flag of flags) {
    if (flag & X_SHORT) { const delta = bytes.readUInt8(cursor); cursor += 1; x += (flag & X_SAME_OR_POSITIVE) ? delta : -delta; }
    else if (!(flag & X_SAME_OR_POSITIVE)) { x += bytes.readInt16BE(cursor); cursor += 2; }
    xs.push(x);
  }
  const ys = [];
  let y = 0;
  for (const flag of flags) {
    if (flag & Y_SHORT) { const delta = bytes.readUInt8(cursor); cursor += 1; y += (flag & Y_SAME_OR_POSITIVE) ? delta : -delta; }
    else if (!(flag & Y_SAME_OR_POSITIVE)) { y += bytes.readInt16BE(cursor); cursor += 2; }
    ys.push(y);
  }

  const contours = [];
  let first = 0;
  for (const last of endPts) {
    const contour = [];
    for (let index = first; index <= last; index += 1) {
      contour.push({ x: xs[index], y: ys[index], onCurve: (flags[index] & ON_CURVE) !== 0 });
    }
    if (contour.length) contours.push(contour);
    first = last + 1;
  }
  return contours;
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * Contours to SVG path data, quadratic throughout, with the implied on-curve
 * midpoints TrueType leaves out written explicitly.
 */
function contoursToPath(contours, transform) {
  const parts = [];
  for (const contour of contours) {
    if (!contour.length) continue;
    const points = contour.slice();
    // Start on an on-curve point; if the contour has none, use the midpoint.
    let startIndex = points.findIndex((point) => point.onCurve);
    let startPoint;
    if (startIndex < 0) {
      startPoint = { x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2, onCurve: true };
      startIndex = 0;
      points.unshift(startPoint);
    } else {
      startPoint = points[startIndex];
    }
    const moved = transform(startPoint);
    parts.push(`M${round(moved.x)} ${round(moved.y)}`);

    const count = points.length;
    let index = 1;
    let control = null;
    while (index <= count) {
      const point = points[(startIndex + index) % count];
      if (point.onCurve) {
        const to = transform(point);
        if (control) { const c = transform(control); parts.push(`Q${round(c.x)} ${round(c.y)} ${round(to.x)} ${round(to.y)}`); control = null; }
        else parts.push(`L${round(to.x)} ${round(to.y)}`);
      } else if (control) {
        // Two consecutive off-curve points imply an on-curve midpoint.
        const mid = { x: (control.x + point.x) / 2, y: (control.y + point.y) / 2 };
        const c = transform(control);
        const m = transform(mid);
        parts.push(`Q${round(c.x)} ${round(c.y)} ${round(m.x)} ${round(m.y)}`);
        control = point;
      } else {
        control = point;
      }
      index += 1;
    }
    if (control) { const c = transform(control); const to = transform(startPoint); parts.push(`Q${round(c.x)} ${round(c.y)} ${round(to.x)} ${round(to.y)}`); }
    parts.push("Z");
  }
  return parts.join(" ");
}

/**
 * Outline a canonical string at a given cap-height-independent em size.
 * Returns geometry in pixels with y down, ready for SVG.
 */
function outlineString({ fontBytes, string, sizeIn, pxPerInch }) {
  const text = String(string);
  if (!text.length) fail("font_string_empty", "a canonical string is required");
  const font = parseFont(fontBytes);
  const emPx = sizeIn * pxPerInch;
  const scale = emPx / font.unitsPerEm;
  const baselinePx = (font.ascender / font.unitsPerEm) * emPx;

  const segments = [];
  let penX = 0;
  for (const character of Array.from(text)) {
    const codePoint = character.codePointAt(0);
    const glyphId = font.glyphIdFor(codePoint);
    // A missing glyph would silently print .notdef, which is exactly the class
    // of quiet substitution this module exists to prevent.
    if (glyphId === 0 && character !== " ") {
      fail("font_glyph_missing", `the pinned font has no glyph for ${JSON.stringify(character)} (U+${codePoint.toString(16).toUpperCase().padStart(4, "0")})`);
    }
    const offset = penX;
    const path = contoursToPath(glyphContours(font, glyphId), (point) => ({ x: offset + point.x * scale, y: baselinePx - point.y * scale }));
    if (path) segments.push(path);
    penX += font.advances[glyphId] * scale;
  }

  return {
    path: segments.join(" "),
    widthPx: Math.max(1, Math.ceil(penX)),
    heightPx: Math.max(1, Math.ceil(((font.ascender - font.descender) / font.unitsPerEm) * emPx)),
    advancePx: penX,
    unitsPerEm: font.unitsPerEm,
  };
}

/** The outlined string as a standalone SVG, with no font dependency at all. */
function outlineStringSvg({ fontBytes, string, sizeIn, pxPerInch, fill, boxWidthPx, boxHeightPx }) {
  const outlined = outlineString({ fontBytes, string, sizeIn, pxPerInch });
  const width = Math.max(1, Math.round(boxWidthPx || outlined.widthPx));
  const height = Math.max(1, Math.round(boxHeightPx || outlined.heightPx));
  return {
    ...outlined,
    svg: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${outlined.path}" fill="${fill}" fill-rule="nonzero"/></svg>`),
    widthPx: width,
    heightPx: height,
  };
}

module.exports = {
  FontError,
  parseFont,
  glyphContours,
  contoursToPath,
  outlineString,
  outlineStringSvg,
};
