import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { before, test } from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const outputQcSource = readFileSync(new URL("../../runtime/output-qc.cjs", import.meta.url), "utf8");
const {
  FILE_DPI,
  FIXED_ZIP_DATE,
  FIXED_ZIP_MODE,
  FORMATS,
  JPEG_QUALITY,
  JPG_OUTPUT_FORMAT_CONTRACT,
  OUTPUT_FORMAT_CONTRACT,
  SURFACES,
  VARIANTS,
  buildDeterministicRasterEps,
  buildDeterministicZip,
  createDeterministicZip64Stream,
  crc32,
  outputFileCountForContract,
  planEpsResources,
  sha256,
  variantsForContract,
  verifyProductionOutputSet,
} = require("../../runtime/output-qc.cjs");
const { buildPanelProProductionPdf } = require("../../runtime/panelpro-file-output-render.cjs");

const trimWidthInches = 0.02;
const trimHeightInches = 0.04;
const widthPixels = Math.round((trimWidthInches + 10) * 150);
const heightPixels = Math.round((trimHeightInches + 10) * 150);

let dimensionManifest;
let validArtifacts;
let formatBytes;
let cleanFormatBytes;

// A branded file is written the way every tier before v4 wrote it -- no
// variant key at all (absent reads as branded); a clean file names itself,
// exactly as output.build does under v4 (`.../outputs/<side>-clean.<ext>`).
function artifact(surfaceKey, format, bytes, variant = "branded") {
  return {
    kind: "output",
    surfaceKey,
    storagePath: `designpro/user_00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/outputs/${surfaceKey}${variant === "clean" ? "-clean" : ""}.${format === "tiff" ? "tiff" : format}`,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    metadata: {
      format,
      dpi: 1500,
      outputScale: 0.1,
      fullScaleBleedInches: 5,
      width: widthPixels,
      height: heightPixels,
      ...(variant === "clean" ? { variant } : {}),
    },
    bytes,
  };
}

function cloneArtifacts(rows = validArtifacts) {
  return rows.map((row) => ({ ...row, metadata: { ...row.metadata } }));
}

/** The thirty branded files: what a v3 (and, minus formats, a v2 / v1) build produced. */
function brandedArtifacts() {
  return validArtifacts.filter((row) => row.metadata.variant !== "clean");
}

function indexOf(rows, surfaceKey, format, variant = "branded") {
  return rows.findIndex((row) => row.surfaceKey === surfaceKey && row.metadata.format === format && (row.metadata.variant || "branded") === variant);
}

function replaceBytes(row, bytes) {
  row.bytes = bytes;
  row.byteSize = bytes.length;
  row.contentHash = sha256(bytes);
}

function corruptFirstIdatWithValidCrc(bytes) {
  const output = Buffer.from(bytes);
  let offset = 8;
  while (offset + 12 <= output.length) {
    const length = output.readUInt32BE(offset);
    const type = output.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT" && length > 8) {
      const dataStart = offset + 8;
      output[dataStart + Math.floor(length / 2)] ^= 0xff;
      output.writeUInt32BE(crc32(output.subarray(offset + 4, dataStart + length)), dataStart + length);
      return output;
    }
    offset += length + 12;
  }
  throw new Error("fixture contains no usable IDAT chunk");
}

