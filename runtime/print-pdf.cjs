"use strict";

/**
 * ONE deterministic single-image print PDF writer.
 *
 * Two consumers need the same document: the paid six-surface production output
 * set (`output.build`, beside its PNG/TIFF/EPS siblings) and the
 * PanelProFileOutput physical-piece package. RULE 0.21 forbids a second
 * producer of an artifact class, and `productionPdf` in
 * `panelpro-file-output-render.cjs` was already the proven one -- so it moved
 * here and both callers execute it rather than each writing PDF structure.
 *
 * What makes it safe to share: the document shape is identical. One page at an
 * exact printed size in PDF points, MediaBox == BleedBox, TrimBox inset by the
 * bleed, and ONE image whose bytes are the PNG's own lossless RGB deflate
 * stream lifted straight out of its IDAT chunks. No recompression, no JPEG, no
 * fonts, no transparency, no JavaScript, no wall-clock timestamp -- so the same
 * pixels and the same inputs always produce the same bytes.
 *
 * Written by hand rather than with a PDF library because the runtime image
 * carries sharp and nothing else, and a single-image PDF is a hundred lines of
 * structure.
 */

const DEFAULT_CODES = Object.freeze({
  pngInvalid: "print_pdf_png_invalid",
  rgbRequired: "print_pdf_rgb_required",
  iccRequired: "print_pdf_icc_required",
  geometryInvalid: "print_pdf_geometry_invalid",
});

const PNG_SIGNATURE = "89504e470d0a1a0a";

/** Six decimals, then JSON's own shortest form -- the same rounding the
 * PanelProFileOutput renderer has always used, kept so its bytes do not move. */
const n = (value) => Number(Number(value).toFixed(6));

function fail(code) {
  throw Object.assign(new Error(code), { code, retryable: false });
}

function positive(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(code);
  return number;
}

/**
 * A PDF literal string ends at its first unbalanced `)`. Every identifier these
 * callers pass is already alphanumeric-plus-punctuation, so this escape is a
 * no-op today and the existing bytes are unchanged -- it is here so a later
 * caller cannot corrupt the document structure with a title.
 */
function pdfText(value) {
  return String(value ?? "").replace(/[\\()]/g, (character) => `\\${character}`);
}

/**
 * Read the PNG's IHDR geometry and concatenate its IDAT stream. The stream is a
 * zlib-wrapped, per-scanline-filtered RGB image, which is exactly what a PDF
 * `/FlateDecode` image with `/Predictor 15` expects -- so the PDF carries the
 * SAME compressed bytes the PNG does and cannot drift from it.
 */
function pngRgbStream(png, codes) {
  if (!Buffer.isBuffer(png) || png.length < 8 || png.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) fail(codes.pngInvalid);
  const idat = [];
  let width = 0;
  let height = 0;
  let sawHeader = false;
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > png.length) fail(codes.pngInvalid);
    if (type === "IHDR") {
      if (length !== 13) fail(codes.pngInvalid);
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      // 8-bit truecolour, no interlace. A palette, an alpha channel or Adam7
      // would all decode to something other than the /DeviceRGB rows the page
      // content stream places.
      if (png[offset + 16] !== 8 || png[offset + 17] !== 2 || png[offset + 20] !== 0) fail(codes.rgbRequired);
      sawHeader = true;
    }
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  if (!sawHeader || !idat.length || !width || !height) fail(codes.pngInvalid);
  return { stream: Buffer.concat(idat), width, height };
}

/**
 * @param {Buffer} png           the artwork, already at exact print pixels
 * @param {Buffer} icc           an ICC profile to embed; required
 * @param {number} widthPixels   expected IHDR width (cross-checked)
 * @param {number} heightPixels  expected IHDR height (cross-checked)
 * @param {number} pageWidthPoints  page width in PDF points (72 per inch)
 * @param {number} pageHeightPoints page height in PDF points
 * @param {number} bleedPoints   TrimBox inset on every edge, in points
 */
function buildDeterministicRasterPdf({
  png,
  icc,
  widthPixels,
  heightPixels,
  pageWidthPoints,
  pageHeightPoints,
  bleedPoints,
  title,
  subject,
  creator,
  codes: overrides,
} = {}) {
  const codes = { ...DEFAULT_CODES, ...(overrides || {}) };
  const profile = Buffer.isBuffer(icc) ? icc : icc instanceof Uint8Array ? Buffer.from(icc) : null;
  if (!profile || !profile.length) fail(codes.iccRequired);
  const raster = pngRgbStream(png, codes);
  if (Number(widthPixels) !== raster.width || Number(heightPixels) !== raster.height) fail(codes.geometryInvalid);
  const width = n(positive(pageWidthPoints, codes.geometryInvalid));
  const height = n(positive(pageHeightPoints, codes.geometryInvalid));
  const bleedValue = Number(bleedPoints);
  if (!Number.isFinite(bleedValue) || bleedValue < 0 || bleedValue * 2 >= Math.min(width, height)) fail(codes.geometryInvalid);
  const bleed = n(bleedValue);

  const stream = (dictionary, bytes) => Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
    bytes,
    Buffer.from("\nendstream"),
  ]);
  // Object numbers are fixed: 1 catalog, 2 pages, 3 page, 4 image, 5 ICC,
  // 6 content stream, 7 Info. The page and the trailer name them, so they are
  // spelled literally rather than computed.
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /BleedBox [0 0 ${width} ${height}] /TrimBox [${bleed} ${bleed} ${n(width - bleed)} ${n(height - bleed)}] /Resources << /XObject << /Art 4 0 R >> >> /Contents 6 0 R >>`),
    stream(`/Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /BitsPerComponent 8 /ColorSpace [/ICCBased 5 0 R] /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${raster.width} >>`, raster.stream),
    stream("/N 3 /Alternate /DeviceRGB", profile),
    stream("", Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Art Do\nQ\n`)),
    Buffer.from(`<< /Title (${pdfText(title)}) /Subject (${pdfText(subject)}) /Creator (${pdfText(creator)}) >>`),
  ];

  const parts = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let offset = parts[0].length;
  objects.forEach((body, index) => {
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    offsets.push(offset);
    parts.push(object);
    offset += object.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(parts);
}

module.exports = { buildDeterministicRasterPdf, pngRgbStream, PNG_SIGNATURE };
