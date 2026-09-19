// PDF is the fourth paid production format (2026-09-19). Before this it did not
// exist in the delivered pack at all: output-qc's FORMATS was
// ["png","tiff","eps"], the exact count assertion was 18, and the only PDF
// writer in the tree was reachable solely through the manual PanelProFileOutput
// attachment flow that no DesignPro run starts. A shop whose RIP wants a PDF
// received none.
//
// These cases assert the three things that make the format REAL rather than a
// soft extra: the count is exact (a run that cannot write one fails closed),
// the bytes are the PNG's own deflate stream (so the four files are provably one
// artwork), and the page carries the 1:10 geometry with the TrimBox inset by the
// bleed (so a RIP knows where the vehicle edge is).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// The runtime's own node_modules is where sharp lives; the repo root has none.
const require = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = require("sharp");
const { FORMATS, SURFACES, OUTPUT_SCALE, BLEED_INCHES_PER_EDGE, PDF_BLEED_POINTS, verifyPdf, OutputVerificationError } = require("./output-qc.cjs");
const { buildDeterministicRasterPdf } = require("./print-pdf.cjs");

const TRIM_WIDTH_INCHES = 0.4;
const TRIM_HEIGHT_INCHES = 0.2;
const WIDTH_PIXELS = Math.round((TRIM_WIDTH_INCHES + BLEED_INCHES_PER_EDGE * 2) * 150);
const HEIGHT_PIXELS = Math.round((TRIM_HEIGHT_INCHES + BLEED_INCHES_PER_EDGE * 2) * 150);

const geometry = Object.freeze({
  surfaceKey: "driver",
  widthInches: TRIM_WIDTH_INCHES,
  heightInches: TRIM_HEIGHT_INCHES,
  widthPixels: WIDTH_PIXELS,
  heightPixels: HEIGHT_PIXELS,
  outputWidthPoints: (TRIM_WIDTH_INCHES + BLEED_INCHES_PER_EDGE * 2) * OUTPUT_SCALE * 72,
  outputHeightPoints: (TRIM_HEIGHT_INCHES + BLEED_INCHES_PER_EDGE * 2) * OUTPUT_SCALE * 72,
});

// The exact pipeline runtime/designpro-standalone-claimant.cjs output.build uses
// for the delivered PNG. The PDF must be built from THESE bytes, not a re-encode.
async function printPng() {
  const source = await sharp({ create: { width: WIDTH_PIXELS, height: HEIGHT_PIXELS, channels: 3, background: { r: 17, g: 120, b: 201 } } })
    .png().toBuffer();
  return await sharp(source, { limitInputPixels: false })
    .removeAlpha().toColourspace("srgb")
    .png({ compressionLevel: 6 })
    .withMetadata({ density: 1500 })
    .toBuffer();
}

async function printPdf(png, overrides = {}) {
  const icc = (await sharp(png).metadata()).icc;
  return buildDeterministicRasterPdf({
    png,
    icc,
    widthPixels: WIDTH_PIXELS,
    heightPixels: HEIGHT_PIXELS,
    pageWidthPoints: geometry.outputWidthPoints,
    pageHeightPoints: geometry.outputHeightPoints,
    bleedPoints: PDF_BLEED_POINTS,
    title: "DRIVER - TENTH SCALE",
    subject: "1:10 drawing scale; enlarge to 1000 percent.",
    creator: "DesignProAI",
    ...overrides,
  });
}

test("the paid output set is six surfaces x FOUR formats, and the count is exact", () => {
  assert.deepEqual([...FORMATS], ["png", "tiff", "eps", "pdf"]);
  assert.equal(SURFACES.length * FORMATS.length, 24);
  // requiredOutputFiles must move with FORMATS or output.verify asks a run to
  // prove a set it was never told to build.
  const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
  assert.match(claimant, /requiredOutputFiles: production \? 24 : 0,/);
  // The resumable-upload allowlist routes purely on byte size, so a large PDF
  // on a big flank would fail closed if its extension were not named.
  const spool = readFileSync(new URL("../runtime/zip-spool.cjs", import.meta.url), "utf8");
  assert.match(spool, /outputs\\\/\[a-z0-9-\]\+\\\.\(\?:png\|tiff\|eps\|pdf\)/);
});