// Drop every APP2 ICC_PROFILE segment from a JPEG, leaving the rest byte for byte.
function stripJpegIcc(bytes) {
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff && bytes[offset + 1] !== 0xda) {
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    const isIcc = bytes[offset + 1] === 0xe2 && bytes.toString("ascii", offset + 4, offset + 16) === "ICC_PROFILE\0";
    if (!isIcc) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  parts.push(bytes.subarray(offset));
  return Buffer.concat(parts);
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

before(async () => {
  dimensionManifest = {
    expectedSurfaces: SURFACES.map((surfaceKey) => ({
      surfaceKey,
      widthInches: trimWidthInches,
      heightInches: trimHeightInches,
      bleed: { top: 5, right: 5, bottom: 5, left: 5 },
    })),
  };
  // Two pixel sets, one per variant. The clean (Zone 2) panel is different
  // artwork from the branded one, so a clean PDF/JPG bound to the branded PNG
  // is a genuine mismatch and not a hash coincidence.
  async function variantBytes(background) {
    const source = sharp({ create: { width: widthPixels, height: heightPixels, channels: 3, background } });
    const png = await source.clone().png({ compressionLevel: 9 }).withMetadata({ density: FILE_DPI }).toBuffer();
    const tiff = await source.clone().tiff({ compression: "lzw", predictor: "horizontal", bitdepth: 8 }).withMetadata({ density: FILE_DPI }).toBuffer();
    const rgb = Buffer.alloc(widthPixels * heightPixels * 3);
    for (let offset = 0; offset < rgb.length; offset += 3) {
      rgb[offset] = background.r;
      rgb[offset + 1] = background.g;
      rgb[offset + 2] = background.b;
    }
    const eps = buildDeterministicRasterEps({ rgb, widthPixels, heightPixels, trimWidthInches, trimHeightInches });
    // The JPG the way output.build makes it: the PNG's pixels, quality 92, no
    // chroma subsampling, JFIF density and the sRGB profile carried through.
    const jpg = await sharp(png).removeAlpha().toColourspace("srgb").jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4" }).withMetadata({ density: FILE_DPI }).toBuffer();
    return { png, tiff, eps, jpg };
  }
  const byVariant = {
    branded: await variantBytes({ r: 31, g: 117, b: 194 }),
    clean: await variantBytes({ r: 236, g: 240, b: 244 }),
  };
  formatBytes = byVariant.branded;
  cleanFormatBytes = byVariant.clean;
  // Sixty files: six surfaces x five formats x both variants, built
  // generically off VARIANTS so the fixture follows the contract.
  validArtifacts = [];
  for (const surfaceKey of SURFACES) {
    for (const variant of VARIANTS) {
      const bytes = byVariant[variant];
      const pdf = await buildPanelProProductionPdf({ png: bytes.png, surfaceKey, trimWidthInches, trimHeightInches });
      for (const format of FORMATS) {
        const row = artifact(surfaceKey, format, format === "pdf" ? pdf : bytes[format], variant);
        if (format === "pdf" || format === "jpg") row.metadata.sourcePngHash = sha256(bytes.png);
        validArtifacts.push(row);
      }
    }
  }
});

test("the contract tiers resolve their formats, variants and file counts", () => {
  assert.equal(OUTPUT_FORMAT_CONTRACT, "designpro.production-formats.v4");
  assert.equal(JPG_OUTPUT_FORMAT_CONTRACT, "designpro.production-formats.v3");
  assert.deepEqual([...VARIANTS], ["branded", "clean"]);
  assert.deepEqual([...variantsForContract(OUTPUT_FORMAT_CONTRACT)], ["branded", "clean"]);
  for (const [contract, count] of [[OUTPUT_FORMAT_CONTRACT, 60], [JPG_OUTPUT_FORMAT_CONTRACT, 30], ["designpro.production-formats.v2", 24], ["designpro.production-formats.v1", 18]]) {
    assert.equal(outputFileCountForContract(contract), count, contract);
    if (contract !== OUTPUT_FORMAT_CONTRACT) assert.deepEqual([...variantsForContract(contract)], ["branded"], `${contract} ships the branded panel only`);
  }
  assert.equal(outputFileCountForContract("designpro.production-formats.v9"), null);
  assert.equal(variantsForContract("designpro.production-formats.v9"), null);
});

test("accepts exactly six surfaces times PNG/TIFF/EPS/PDF/JPG times branded/clean and returns a canonical stable receipt", async () => {
  const first = await verifyProductionOutputSet({ artifacts: validArtifacts, dimensionManifest });
  const second = await verifyProductionOutputSet({ artifacts: [...validArtifacts].reverse(), dimensionManifest });
  assert.equal(first.verified, true);
  assert.equal(first.fileCount, 60);
  assert.deepEqual(first.exactSurfaceSet, ["driver", "passenger", "hood", "roof", "front", "rear"]);
  assert.deepEqual(first.exactFormatSet, ["png", "tiff", "eps", "pdf", "jpg"]);
  assert.deepEqual(first.exactVariantSet, ["branded", "clean"]);
  assert.equal(first.jpegQuality, 92);
  assert.equal(first.outputSetHash, second.outputSetHash);
  assert.deepEqual(first.files.map(({ surfaceKey, variant, format }) => `${surfaceKey}:${variant}:${format}`),
    SURFACES.flatMap((surface) => VARIANTS.flatMap((variant) => FORMATS.map((format) => `${surface}:${variant}:${format}`))));
  assert.ok(first.files.every((file) => file.widthPixels === widthPixels && file.heightPixels === heightPixels && file.dpi === 1500 && file.colorSpace === "sRGB"));
  // output.build under v4 names the branded variant explicitly on every file;
  // that is the same set, the same receipt and the same hash as an absent key.
  const explicit = cloneArtifacts();
  for (const row of explicit) if (!row.metadata.variant) row.metadata.variant = "branded";
  assert.equal((await verifyProductionOutputSet({ artifacts: explicit, dimensionManifest })).outputSetHash, first.outputSetHash);
});

test("v4 refuses fifty-nine files, a duplicated identity, an invalid variant and a clean derivative bound to the branded PNG", async () => {
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: validArtifacts.slice(0, -1), dimensionManifest }), expectCode("output_artifact_count_invalid"));
  const duplicate = cloneArtifacts();
  duplicate[indexOf(duplicate, "driver", "png", "clean")] = { ...duplicate[indexOf(duplicate, "driver", "png")], storagePath: `${duplicate[0].storagePath}.copy.png` };
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: duplicate, dimensionManifest }), expectCode("output_artifact_duplicate"));
  const invalid = cloneArtifacts();
  invalid[indexOf(invalid, "driver", "png", "clean")].metadata.variant = "blank";
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: invalid, dimensionManifest }), expectCode("output_artifact_variant_invalid"));
  // A clean PDF or JPG must bind to the clean PNG of its own surface, never
  // to the branded one: rasterising the blank from the branded file is
  // exactly the defect the per-variant identity exists to refuse.
  const brandedPngHash = sha256(formatBytes.png);
  const pdfFromBranded = cloneArtifacts();
  pdfFromBranded[indexOf(pdfFromBranded, "driver", "pdf", "clean")].metadata.sourcePngHash = brandedPngHash;
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: pdfFromBranded, dimensionManifest }), expectCode("output_pdf_source_or_geometry_mismatch"));
  const jpgFromBranded = cloneArtifacts();
  jpgFromBranded[indexOf(jpgFromBranded, "driver", "jpg", "clean")].metadata.sourcePngHash = brandedPngHash;
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: jpgFromBranded, dimensionManifest }), expectCode("output_jpg_source_mismatch"));
});

