import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, test } from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const {
  FILE_DPI,
  FIXED_ZIP_DATE,
  FIXED_ZIP_MODE,
  FORMATS,
  SURFACES,
  buildDeterministicRasterEps,
  buildDeterministicZip,
  createDeterministicZip64Stream,
  crc32,
  planEpsResources,
  sha256,
  verifyProductionOutputSet,
} = require("../../runtime/output-qc.cjs");

const trimWidthInches = 0.02;
const trimHeightInches = 0.04;
const widthPixels = Math.round((trimWidthInches + 10) * 150);
const heightPixels = Math.round((trimHeightInches + 10) * 150);

let dimensionManifest;
let validArtifacts;
let formatBytes;

function artifact(surfaceKey, format, bytes) {
  return {
    kind: "output",
    surfaceKey,
    storagePath: `designpro/user_00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/outputs/${surfaceKey}.${format === "tiff" ? "tiff" : format}`,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    metadata: {
      format,
      dpi: 1500,
      outputScale: 0.1,
      fullScaleBleedInches: 5,
      width: widthPixels,
      height: heightPixels,
    },
    bytes,
  };
}

function cloneArtifacts() {
  return validArtifacts.map((row) => ({ ...row, metadata: { ...row.metadata } }));
}

function replaceBytes(row, bytes) {
  row.bytes = bytes;
  row.byteSize = bytes.length;
  row.contentHash = sha256(bytes);
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
  const source = sharp({ create: { width: widthPixels, height: heightPixels, channels: 3, background: { r: 31, g: 117, b: 194 } } });
  const png = await source.clone().png({ compressionLevel: 9 }).withMetadata({ density: FILE_DPI }).toBuffer();
  const tiff = await source.clone().tiff({ compression: "lzw", predictor: "horizontal", bitdepth: 8 }).withMetadata({ density: FILE_DPI }).toBuffer();
  const rgb = Buffer.alloc(widthPixels * heightPixels * 3);
  for (let offset = 0; offset < rgb.length; offset += 3) {
    rgb[offset] = 31;
    rgb[offset + 1] = 117;
    rgb[offset + 2] = 194;
  }
  const eps = buildDeterministicRasterEps({ rgb, widthPixels, heightPixels, trimWidthInches, trimHeightInches });
  formatBytes = { png, tiff, eps };
  validArtifacts = SURFACES.flatMap((surfaceKey) => FORMATS.map((format) => artifact(surfaceKey, format, formatBytes[format])));
});

test("accepts exactly six surfaces times PNG/TIFF/EPS and returns a canonical stable receipt", async () => {
  const first = await verifyProductionOutputSet({ artifacts: validArtifacts, dimensionManifest });
  const second = await verifyProductionOutputSet({ artifacts: [...validArtifacts].reverse(), dimensionManifest });
  assert.equal(first.verified, true);
  assert.equal(first.fileCount, 18);
  assert.deepEqual(first.exactSurfaceSet, ["driver", "passenger", "hood", "roof", "front", "rear"]);
  assert.deepEqual(first.exactFormatSet, ["png", "tiff", "eps"]);
  assert.equal(first.outputSetHash, second.outputSetHash);
  assert.deepEqual(first.files.map(({ surfaceKey, format }) => `${surfaceKey}:${format}`), SURFACES.flatMap((surface) => FORMATS.map((format) => `${surface}:${format}`)));
  assert.ok(first.files.every((file) => file.widthPixels === widthPixels && file.heightPixels === heightPixels && file.dpi === 1500 && file.colorSpace === "sRGB"));
});

test("supports server-side byte loading without trusting artifact metadata", async () => {
  const rows = validArtifacts.map(({ bytes, ...row }) => row);
  const byPath = new Map(validArtifacts.map((row) => [row.storagePath, row.bytes]));
  const receipt = await verifyProductionOutputSet({ artifacts: rows, dimensionManifest, readBytes: async (row) => byPath.get(row.storagePath) });
  assert.equal(receipt.fileCount, 18);
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
  const epsIndex = rows.findIndex((row) => row.surfaceKey === "driver" && row.metadata.format === "eps");
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