test("the print PNG carries an ICC profile the PDF can embed", async () => {
  const png = await printPng();
  const { icc } = await sharp(png).metadata();
  assert.ok(icc?.length, "output.build's PNG pipeline must produce an embeddable ICC profile");
});

test("the PDF embeds the PNG's own deflate stream, so the two are one artwork", async () => {
  const png = await printPng();
  const pdf = await printPdf(png);
  const idat = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const stream = Buffer.concat(idat);
  assert.ok(stream.length > 0);
  assert.ok(pdf.includes(stream), "the PDF image stream must be the PNG's IDAT bytes verbatim -- no recompression");
  // Predictor 15 is PNG filtering: one filter byte per row ahead of the triples.
  assert.equal(inflateSync(stream).length, HEIGHT_PIXELS * (1 + WIDTH_PIXELS * 3));
});

test("verifyPdf accepts the produced document and reports its physical geometry", async () => {
  const decoded = verifyPdf(await printPdf(await printPng()), geometry);
  assert.equal(decoded.widthPixels, WIDTH_PIXELS);
  assert.equal(decoded.heightPixels, HEIGHT_PIXELS);
  assert.equal(decoded.colorSpace, "sRGB");
  assert.equal(decoded.pageWidthPoints, (TRIM_WIDTH_INCHES + 10) * 0.1 * 72);
  assert.equal(decoded.pageHeightPoints, (TRIM_HEIGHT_INCHES + 10) * 0.1 * 72);
  // 5 inches of bleed at 1:10 is 36 points on every edge.
  const round6 = (value) => Number(value.toFixed(6));
  assert.deepEqual(decoded.trimBoxPoints, [36, 36, round6(decoded.pageWidthPoints - 36), round6(decoded.pageHeightPoints - 36)]);
  assert.ok(decoded.iccByteSize > 0);
});

test("verifyPdf refuses a page whose physical size is not this surface's", async () => {
  const pdf = await printPdf(await printPng(), { pageWidthPoints: geometry.outputWidthPoints + 1 });
  assert.throws(() => verifyPdf(pdf, geometry), (error) => error instanceof OutputVerificationError && error.code === "output_pdf_media_box_invalid");
});

test("verifyPdf refuses a TrimBox that does not inset the bleed", async () => {
  const pdf = await printPdf(await printPng(), { bleedPoints: 12 });
  assert.throws(() => verifyPdf(pdf, geometry), (error) => error instanceof OutputVerificationError && error.code === "output_pdf_trim_box_invalid");
});

test("verifyPdf reads the cross-reference table, so a corrupted offset is caught", async () => {
  const pdf = Buffer.from(await printPdf(await printPng()));
  const startxrefAt = pdf.lastIndexOf(Buffer.from("startxref\n", "ascii"));
  const xrefAt = Number(pdf.toString("latin1", startxrefAt).match(/^startxref\n(\d+)\n/)[1]);
  const entriesAt = xrefAt + pdf.toString("latin1", xrefAt, xrefAt + 64).match(/^xref\n0 \d+\n0000000000 65535 f \n/)[0].length;
  // Corrupt object 3's offset only. The document still parses as a PDF and every
  // string a substring search would look for is still present.
  pdf.write("0000000009", entriesAt + 2 * 20, "latin1");
  assert.throws(() => verifyPdf(pdf, geometry), (error) => error instanceof OutputVerificationError && error.code === "output_pdf_xref_invalid");
});

test("the PDF writer refuses a raster whose geometry is not the one it was told", async () => {
  const png = await printPng();
  await assert.rejects(async () => printPdf(png, { widthPixels: WIDTH_PIXELS + 1 }), (error) => error.code === "print_pdf_geometry_invalid");
});

test("the PDF writer refuses to write a print document with no ICC profile", async () => {
  const png = await printPng();
  await assert.rejects(async () => printPdf(png, { icc: null }), (error) => error.code === "print_pdf_icc_required");
});