test("a completed v3 pack still verifies as exactly thirty branded files, and refuses a clean file it never shipped", async () => {
  const artifacts = brandedArtifacts();
  assert.equal(artifacts.length, 30);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts, dimensionManifest }), expectCode("output_artifact_count_invalid"));
  const verified = await verifyProductionOutputSet({ artifacts, dimensionManifest, outputFormatContract: JPG_OUTPUT_FORMAT_CONTRACT });
  assert.equal(verified.fileCount, 30);
  assert.deepEqual(verified.exactFormatSet, ["png", "tiff", "eps", "pdf", "jpg"]);
  assert.equal(verified.jpegQuality, 92);
  // Pre-v4 receipt shape is byte-identical to before: no variant on any file,
  // no exactVariantSet, so a completed pack's outputSetHash cannot drift.
  assert.equal("exactVariantSet" in verified, false);
  assert.ok(verified.files.every((file) => !("variant" in file)));
  assert.deepEqual(verified.files.map(({ surfaceKey, format }) => `${surfaceKey}:${format}`), SURFACES.flatMap((surface) => FORMATS.map((format) => `${surface}:${format}`)));
  const withClean = cloneArtifacts(artifacts);
  withClean[indexOf(withClean, "driver", "png")] = cloneArtifacts()[indexOf(validArtifacts, "driver", "png", "clean")];
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: withClean, dimensionManifest, outputFormatContract: JPG_OUTPUT_FORMAT_CONTRACT }), expectCode("output_artifact_variant_unexpected"));
});

test("supports server-side byte loading without trusting artifact metadata", async () => {
  const rows = validArtifacts.map(({ bytes, ...row }) => row);
  const byPath = new Map(validArtifacts.map((row) => [row.storagePath, row.bytes]));
  const receipt = await verifyProductionOutputSet({ artifacts: rows, dimensionManifest, readBytes: async (row) => byPath.get(row.storagePath) });
  assert.equal(receipt.fileCount, 60);
});

test("JPG is the verified PNG's pixels in a second container: bound by hash, 1500 DPI JFIF, embedded sRGB", async () => {
  const jpgIndex = indexOf(validArtifacts, "driver", "jpg");
  const unbound = cloneArtifacts();
  delete unbound[jpgIndex].metadata.sourcePngHash;
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: unbound, dimensionManifest }), expectCode("output_jpg_source_mismatch"));
  const otherPng = cloneArtifacts();
  otherPng[jpgIndex].metadata.sourcePngHash = "0".repeat(64);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: otherPng, dimensionManifest }), expectCode("output_jpg_source_mismatch"));
  const wrongMagic = cloneArtifacts();
  replaceBytes(wrongMagic[jpgIndex], formatBytes.png);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: wrongMagic, dimensionManifest }), expectCode("output_jpg_magic_invalid"));
  const lowDensity = cloneArtifacts();
  replaceBytes(lowDensity[jpgIndex], await sharp(formatBytes.png).jpeg({ quality: JPEG_QUALITY }).withMetadata({ density: 300 }).toBuffer());
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: lowDensity, dimensionManifest }), expectCode("output_jpg_density_invalid"));
  const noProfile = cloneArtifacts();
  replaceBytes(noProfile[jpgIndex], await sharp(formatBytes.png).jpeg({ quality: JPEG_QUALITY }).withMetadata({ density: FILE_DPI, icc: undefined }).toBuffer().then(stripJpegIcc));
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: noProfile, dimensionManifest }), expectCode("output_jpg_srgb_missing"));
  const wrongGeometry = cloneArtifacts();
  replaceBytes(wrongGeometry[jpgIndex], await sharp({ create: { width: widthPixels + 1, height: heightPixels, channels: 3, background: "red" } }).jpeg({ quality: JPEG_QUALITY }).withMetadata({ density: FILE_DPI }).toBuffer());
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: wrongGeometry, dimensionManifest }), expectCode("output_raster_geometry_invalid"));
});

test("a completed v2 pack still verifies as exactly twenty-four files under its own frozen contract", async () => {
  const artifacts = brandedArtifacts().filter((row) => row.metadata.format !== "jpg");
  await assert.rejects(() => verifyProductionOutputSet({ artifacts, dimensionManifest }), expectCode("output_artifact_count_invalid"));
  const verified = await verifyProductionOutputSet({ artifacts, dimensionManifest, outputFormatContract: "designpro.production-formats.v2" });
  assert.equal(verified.fileCount, 24);
  assert.deepEqual(verified.exactFormatSet, ["png", "tiff", "eps", "pdf"]);
  assert.equal(verified.jpegQuality, undefined, "a v2 receipt keeps its pre-JPG shape and hash");
  assert.equal("exactVariantSet" in verified, false, "a v2 receipt keeps its pre-variant shape and hash");
  assert.ok(verified.files.every((file) => !("variant" in file)));
  await assert.rejects(() => verifyProductionOutputSet({ artifacts, dimensionManifest, outputFormatContract: "designpro.production-formats.v9" }), expectCode("output_format_contract_invalid"));
});

test("PDF reuses exact PNG pixels with tenth-scale trim and five-inch bleed geometry", () => {
  const row = validArtifacts[indexOf(validArtifacts, "driver", "pdf")];
  const source = row.bytes.toString("latin1");
  assert.ok(source.includes("/MediaBox [0 0 72.144 72.288] /BleedBox [0 0 72.144 72.288] /TrimBox [36 36 36.144 36.288]"));
  assert.ok(source.includes(`/Width ${widthPixels} /Height ${heightPixels} /BitsPerComponent 8 /ColorSpace [/ICCBased 5 0 R] /Filter /FlateDecode`));
  assert.ok(source.includes("1:10 drawing scale; enlarge to 1000 percent."));
  assert.equal(row.metadata.sourcePngHash, sha256(formatBytes.png));
});

test("PDF rejects forged geometry or different artwork even with recomputed artifact hash", async () => {
  const index = indexOf(validArtifacts, "driver", "pdf");
  const rows = cloneArtifacts();
  replaceBytes(rows[index], Buffer.from(rows[index].bytes.toString("latin1").replace("/MediaBox [0 0 72.144 72.288]", "/MediaBox [0 0 99.999 99.999]"), "latin1"));
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }), expectCode("output_pdf_source_or_geometry_mismatch"));
  const otherPng = await sharp({ create: { width: widthPixels, height: heightPixels, channels: 3, background: "red" } }).png().withMetadata({ density: FILE_DPI }).toBuffer();
  replaceBytes(rows[index], await buildPanelProProductionPdf({ png: otherPng, surfaceKey: "driver", trimWidthInches, trimHeightInches }));
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }), expectCode("output_pdf_source_or_geometry_mismatch"));
});

test("PDF cannot be replaced by PNG and cannot omit its source identity", async () => {
  const index = validArtifacts.findIndex((row) => row.metadata.format === "pdf");
  const wrongType = cloneArtifacts();
  replaceBytes(wrongType[index], formatBytes.png);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: wrongType, dimensionManifest }), expectCode("output_pdf_magic_invalid"));
  const missingIdentity = cloneArtifacts();
  delete missingIdentity[index].metadata.sourcePngHash;
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: missingIdentity, dimensionManifest }), expectCode("output_pdf_source_or_geometry_mismatch"));
});

test("legacy eighteen-file output requires an explicit frozen legacy format contract", async () => {
  const artifacts = brandedArtifacts().filter((row) => row.metadata.format !== "pdf" && row.metadata.format !== "jpg");
  await assert.rejects(() => verifyProductionOutputSet({ artifacts, dimensionManifest }), expectCode("output_artifact_count_invalid"));
  const verified = await verifyProductionOutputSet({ artifacts, dimensionManifest, outputFormatContract: "designpro.production-formats.v1" });
  assert.equal(verified.fileCount, 18);
  assert.deepEqual(verified.exactFormatSet, ["png", "tiff", "eps"]);
  assert.equal("exactVariantSet" in verified, false);
});

test("rejects missing and duplicate surface/format identities", async () => {
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: validArtifacts.slice(0, -1), dimensionManifest }), expectCode("output_artifact_count_invalid"));
  const duplicate = cloneArtifacts();
  duplicate[duplicate.length - 1] = { ...duplicate[2], metadata: { ...duplicate[2].metadata }, storagePath: `${duplicate[2].storagePath}.copy.eps` };
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: duplicate, dimensionManifest }), expectCode("output_artifact_duplicate"));
});

test("rejects wrong format magic even when the attacker recomputes the outer hash", async () => {
  const rows = cloneArtifacts();
  replaceBytes(rows[0], formatBytes.tiff);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }), expectCode("output_png_magic_invalid"));
});

test("bounded pixel probe still rejects CRC-valid corrupt PNG image data and identifies the surface", async () => {
  const rows = cloneArtifacts();
  replaceBytes(rows[0], corruptFirstIdatWithValidCrc(rows[0].bytes));
  await assert.rejects(
    () => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }),
    (error) => {
      assert.equal(error?.code, "output_png_decode_failed", error?.stack || String(error));
      assert.match(error.message, /^driver\.png could not be decoded:/);
      return true;
    },
  );
});

test("production raster verification cannot regress to an unbounded full-image statistics scan", () => {
  assert.match(outputQcSource, /const RASTER_DECODE_PROBE_MAX_EDGE = 2048;/);
  assert.doesNotMatch(outputQcSource, /await\s+[A-Za-z_$][\w$]*\.stats\(\)/);
  assert.match(outputQcSource, /\.resize\(\{[\s\S]*?RASTER_DECODE_PROBE_MAX_EDGE[\s\S]*?\.raw\(\)[\s\S]*?resolveWithObject: true/);
});

test("rejects a valid PNG whose decoded pixel geometry is wrong", async () => {
  const rows = cloneArtifacts();
  const wrong = await sharp({ create: { width: widthPixels + 1, height: heightPixels, channels: 3, background: "red" } }).png().withMetadata({ density: FILE_DPI }).toBuffer();
  replaceBytes(rows[0], wrong);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }), expectCode("output_raster_geometry_invalid"));
});

test("rejects raster density other than exact 1500 DPI", async () => {
  const rows = cloneArtifacts();
  const wrong = await sharp({ create: { width: widthPixels, height: heightPixels, channels: 3, background: "red" } }).png().withMetadata({ density: 300 }).toBuffer();
  replaceBytes(rows[0], wrong);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }), expectCode("output_png_density_invalid"));
});

test("rejects non-sRGB grayscale raster output", async () => {
  const rows = cloneArtifacts();
  const grayscale = await sharp({ create: { width: widthPixels, height: heightPixels, channels: 3, background: "red" } }).greyscale().png().toBuffer();
  const insertAt = 8 + 12 + 13; // immediately after IHDR
  const physData = Buffer.alloc(9);
  const pixelsPerMeter = Math.round(FILE_DPI / 0.0254);
  physData.writeUInt32BE(pixelsPerMeter, 0);
  physData.writeUInt32BE(pixelsPerMeter, 4);
  physData[8] = 1;
  const physType = Buffer.from("pHYs", "ascii");
  const physChunk = Buffer.alloc(12 + physData.length);
  physChunk.writeUInt32BE(physData.length, 0);
  physType.copy(physChunk, 4);
  physData.copy(physChunk, 8);
  physChunk.writeUInt32BE(crc32(Buffer.concat([physType, physData])), 8 + physData.length);
  const wrong = Buffer.concat([grayscale.subarray(0, insertAt), physChunk, grayscale.subarray(insertAt)]);
  replaceBytes(rows[0], wrong);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }), expectCode("output_png_srgb_missing"));
});

test("rejects content-hash and byte-size identity drift", async () => {
  const wrongHash = cloneArtifacts();
  wrongHash[0].contentHash = "0".repeat(64);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: wrongHash, dimensionManifest }), expectCode("output_artifact_content_hash_mismatch"));
  const wrongSize = cloneArtifacts();
  wrongSize[0].byteSize += 1;
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: wrongSize, dimensionManifest }), expectCode("output_artifact_byte_size_mismatch"));
});

test("EPS uses one-tenth physical points, not raster pixels, and rejects a forged BoundingBox", async () => {
  const expectedWidthPoints = (trimWidthInches + 10) * 0.1 * 72;
  const expectedHeightPoints = (trimHeightInches + 10) * 0.1 * 72;
  const text = formatBytes.eps.toString("ascii");
  assert.match(text, new RegExp(`%%BoundingBox: 0 0 ${Math.ceil(expectedWidthPoints)} ${Math.ceil(expectedHeightPoints)}`));
  assert.match(text, new RegExp(`%%HiResBoundingBox: 0 0 ${expectedWidthPoints} ${expectedHeightPoints}`));
  assert.doesNotMatch(text, new RegExp(`%%BoundingBox: 0 0 ${widthPixels} ${heightPixels}`));
  const rows = cloneArtifacts();
  const epsIndex = indexOf(rows, "driver", "eps");
  const forged = Buffer.from(text.replace(/^%%BoundingBox:.*$/m, "%%BoundingBox: 0 0 999 999"), "ascii");
  replaceBytes(rows[epsIndex], forged);
  await assert.rejects(() => verifyProductionOutputSet({ artifacts: rows, dimensionManifest }), expectCode("output_eps_bounding_box_invalid"));
});

test("EPS bytes and hashes are stable for identical raster input", () => {
  const rgb = Buffer.alloc(widthPixels * heightPixels * 3, 17);
  const first = buildDeterministicRasterEps({ rgb, widthPixels, heightPixels, trimWidthInches, trimHeightInches });
  const second = buildDeterministicRasterEps({ rgb, widthPixels, heightPixels, trimWidthInches, trimHeightInches });
  assert.ok(first.equals(second));
  assert.equal(sha256(first), sha256(second));
});

test("realistic 173×66-inch side geometry has an explicit single-worker resource envelope", () => {
  const plan = planEpsResources({ trimWidthInches: 173, trimHeightInches: 66 });
  assert.deepEqual([plan.widthPixels, plan.heightPixels], [27450, 11400]);
  assert.equal(plan.pixelCount, 312_930_000);
  assert.equal(plan.rawRgbBytes, 938_790_000);
  assert.equal(plan.allowed, true);
  assert.ok(plan.estimatedPeakBuilderBytes < 3_200_000_000);
  const tooLarge = planEpsResources({ trimWidthInches: 190, trimHeightInches: 80 });
  assert.equal(tooLarge.allowed, false);
  assert.ok(tooLarge.rawRgbBytes > 1_000_000_000);
});

function inspectZip(bytes) {
  const eocd = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(eocd), 0x06054b50);
  assert.equal(bytes.readUInt16LE(eocd + 20), 0);
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  assert.equal(centralOffset + centralSize, eocd);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const size = bytes.readUInt32LE(offset + 24);
    assert.equal(bytes.readUInt16LE(offset + 8), 0x0800);
    assert.equal(bytes.readUInt16LE(offset + 10), 0);
    assert.equal(bytes.readUInt16LE(offset + 12), FIXED_ZIP_DATE.dosTime);
    assert.equal(bytes.readUInt16LE(offset + 14), FIXED_ZIP_DATE.dosDate);
    assert.equal(bytes.readUInt32LE(offset + 38) >>> 16, FIXED_ZIP_MODE);
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50);
    assert.equal(bytes.readUInt16LE(localOffset + 6), 0x0800);
    assert.equal(bytes.readUInt16LE(localOffset + 8), 0);
    assert.equal(bytes.readUInt16LE(localOffset + 10), FIXED_ZIP_DATE.dosTime);
    assert.equal(bytes.readUInt16LE(localOffset + 12), FIXED_ZIP_DATE.dosDate);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    assert.equal(localExtraLength, 0);
    assert.equal(bytes.toString("utf8", localOffset + 30, localOffset + 30 + localNameLength), name);
    const body = bytes.subarray(localOffset + 30 + localNameLength, localOffset + 30 + localNameLength + size);
    assert.equal(bytes.readUInt32LE(offset + 16), crc32(body));
    entries.push({ name, body });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, eocd);
  return entries;
}

test("deterministic ZIP fixes order, timestamp, Unix mode, STORE method, and CRC", () => {
  const entries = [
    { name: "rear/rear.eps", bytes: Buffer.from("rear-eps") },
    { name: "driver/driver.png", bytes: Buffer.from("driver-png") },
    { name: "hood/hood.tiff", bytes: Buffer.from("hood-tiff") },
  ];
  const first = buildDeterministicZip(entries);
  const second = buildDeterministicZip([...entries].reverse());
  assert.ok(first.equals(second));
  assert.equal(sha256(first), sha256(second));
  const inspected = inspectZip(first);
  assert.deepEqual(inspected.map((entry) => entry.name), ["driver/driver.png", "hood/hood.tiff", "rear/rear.eps"]);
  assert.deepEqual(inspected.map((entry) => entry.body.toString()), ["driver-png", "hood-tiff", "rear-eps"]);
});

test("deterministic ZIP rejects duplicates and unsafe traversal names", () => {
  assert.throws(() => buildDeterministicZip([{ name: "same.txt", bytes: Buffer.from("a") }, { name: "same.txt", bytes: Buffer.from("b") }]), expectCode("output_zip_entry_duplicate"));
  assert.throws(() => buildDeterministicZip([{ name: "../escape.txt", bytes: Buffer.from("a") }]), expectCode("output_zip_entry_name_invalid"));
});

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function inspectZip64(bytes) {
  const eocdOffset = bytes.length - 22;
  const locatorOffset = eocdOffset - 20;
  const zip64EocdOffset = locatorOffset - 56;
  assert.equal(bytes.readUInt32LE(eocdOffset), 0x06054b50);
  assert.equal(bytes.readUInt32LE(locatorOffset), 0x07064b50);
  assert.equal(bytes.readUInt32LE(zip64EocdOffset), 0x06064b50);
  assert.equal(Number(bytes.readBigUInt64LE(locatorOffset + 8)), zip64EocdOffset);
  const count = Number(bytes.readBigUInt64LE(zip64EocdOffset + 32));
  const centralSize = Number(bytes.readBigUInt64LE(zip64EocdOffset + 40));
  const centralOffset = Number(bytes.readBigUInt64LE(zip64EocdOffset + 48));
  assert.equal(centralOffset + centralSize, zip64EocdOffset);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt16LE(offset + 6), 45);
    assert.equal(bytes.readUInt16LE(offset + 8), 0x0808);
    assert.equal(bytes.readUInt16LE(offset + 10), 0);
    assert.equal(bytes.readUInt16LE(offset + 12), FIXED_ZIP_DATE.dosTime);
    assert.equal(bytes.readUInt16LE(offset + 14), FIXED_ZIP_DATE.dosDate);
    assert.equal(bytes.readUInt32LE(offset + 38) >>> 16, FIXED_ZIP_MODE);
    assert.equal(bytes.readUInt32LE(offset + 20), 0xffffffff);
    assert.equal(bytes.readUInt32LE(offset + 24), 0xffffffff);
    assert.equal(bytes.readUInt32LE(offset + 42), 0xffffffff);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    const extraOffset = offset + 46 + nameLength;
    assert.equal(bytes.readUInt16LE(extraOffset), 0x0001);
    assert.equal(bytes.readUInt16LE(extraOffset + 2), 24);
    entries.push({
      name,
      size: bytes.readBigUInt64LE(extraOffset + 4),
      localOffset: bytes.readBigUInt64LE(extraOffset + 20),
    });
    offset += 46 + nameLength + extraLength;
  }
  assert.equal(offset, zip64EocdOffset);
  return entries;
}

test("streaming deterministic ZIP64 is byte-identical, ordered, and fixed-metadata", async () => {
  const source = [
    { name: "rear/rear.eps", bytes: Buffer.from("rear-eps") },
    { name: "driver/driver.png", bytes: Buffer.from("driver-png") },
    {
      name: "hood/hood.tiff",
      byteSize: 9,
      open: async () => (async function* chunks() { yield Buffer.from("hood-"); yield Buffer.from("tiff"); }()),
    },
  ];
  const first = await collect(createDeterministicZip64Stream(source));
  const second = await collect(createDeterministicZip64Stream([...source].reverse()));
  assert.ok(first.equals(second));
  assert.equal(sha256(first), sha256(second));
  const entries = inspectZip64(first);
  assert.deepEqual(entries.map((entry) => entry.name), ["driver/driver.png", "hood/hood.tiff", "rear/rear.eps"]);
  assert.deepEqual(entries.map((entry) => Number(entry.size)), [10, 9, 8]);
});

test("streaming ZIP64 rejects a source whose bytes drift from its declared size", async () => {
  const stream = createDeterministicZip64Stream([{ name: "bad.bin", byteSize: 2, open: async () => [Buffer.from("three")] }]);
  await assert.rejects(() => collect(stream), expectCode("output_zip_entry_size_mismatch"));
});
