"use strict";

const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const { constants: zlibConstants, deflateSync, inflateSync } = require("node:zlib");
const sharp = require("sharp");

const SURFACES = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const FORMATS = Object.freeze(["png", "tiff", "eps"]);
const FULL_SCALE_PIXELS_PER_INCH = 150;
const FILE_DPI = 1500;
const OUTPUT_SCALE = 0.1;
const BLEED_INCHES_PER_EDGE = 5;
// THE PANEL DATA SLUG (owner, 2026-09-02). Every production file carries a
// 1.5" data strip on its TOP (leading) edge, outside the bleed, in the form of
// Brice's RIP band, rendered from the
// panel map (`panel-data-slug.cjs`). It is declared on the artifact and in the
// EPS header and verified here as exact geometry: the artwork is exactly
// trim + 10" at 150 px/in, the strip is exactly 225 px above it, and a file
// that does not declare the strip is not a production file.
const PANEL_DATA_SLUG = Object.freeze({
  contract: "designpro.panel-data-slug.v1",
  edge: "top",
  inches: 1.5,
  pixels: 1.5 * FULL_SCALE_PIXELS_PER_INCH,
});
const FIXED_ZIP_DATE = Object.freeze({ dosDate: 0x0021, dosTime: 0x0000 }); // 1980-01-01 00:00:00
const FIXED_ZIP_MODE = 0o100644;
const MAX_UINT32 = 0xffffffff;
const MAX_EPS_RAW_BYTES = 1_000_000_000;
const MAX_EPS_COMPRESSED_BYTES = 1_001_000_000;
const MAX_EPS_ENCODED_BYTES = 1_500_000_000;
const ASCII85_LINE_WIDTH = 100;

class OutputVerificationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OutputVerificationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new OutputVerificationError(code, message, details);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail("output_manifest_geometry_invalid", `${label} must be a positive finite number`);
  return number;
}

function exactRasterPixels(fullScaleInches, label) {
  const unrounded = (fullScaleInches + BLEED_INCHES_PER_EDGE * 2) * FULL_SCALE_PIXELS_PER_INCH;
  const rounded = Math.round(unrounded);
  if (Math.abs(unrounded - rounded) > 1e-7) {
    fail("output_manifest_geometry_unrepresentable", `${label} cannot be represented exactly at ${FULL_SCALE_PIXELS_PER_INCH} pixels per full-scale inch`, { fullScaleInches });
  }
  return rounded;
}

function conservativeDeflateBound(byteLength) {
  return byteLength + Math.ceil(byteLength / 16383) * 5 + 6;
}

function planEpsResources({ trimWidthInches, trimHeightInches }) {
  const width = finitePositive(trimWidthInches, "trimWidthInches");
  const height = finitePositive(trimHeightInches, "trimHeightInches");
  const widthPixels = exactRasterPixels(width, "trimWidthInches");
  const heightPixels = exactRasterPixels(height, "trimHeightInches");
  const pixelCount = widthPixels * heightPixels;
  if (!Number.isSafeInteger(pixelCount)) fail("output_eps_resource_limit", "EPS pixel count exceeds safe integer limits");
  const rawRgbBytes = pixelCount * 3;
  const worstCaseDeflateBytes = conservativeDeflateBound(rawRgbBytes);
  const worstCaseAscii85Characters = Math.ceil(worstCaseDeflateBytes / 4) * 5 + 2;
  const worstCaseAscii85Bytes = worstCaseAscii85Characters + Math.floor((worstCaseAscii85Characters - 1) / ASCII85_LINE_WIDTH);
  const estimatedPeakBuilderBytes = rawRgbBytes + worstCaseDeflateBytes + worstCaseAscii85Bytes + 16 * 1024 * 1024;
  return Object.freeze({
    widthPixels,
    heightPixels,
    pixelCount,
    rawRgbBytes,
    worstCaseDeflateBytes,
    worstCaseAscii85Bytes,
    estimatedPeakBuilderBytes,
    allowed: rawRgbBytes <= MAX_EPS_RAW_BYTES && worstCaseAscii85Bytes <= MAX_EPS_ENCODED_BYTES,
  });
}

function parseManifest(manifest) {
  const rows = manifest?.expectedSurfaces;
  if (!Array.isArray(rows) || rows.length !== SURFACES.length) {
    fail("output_manifest_surface_set_invalid", "The dimension manifest must contain exactly six production surfaces");
  }
  const bySurface = new Map();
  for (const row of rows) {
    const surfaceKey = String(row?.surfaceKey || "");
    if (!SURFACES.includes(surfaceKey)) fail("output_manifest_surface_unknown", `Unknown production surface: ${surfaceKey || "<empty>"}`);
    if (bySurface.has(surfaceKey)) fail("output_manifest_surface_duplicate", `Duplicate production surface: ${surfaceKey}`);
    const widthInches = finitePositive(row.widthInches, `${surfaceKey}.widthInches`);
    const heightInches = finitePositive(row.heightInches, `${surfaceKey}.heightInches`);
    const bleed = row.bleed;
    if (!bleed || !["top", "right", "bottom", "left"].every((edge) => Number(bleed[edge]) === BLEED_INCHES_PER_EDGE)) {
      fail("output_manifest_bleed_invalid", `${surfaceKey} must have exactly 5 inches of bleed on every edge`);
    }
    const trimSquareFeet = round2(widthInches * heightInches / 144);
    if (row.surfaceSqFt !== undefined && Number(row.surfaceSqFt) !== trimSquareFeet) {
      fail("output_manifest_square_feet_invalid", `${surfaceKey}.surfaceSqFt does not match raw trim geometry`, { expected: trimSquareFeet, observed: row.surfaceSqFt });
    }
    const heightPixels = exactRasterPixels(heightInches, `${surfaceKey}.heightInches`);
    bySurface.set(surfaceKey, Object.freeze({
      surfaceKey,
      widthInches,
      heightInches,
      trimSquareFeet,
      widthPixels: exactRasterPixels(widthInches, `${surfaceKey}.widthInches`),
      // The ARTWORK height: trim + bleed at 150 px/in. The file is taller by
      // the panel data slug, which is declared and verified separately.
      heightPixels,
      slugPixels: PANEL_DATA_SLUG.pixels,
      fileHeightPixels: heightPixels + PANEL_DATA_SLUG.pixels,
      outputWidthInches: (widthInches + BLEED_INCHES_PER_EDGE * 2) * OUTPUT_SCALE,
      outputHeightInches: (heightInches + BLEED_INCHES_PER_EDGE * 2) * OUTPUT_SCALE,
      outputWidthPoints: (widthInches + BLEED_INCHES_PER_EDGE * 2) * OUTPUT_SCALE * 72,
      outputHeightPoints: (heightInches + BLEED_INCHES_PER_EDGE * 2) * OUTPUT_SCALE * 72,
      fileHeightInches: (heightInches + BLEED_INCHES_PER_EDGE * 2 + PANEL_DATA_SLUG.inches) * OUTPUT_SCALE,
      fileHeightPoints: (heightInches + BLEED_INCHES_PER_EDGE * 2 + PANEL_DATA_SLUG.inches) * OUTPUT_SCALE * 72,
    }));
  }
  for (const surface of SURFACES) {
    if (!bySurface.has(surface)) fail("output_manifest_surface_missing", `Missing production surface: ${surface}`);
  }
  return bySurface;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Parts(parts) {
  let crc = 0xffffffff;
  for (const bytes of parts) for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(bytes) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (bytes.length < signature.length || !bytes.subarray(0, 8).equals(signature)) fail("output_png_magic_invalid", "PNG signature is invalid");
  const chunks = [];
  let offset = 8;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail("output_png_truncated", "PNG chunk header is truncated");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) fail("output_png_truncated", "PNG chunk payload is truncated");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const observedCrc = bytes.readUInt32BE(offset + 8 + length);
    const expectedCrc = crc32Parts([typeBytes, data]);
    if (observedCrc !== expectedCrc) fail("output_png_crc_invalid", `PNG ${type} chunk CRC is invalid`);
    chunks.push({ type, data });
    offset = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend || offset !== bytes.length) fail("output_png_trailing_or_missing_iend", "PNG must end exactly after IEND");
  if (chunks[0]?.type !== "IHDR" || chunks[0].data.length !== 13) fail("output_png_ihdr_invalid", "PNG IHDR is invalid");
  const ihdr = chunks[0].data;
  const phys = chunks.find((chunk) => chunk.type === "pHYs")?.data;
  if (!phys || phys.length !== 9) fail("output_png_density_missing", "PNG pHYs density declaration is missing");
  const expectedPpm = Math.round(FILE_DPI / 0.0254);
  if (phys.readUInt32BE(0) !== expectedPpm || phys.readUInt32BE(4) !== expectedPpm || phys[8] !== 1) {
    fail("output_png_density_invalid", `PNG density must be exactly ${FILE_DPI} DPI`);
  }
  if (!chunks.some((chunk) => chunk.type === "iCCP" || chunk.type === "sRGB")) fail("output_png_srgb_missing", "PNG must contain an embedded sRGB declaration");
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
  };
}

const TIFF_TYPE_BYTES = Object.freeze({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 });

function parseTiff(bytes) {
  if (bytes.length < 8) fail("output_tiff_truncated", "TIFF header is truncated");
  const order = bytes.toString("ascii", 0, 2);
  if (order !== "II" && order !== "MM") fail("output_tiff_magic_invalid", "TIFF byte-order signature is invalid");
  const little = order === "II";
  const u16 = (offset) => {
    if (offset < 0 || offset + 2 > bytes.length) fail("output_tiff_truncated", "TIFF SHORT is outside the file");
    return little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  };
  const u32 = (offset) => {
    if (offset < 0 || offset + 4 > bytes.length) fail("output_tiff_truncated", "TIFF LONG is outside the file");
    return little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  };
  if (u16(2) !== 42) fail("output_tiff_magic_invalid", "Only classic TIFF files are accepted");
  const ifdOffset = u32(4);
  const count = u16(ifdOffset);
  if (ifdOffset + 2 + count * 12 + 4 > bytes.length) fail("output_tiff_truncated", "TIFF IFD is truncated");
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = u16(entryOffset);
    const type = u16(entryOffset + 2);
    const valueCount = u32(entryOffset + 4);
    const elementBytes = TIFF_TYPE_BYTES[type];
    if (!elementBytes || valueCount === 0) continue;
    const byteLength = elementBytes * valueCount;
    const valueOffset = byteLength <= 4 ? entryOffset + 8 : u32(entryOffset + 8);
    if (valueOffset + byteLength > bytes.length) fail("output_tiff_truncated", `TIFF tag ${tag} points outside the file`);
    if (entries.has(tag)) fail("output_tiff_tag_duplicate", `TIFF tag ${tag} is duplicated`);
    entries.set(tag, { type, count: valueCount, offset: valueOffset, byteLength });
  }
  const scalar = (tag) => {
    const entry = entries.get(tag);
    if (!entry || entry.count !== 1 || ![3, 4].includes(entry.type)) fail("output_tiff_tag_missing", `TIFF scalar tag ${tag} is missing`);
    return entry.type === 3 ? u16(entry.offset) : u32(entry.offset);
  };
  const rational = (tag) => {
    const entry = entries.get(tag);
    if (!entry || entry.type !== 5 || entry.count !== 1) fail("output_tiff_tag_missing", `TIFF rational tag ${tag} is missing`);
    const numerator = u32(entry.offset);
    const denominator = u32(entry.offset + 4);
    if (!denominator) fail("output_tiff_density_invalid", `TIFF resolution tag ${tag} has a zero denominator`);
    return numerator / denominator;
  };
  const profile = entries.get(34675);
  if (!profile || profile.byteLength < 128) fail("output_tiff_srgb_missing", "TIFF ICC profile is missing");
  return {
    width: scalar(256),
    height: scalar(257),
    xResolution: rational(282),
    yResolution: rational(283),
    resolutionUnit: scalar(296),
    profileBytes: bytes.subarray(profile.offset, profile.offset + profile.byteLength),
  };
}

function assertSrgbProfile(metadata, format) {
  if (metadata.space !== "srgb" || metadata.channels !== 3 || metadata.depth !== "uchar" || metadata.bitsPerSample !== 8) {
    fail(`output_${format}_color_invalid`, `${format.toUpperCase()} must decode as 8-bit three-channel sRGB`);
  }
  const profile = metadata.icc;
  if (!metadata.hasProfile || !Buffer.isBuffer(profile) || profile.length < 128 || profile.toString("ascii", 36, 40) !== "acsp") {
    fail(`output_${format}_srgb_missing`, `${format.toUpperCase()} must contain a valid embedded ICC profile`);
  }
  const normalizedDescription = profile.toString("latin1").replace(/\0/g, "").toLowerCase();
  if (!normalizedDescription.includes("srgb") && !normalizedDescription.includes("iec61966")) {
    fail(`output_${format}_srgb_missing`, `${format.toUpperCase()} ICC profile is not declared sRGB`);
  }
}

async function verifyRaster(bytes, format, geometry) {
  let parsed;
  if (format === "png") parsed = parsePng(bytes);
  else parsed = parseTiff(bytes);
  let metadata;
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: false, sequentialRead: true });
    metadata = await image.metadata();
    await image.stats(); // Force a real decode, not just header recognition.
  } catch (error) {
    fail(`output_${format}_decode_failed`, `${format.toUpperCase()} could not be decoded`, { cause: error.message });
  }
  if (metadata.format !== format || metadata.width !== geometry.widthPixels || metadata.height !== geometry.fileHeightPixels) {
    fail("output_raster_geometry_invalid", `${geometry.surfaceKey}.${format} pixel geometry is incorrect`, { expected: [geometry.widthPixels, geometry.fileHeightPixels], observed: [metadata.width, metadata.height] });
  }
  if (parsed.width !== geometry.widthPixels || parsed.height !== geometry.fileHeightPixels) {
    fail("output_raster_header_geometry_invalid", `${geometry.surfaceKey}.${format} header geometry is incorrect`);
  }
  if (metadata.density !== FILE_DPI || metadata.resolutionUnit !== "inch") {
    fail("output_raster_density_invalid", `${geometry.surfaceKey}.${format} must declare exactly ${FILE_DPI} DPI in inches`);
  }
  assertSrgbProfile(metadata, format);
  if (format === "png" && (parsed.bitDepth !== 8 || parsed.colorType !== 2)) fail("output_png_color_invalid", "PNG IHDR must declare 8-bit truecolor sRGB without palette or alpha");
  if (format === "tiff") {
    if (parsed.width !== metadata.width || parsed.height !== metadata.height || parsed.resolutionUnit !== 2 || parsed.xResolution !== FILE_DPI || parsed.yResolution !== FILE_DPI) {
      fail("output_tiff_density_invalid", `TIFF tags must declare exact ${FILE_DPI} DPI inch resolution`);
    }
    if (!parsed.profileBytes.equals(metadata.icc)) fail("output_tiff_icc_mismatch", "TIFF ICC tag does not match the decoded profile");
  }
  return { widthPixels: metadata.width, heightPixels: metadata.height, dpi: metadata.density, colorSpace: "sRGB" };
}

function decimal(value) {
  const text = Number(value).toFixed(6).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "");
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

function ascii85CharacterCount(bytes) {
  let characters = 2; // ~>
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const value = bytes.readUInt32BE(offset);
    characters += value === 0 ? 1 : 5;
    offset += 4;
  }
  if (offset < bytes.length) characters += bytes.length - offset + 1;
  return characters;
}

function writeAscii85(bytes, target, startOffset) {
  let outputOffset = startOffset;
  let column = 0;
  const emit = (character) => {
    if (column === ASCII85_LINE_WIDTH) {
      target[outputOffset++] = 0x0a;
      column = 0;
    }
    target[outputOffset++] = character;
    column += 1;
  };
  const emitTuple = (value, count) => {
    const digits = new Uint8Array(5);
    let remaining = value;
    for (let index = 4; index >= 0; index -= 1) {
      digits[index] = (remaining % 85) + 33;
      remaining = Math.floor(remaining / 85);
    }
    for (let index = 0; index < count; index += 1) emit(digits[index]);
  };
  let inputOffset = 0;
  while (inputOffset + 4 <= bytes.length) {
    const value = bytes.readUInt32BE(inputOffset);
    if (value === 0) emit(0x7a);
    else emitTuple(value, 5);
    inputOffset += 4;
  }
  const remaining = bytes.length - inputOffset;
  if (remaining) {
    let value = 0;
    for (let index = 0; index < 4; index += 1) value = value * 256 + (index < remaining ? bytes[inputOffset + index] : 0);
    emitTuple(value, remaining + 1);
  }
  if (column > ASCII85_LINE_WIDTH - 2) {
    target[outputOffset++] = 0x0a;
    column = 0;
  }
  emit(0x7e);
  emit(0x3e);
  return outputOffset;
}

function decodeAscii85(encoded, expectedDecodedLength) {
  if (encoded.length < 2 || encoded.length > MAX_EPS_ENCODED_BYTES) fail("output_eps_resource_limit", "EPS ASCII85 payload exceeds the verified resource envelope");
  if (!Number.isSafeInteger(expectedDecodedLength) || expectedDecodedLength <= 0 || expectedDecodedLength > MAX_EPS_COMPRESSED_BYTES) fail("output_eps_resource_limit", "EPS compressed length exceeds the verified resource envelope");
  let groupLength = 0;
  let decodedLength = 0;
  let column = 0;
  let sawTerminator = false;
  for (let offset = 0; offset < encoded.length; offset += 1) {
    const byte = encoded[offset];
    if (byte === 0x0a) {
      const finalTerminatorWrap = column === ASCII85_LINE_WIDTH - 1 && offset + 2 === encoded.length - 1 && encoded[offset + 1] === 0x7e && encoded[offset + 2] === 0x3e;
      if (column !== ASCII85_LINE_WIDTH && !finalTerminatorWrap) fail("output_eps_raster_encoding_invalid", "Only canonical 100-character ASCII85 lines may be wrapped");
      column = 0;
      continue;
    }
    column += 1;
    if (column > ASCII85_LINE_WIDTH) fail("output_eps_raster_encoding_invalid", "ASCII85 line exceeds 100 characters");
    if (byte === 0x7e) {
      if (offset + 1 !== encoded.length - 1 || encoded[offset + 1] !== 0x3e) fail("output_eps_raster_encoding_invalid", "ASCII85 terminator is misplaced");
      column += 1;
      if (column > ASCII85_LINE_WIDTH) fail("output_eps_raster_encoding_invalid", "ASCII85 terminator crosses a noncanonical line boundary");
      sawTerminator = true;
      if (groupLength === 1) fail("output_eps_raster_encoding_invalid", "ASCII85 final group is invalid");
      if (groupLength > 1) decodedLength += groupLength - 1;
      if (decodedLength !== expectedDecodedLength) fail("output_eps_raster_length_invalid", "EPS ASCII85 payload does not match its declared compressed length");
      break;
    }
    if (byte === 0x7a) {
      if (groupLength !== 0) fail("output_eps_raster_encoding_invalid", "ASCII85 z abbreviation is outside a tuple boundary");
      decodedLength += 4;
      if (decodedLength > expectedDecodedLength) fail("output_eps_raster_length_invalid", "EPS ASCII85 payload exceeds its declared compressed length");
      continue;
    }
    if (byte < 0x21 || byte > 0x75) fail("output_eps_raster_encoding_invalid", "EPS raster contains a non-ASCII85 byte");
    groupLength += 1;
    if (groupLength === 5) {
      decodedLength += 4;
      if (decodedLength > expectedDecodedLength) fail("output_eps_raster_length_invalid", "EPS ASCII85 payload exceeds its declared compressed length");
      groupLength = 0;
    }
  }
  if (!sawTerminator) fail("output_eps_raster_encoding_invalid", "ASCII85 terminator is missing");
  const output = Buffer.allocUnsafe(decodedLength);
  let outputOffset = 0;
  let value = 0;
  groupLength = 0;
  const flush = (count, final = false) => {
    let padded = value;
    for (let index = count; index < 5; index += 1) padded = padded * 85 + 84;
    if (padded > MAX_UINT32) fail("output_eps_raster_encoding_invalid", "ASCII85 tuple exceeds 32-bit range");
    const tuple = Buffer.allocUnsafe(4);
    tuple.writeUInt32BE(padded >>> 0);
    const take = final ? count - 1 : 4;
    tuple.copy(output, outputOffset, 0, take);
    outputOffset += take;
    value = 0;
    groupLength = 0;
  };
  for (let offset = 0; offset < encoded.length; offset += 1) {
    const byte = encoded[offset];
    if (byte === 0x0a) continue;
    if (byte === 0x7e) {
      if (groupLength) flush(groupLength, true);
      break;
    }
    if (byte === 0x7a) {
      output.fill(0, outputOffset, outputOffset + 4);
      outputOffset += 4;
      continue;
    }
    value = value * 85 + (byte - 33);
    groupLength += 1;
    if (groupLength === 5) {
      if (value === 0) fail("output_eps_raster_encoding_invalid", "Zero ASCII85 tuples must use the canonical z abbreviation");
      flush(5, false);
    }
  }
  if (outputOffset !== output.length) fail("output_eps_raster_encoding_invalid", "ASCII85 decoded length is inconsistent");
  return output;
}

function buildDeterministicRasterEps({ rgb, widthPixels, heightPixels, trimWidthInches, trimHeightInches, slug }) {
  const raster = Buffer.isBuffer(rgb) ? rgb : (rgb instanceof Uint8Array ? Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength) : Buffer.alloc(0));
  if (!Number.isInteger(widthPixels) || !Number.isInteger(heightPixels) || widthPixels <= 0 || heightPixels <= 0 || raster.length !== widthPixels * heightPixels * 3) {
    fail("output_eps_raster_invalid", "EPS raster bytes must be exact width × height × 3 RGB bytes");
  }
  const resourcePlan = planEpsResources({ trimWidthInches, trimHeightInches });
  if (!resourcePlan.allowed) fail("output_eps_resource_limit", "EPS geometry exceeds the single-worker deterministic memory/file envelope", resourcePlan);
  if (!slug || slug.edge !== PANEL_DATA_SLUG.edge || Number(slug.inches) !== PANEL_DATA_SLUG.inches || Number(slug.pixels) !== PANEL_DATA_SLUG.pixels) {
    fail("output_eps_slug_required", `EPS output must carry the panel data slug: ${PANEL_DATA_SLUG.edge} edge, ${PANEL_DATA_SLUG.inches} in, ${PANEL_DATA_SLUG.pixels} px`);
  }
  const expectedWidth = resourcePlan.widthPixels;
  const expectedHeight = resourcePlan.heightPixels + PANEL_DATA_SLUG.pixels;
  if (widthPixels !== expectedWidth || heightPixels !== expectedHeight) fail("output_eps_raster_geometry_invalid", "EPS raster dimensions do not match 1:10 geometry with 5-inch bleed plus the panel data slug");
  const compressed = deflateSync(raster, { level: 9, windowBits: 15, memLevel: 8, strategy: zlibConstants.Z_DEFAULT_STRATEGY });
  const encodedCharacters = ascii85CharacterCount(compressed);
  const maximumEncodedBytes = encodedCharacters + Math.ceil(encodedCharacters / ASCII85_LINE_WIDTH) + 1;
  if (maximumEncodedBytes > MAX_EPS_ENCODED_BYTES) fail("output_eps_resource_limit", "Compressed EPS exceeds the deterministic file-size envelope", { maximumEncodedBytes });
  const widthPoints = (Number(trimWidthInches) + 10) * OUTPUT_SCALE * 72;
  const heightPoints = (Number(trimHeightInches) + 10 + PANEL_DATA_SLUG.inches) * OUTPUT_SCALE * 72;
  const header = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(widthPoints - 1e-9)} ${Math.ceil(heightPoints - 1e-9)}`,
    `%%HiResBoundingBox: 0 0 ${decimal(widthPoints)} ${decimal(heightPoints)}`,
    "%%LanguageLevel: 2",
    "%%DocumentData: Clean7Bit",
    "%%Pages: 1",
    "%%Creator: DesignProAI deterministic output builder",
    "%%DesignProAI-ColorSpace: sRGB",
    `%%DesignProAI-Density: ${FILE_DPI}`,
    `%%DesignProAI-OutputScale: ${OUTPUT_SCALE}`,
    `%%DesignProAI-FullScaleBleedInches: ${BLEED_INCHES_PER_EDGE}`,
    `%%DesignProAI-PanelDataSlug: ${PANEL_DATA_SLUG.edge} ${PANEL_DATA_SLUG.inches} ${PANEL_DATA_SLUG.pixels}`,
    `%%DesignProAI-ArtworkHeightPixels: ${resourcePlan.heightPixels}`,
    `%%DesignProAI-RasterGeometry: ${widthPixels} ${heightPixels} 3 8`,
    `%%DesignProAI-Raster-SHA256: ${sha256(raster)}`,
    "%%DesignProAI-Compression: ASCII85Decode+FlateDecode",
    `%%DesignProAI-Compressed-SHA256: ${sha256(compressed)}`,
    `%%DesignProAI-Compressed-Bytes: ${compressed.length}`,
    "%%EndComments",
    "%%Page: 1 1",
    "gsave",
    "/DeviceRGB setcolorspace",
    `${decimal(widthPoints)} ${decimal(heightPoints)} scale`,
    "/picstr 32760 string def",
    `${widthPixels} ${heightPixels} 8`,
    `[${widthPixels} 0 0 -${heightPixels} 0 ${heightPixels}]`,
    "%%BeginDesignProRaster",
    "/Data currentfile /ASCII85Decode filter /FlateDecode filter def",
    "{Data picstr readstring pop}",
    "false 3 colorimage",
  ].join("\n");
  const headerBytes = Buffer.from(`${header}\n`, "ascii");
  const trailerBytes = Buffer.from("\n%%EndDesignProRaster\ngrestore\nshowpage\n%%EOF\n", "ascii");
  const result = Buffer.allocUnsafe(headerBytes.length + maximumEncodedBytes + trailerBytes.length);
  headerBytes.copy(result, 0);
  const end = writeAscii85(compressed, result, headerBytes.length);
  trailerBytes.copy(result, end);
  return result.subarray(0, end + trailerBytes.length);
}

function uniqueHeaderValue(header, name) {
  const prefix = `${name}:`;
  const matches = header.split("\n").filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) fail("output_eps_header_invalid", `EPS must contain exactly one ${name} declaration`);
  return matches[0].slice(prefix.length).trim();
}

function numericTuple(text, length, label) {
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length !== length || values.some((value) => !Number.isFinite(value))) fail("output_eps_header_invalid", `${label} is invalid`);
  return values;
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= 0.000001;
}

function verifyEps(bytes, geometry) {
  if (bytes.length < 32 || bytes.toString("ascii", 0, 23) !== "%!PS-Adobe-3.0 EPSF-3.0") fail("output_eps_magic_invalid", "EPS magic/header is invalid");
  for (const byte of bytes) if (byte > 0x7f || byte === 0) fail("output_eps_binary_invalid", "EPS must be deterministic Clean7Bit ASCII");
  const eof = Buffer.from("%%EOF\n", "ascii");
  if (!bytes.subarray(bytes.length - eof.length).equals(eof)) fail("output_eps_eof_invalid", "EPS must end exactly with %%EOF and one newline");
  const endComments = Buffer.from("%%EndComments\n", "ascii");
  const headerEnd = bytes.indexOf(endComments);
  if (headerEnd < 0) fail("output_eps_header_invalid", "EPS EndComments marker is missing");
  if (headerEnd > 16 * 1024) fail("output_eps_header_invalid", "EPS header is unreasonably large");
  const header = bytes.toString("ascii", 0, headerEnd);
  const boundingBox = numericTuple(uniqueHeaderValue(header, "%%BoundingBox"), 4, "EPS BoundingBox");
  const hires = numericTuple(uniqueHeaderValue(header, "%%HiResBoundingBox"), 4, "EPS HiResBoundingBox");
  const expectedBox = [0, 0, Math.ceil(geometry.outputWidthPoints - 1e-9), Math.ceil(geometry.fileHeightPoints - 1e-9)];
  if (!boundingBox.every((value, index) => value === expectedBox[index])) fail("output_eps_bounding_box_invalid", "EPS BoundingBox is not the enclosing 1:10 point geometry", { expected: expectedBox, observed: boundingBox });
  const expectedHiRes = [0, 0, geometry.outputWidthPoints, geometry.fileHeightPoints];
  if (!hires.every((value, index) => nearlyEqual(value, expectedHiRes[index]))) fail("output_eps_hires_bounding_box_invalid", "EPS HiResBoundingBox is not exact 1:10 point geometry", { expected: expectedHiRes, observed: hires });
  if (uniqueHeaderValue(header, "%%DesignProAI-ColorSpace") !== "sRGB" || bytes.indexOf(Buffer.from("\n/DeviceRGB setcolorspace\n")) < 0) fail("output_eps_srgb_missing", "EPS must explicitly declare the deterministic sRGB/DeviceRGB contract");
  if (Number(uniqueHeaderValue(header, "%%DesignProAI-Density")) !== FILE_DPI || Number(uniqueHeaderValue(header, "%%DesignProAI-OutputScale")) !== OUTPUT_SCALE || Number(uniqueHeaderValue(header, "%%DesignProAI-FullScaleBleedInches")) !== BLEED_INCHES_PER_EDGE) {
    fail("output_eps_physical_contract_invalid", "EPS physical-scale declarations are invalid");
  }
  if (uniqueHeaderValue(header, "%%DesignProAI-PanelDataSlug") !== `${PANEL_DATA_SLUG.edge} ${PANEL_DATA_SLUG.inches} ${PANEL_DATA_SLUG.pixels}`) {
    fail("output_eps_slug_invalid", "EPS does not declare the panel data slug contract");
  }
  if (Number(uniqueHeaderValue(header, "%%DesignProAI-ArtworkHeightPixels")) !== geometry.heightPixels) fail("output_eps_slug_invalid", "EPS artwork height does not match the production geometry");
  const rasterGeometry = numericTuple(uniqueHeaderValue(header, "%%DesignProAI-RasterGeometry"), 4, "EPS raster geometry");
  if (rasterGeometry[0] !== geometry.widthPixels || rasterGeometry[1] !== geometry.fileHeightPixels || rasterGeometry[2] !== 3 || rasterGeometry[3] !== 8) fail("output_eps_raster_geometry_invalid", "EPS raster geometry is incorrect");
  const declaredHash = uniqueHeaderValue(header, "%%DesignProAI-Raster-SHA256");
  if (!/^[0-9a-f]{64}$/.test(declaredHash)) fail("output_eps_raster_hash_invalid", "EPS raster hash declaration is invalid");
  if (uniqueHeaderValue(header, "%%DesignProAI-Compression") !== "ASCII85Decode+FlateDecode") fail("output_eps_compression_invalid", "EPS must use deterministic ASCII85 + Flate compression");
  const declaredCompressedHash = uniqueHeaderValue(header, "%%DesignProAI-Compressed-SHA256");
  const declaredCompressedBytes = Number(uniqueHeaderValue(header, "%%DesignProAI-Compressed-Bytes"));
  if (!/^[0-9a-f]{64}$/.test(declaredCompressedHash) || !Number.isSafeInteger(declaredCompressedBytes) || declaredCompressedBytes <= 0) fail("output_eps_compression_invalid", "EPS compressed identity is invalid");
  const filterContract = Buffer.from("\n/Data currentfile /ASCII85Decode filter /FlateDecode filter def\n{Data picstr readstring pop}\n", "ascii");
  if (bytes.indexOf(filterContract, headerEnd) < 0) fail("output_eps_compression_invalid", "EPS PostScript filter contract is missing");
  const dataStartMarker = Buffer.from("false 3 colorimage\n", "ascii");
  const exactTrailer = Buffer.from("\n%%EndDesignProRaster\ngrestore\nshowpage\n%%EOF\n", "ascii");
  if (bytes.length < exactTrailer.length || !bytes.subarray(bytes.length - exactTrailer.length).equals(exactTrailer)) fail("output_eps_raster_delimiter_invalid", "EPS deterministic trailer is invalid");
  const dataStart = bytes.indexOf(dataStartMarker, headerEnd);
  const dataEnd = bytes.length - exactTrailer.length;
  if (dataStart < 0 || dataStart > headerEnd + 4096 || dataEnd <= dataStart + dataStartMarker.length) fail("output_eps_raster_delimiter_invalid", "EPS raster delimiters are invalid");
  const encoded = bytes.subarray(dataStart + dataStartMarker.length, dataEnd);
  const compressed = decodeAscii85(encoded, declaredCompressedBytes);
  if (compressed.length !== declaredCompressedBytes || sha256(compressed) !== declaredCompressedHash) fail("output_eps_compression_invalid", "EPS compressed bytes do not match their declaration");
  const expectedBytes = geometry.widthPixels * geometry.fileHeightPixels * 3;
  if (expectedBytes > MAX_EPS_RAW_BYTES) fail("output_eps_resource_limit", "EPS decoded raster exceeds the verified resource envelope");
  let raster;
  try {
    raster = inflateSync(compressed, { windowBits: 15, maxOutputLength: expectedBytes });
  } catch (error) {
    fail("output_eps_raster_decode_failed", "EPS Flate raster could not be decoded inside its exact bound", { cause: error.message });
  }
  if (raster.length !== expectedBytes || sha256(raster) !== declaredHash) fail("output_eps_raster_hash_invalid", "EPS raster bytes do not match the declared hash");
  return { widthPixels: geometry.widthPixels, heightPixels: geometry.fileHeightPixels, dpi: FILE_DPI, colorSpace: "sRGB", boundingBoxPoints: boundingBox, highResolutionBoundingBoxPoints: hires, rasterHash: declaredHash };
}

function normalizeStoragePath(value) {
  const path = String(value || "");
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..") || /[\u0000-\u001f\u007f]/.test(path)) {
    fail("output_storage_path_invalid", `Unsafe output storage path: ${path || "<empty>"}`);
  }
  return path;
}

function normalizeArtifact(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  const surfaceKey = String(row?.surfaceKey ?? row?.surface_key ?? "");
  const format = String(metadata.format ?? row?.format ?? "").toLowerCase();
  const kind = String(row?.kind ?? row?.artifact_kind ?? "");
  const storagePath = normalizeStoragePath(row?.storagePath ?? row?.storage_path);
  const contentHash = String(row?.contentHash ?? row?.content_hash ?? "");
  const byteSize = Number(row?.byteSize ?? row?.byte_size);
  if (kind !== "output") fail("output_artifact_kind_invalid", `${storagePath} is not an output artifact`);
  if (!SURFACES.includes(surfaceKey)) fail("output_artifact_surface_invalid", `${storagePath} has an invalid surface identity`);
  if (!FORMATS.includes(format)) fail("output_artifact_format_invalid", `${storagePath} has an invalid format identity`);
  if (!storagePath.toLowerCase().endsWith(format === "tiff" ? ".tiff" : `.${format}`)) fail("output_artifact_extension_invalid", `${storagePath} extension does not match ${format}`);
  if (!/^[0-9a-f]{64}$/.test(contentHash)) fail("output_artifact_hash_invalid", `${storagePath} has an invalid SHA-256 identity`);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) fail("output_artifact_size_invalid", `${storagePath} has an invalid byte size`);
  if (Number(metadata.dpi) !== FILE_DPI || Number(metadata.outputScale) !== OUTPUT_SCALE || Number(metadata.fullScaleBleedInches) !== BLEED_INCHES_PER_EDGE) {
    fail("output_artifact_physical_metadata_invalid", `${storagePath} metadata does not declare 1500 DPI, 1:10 scale, and 5-inch bleed`);
  }
  if (metadata.slugContract !== PANEL_DATA_SLUG.contract || metadata.slugEdge !== PANEL_DATA_SLUG.edge
    || Number(metadata.slugInches) !== PANEL_DATA_SLUG.inches || Number(metadata.slugPixels) !== PANEL_DATA_SLUG.pixels) {
    fail("output_artifact_slug_missing", `${storagePath} does not declare the panel data slug (${PANEL_DATA_SLUG.edge} edge, ${PANEL_DATA_SLUG.inches} in, ${PANEL_DATA_SLUG.pixels} px)`);
  }
  return { row, metadata, surfaceKey, format, kind, storagePath, contentHash, byteSize };
}

async function artifactBytes(artifact, readBytes) {
  const source = artifact.row.bytes ?? artifact.row.body;
  const loaded = source === undefined ? await readBytes?.(artifact.row) : source;
  if (!(Buffer.isBuffer(loaded) || loaded instanceof Uint8Array)) fail("output_artifact_bytes_missing", `${artifact.storagePath} bytes are unavailable`);
  return Buffer.isBuffer(loaded) ? loaded : Buffer.from(loaded.buffer, loaded.byteOffset, loaded.byteLength);
}

async function verifyProductionOutputSet({ artifacts, dimensionManifest, readBytes } = {}) {
  if (!Array.isArray(artifacts) || artifacts.length !== SURFACES.length * FORMATS.length) {
    fail("output_artifact_count_invalid", `Exactly ${SURFACES.length * FORMATS.length} output artifacts are required`);
  }
  const manifest = parseManifest(dimensionManifest);
  const normalized = artifacts.map(normalizeArtifact);
  const identities = new Map();
  const paths = new Set();
  for (const artifact of normalized) {
    const identity = `${artifact.surfaceKey}:${artifact.format}`;
    if (identities.has(identity)) fail("output_artifact_duplicate", `Duplicate output artifact: ${identity}`);
    if (paths.has(artifact.storagePath)) fail("output_artifact_path_duplicate", `Duplicate output storage path: ${artifact.storagePath}`);
    identities.set(identity, artifact);
    paths.add(artifact.storagePath);
  }
  const files = [];
  for (const surfaceKey of SURFACES) {
    const geometry = manifest.get(surfaceKey);
    for (const format of FORMATS) {
      const artifact = identities.get(`${surfaceKey}:${format}`);
      if (!artifact) fail("output_artifact_missing", `Missing output artifact: ${surfaceKey}:${format}`);
      if (Number(artifact.metadata.width) !== geometry.widthPixels || Number(artifact.metadata.height) !== geometry.fileHeightPixels
        || Number(artifact.metadata.artworkHeightPixels) !== geometry.heightPixels) {
        fail("output_artifact_metadata_geometry_invalid", `${artifact.storagePath} metadata geometry is incorrect`);
      }
      const bytes = await artifactBytes(artifact, readBytes);
      if (bytes.length !== artifact.byteSize) fail("output_artifact_byte_size_mismatch", `${artifact.storagePath} byte size changed`, { expected: artifact.byteSize, observed: bytes.length });
      const observedHash = sha256(bytes);
      if (observedHash !== artifact.contentHash) fail("output_artifact_content_hash_mismatch", `${artifact.storagePath} content hash changed`, { expected: artifact.contentHash, observed: observedHash });
      const decoded = format === "eps" ? verifyEps(bytes, geometry) : await verifyRaster(bytes, format, geometry);
      files.push(Object.freeze({
        surfaceKey,
        format,
        storagePath: artifact.storagePath,
        contentHash: observedHash,
        byteSize: bytes.length,
        widthPixels: geometry.widthPixels,
        heightPixels: geometry.fileHeightPixels,
        artworkHeightPixels: geometry.heightPixels,
        slugEdge: PANEL_DATA_SLUG.edge,
        slugInches: PANEL_DATA_SLUG.inches,
        slugPixels: PANEL_DATA_SLUG.pixels,
        trimWidthInches: geometry.widthInches,
        trimHeightInches: geometry.heightInches,
        trimSquareFeet: geometry.trimSquareFeet,
        fullScaleBleedInches: BLEED_INCHES_PER_EDGE,
        outputScale: OUTPUT_SCALE,
        dpi: FILE_DPI,
        colorSpace: decoded.colorSpace,
        outputWidthPoints: geometry.outputWidthPoints,
        outputHeightPoints: geometry.outputHeightPoints,
      }));
    }
  }
  const receiptBody = {
    contract: "designpro.output-verification.v2",
    exactSurfaceSet: SURFACES,
    exactFormatSet: FORMATS,
    fileCount: files.length,
    fullScalePixelsPerInch: FULL_SCALE_PIXELS_PER_INCH,
    fileDpi: FILE_DPI,
    outputScale: OUTPUT_SCALE,
    fullScaleBleedInchesPerEdge: BLEED_INCHES_PER_EDGE,
    panelDataSlug: PANEL_DATA_SLUG,
    files,
  };
  return Object.freeze({ ...receiptBody, verified: true, outputHashes: files.map((file) => file.contentHash), outputSetHash: sha256(Buffer.from(stableJson(receiptBody))) });
}

function normalizeZipName(value) {
  const name = String(value || "");
  if (!name || name !== name.normalize("NFC") || name.startsWith("/") || name.endsWith("/") || name.includes("\\") || Buffer.byteLength(name, "utf8") > 0xffff || name.split("/").some((part) => !part || part === "." || part === "..") || /[\u0000-\u001f\u007f]/.test(name)) {
    fail("output_zip_entry_name_invalid", `Unsafe ZIP entry name: ${name || "<empty>"}`);
  }
  return name;
}

function zipLocalHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosTime, 10);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.bytes.length, 18);
  header.writeUInt32LE(entry.bytes.length, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function zipCentralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4); // Unix, ZIP 2.0
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosTime, 12);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.bytes.length, 20);
  header.writeUInt32LE(entry.bytes.length, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((FIXED_ZIP_MODE << 16) >>> 0, 38);
  header.writeUInt32LE(entry.localOffset, 42);
  return header;
}

function buildDeterministicZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 0xffff) fail("output_zip_entry_set_invalid", "ZIP requires between 1 and 65535 entries");
  const seen = new Set();
  const normalized = entries.map((entry) => {
    const name = normalizeZipName(entry?.name);
    if (seen.has(name)) fail("output_zip_entry_duplicate", `Duplicate ZIP entry: ${name}`);
    seen.add(name);
    if (!(Buffer.isBuffer(entry?.bytes) || entry?.bytes instanceof Uint8Array)) fail("output_zip_entry_bytes_invalid", `${name} bytes are invalid`);
    const bytes = Buffer.from(entry.bytes);
    if (bytes.length > MAX_UINT32) fail("output_zip_zip64_required", `${name} exceeds deterministic ZIP32 limits`);
    return { name, nameBytes: Buffer.from(name, "utf8"), bytes, crc: crc32(bytes), localOffset: 0 };
  }).sort((left, right) => Buffer.compare(left.nameBytes, right.nameBytes));
  const localParts = [];
  let localOffset = 0;
  for (const entry of normalized) {
    entry.localOffset = localOffset;
    const header = zipLocalHeader(entry);
    localParts.push(header, entry.nameBytes, entry.bytes);
    localOffset += header.length + entry.nameBytes.length + entry.bytes.length;
    if (localOffset > MAX_UINT32) fail("output_zip_zip64_required", "ZIP content exceeds deterministic ZIP32 limits");
  }
  const centralParts = [];
  let centralSize = 0;
  for (const entry of normalized) {
    const header = zipCentralHeader(entry);
    centralParts.push(header, entry.nameBytes);
    centralSize += header.length + entry.nameBytes.length;
  }
  if (centralSize > MAX_UINT32 || localOffset + centralSize + 22 > MAX_UINT32) fail("output_zip_zip64_required", "ZIP directory exceeds deterministic ZIP32 limits");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(normalized.length, 8);
  eocd.writeUInt16LE(normalized.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function zip64Extra(values) {
  const data = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => data.writeBigUInt64LE(BigInt(value), index * 8));
  const extra = Buffer.alloc(4 + data.length);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(data.length, 2);
  data.copy(extra, 4);
  return extra;
}

function zip64LocalHeader(entry) {
  const extra = zip64Extra([entry.size, entry.size]);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(0x0808, 6); // UTF-8 + data descriptor
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosTime, 10);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosDate, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(MAX_UINT32, 18);
  header.writeUInt32LE(MAX_UINT32, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  header.writeUInt16LE(extra.length, 28);
  return Buffer.concat([header, entry.nameBytes, extra]);
}

function zip64DataDescriptor(crc, size) {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeBigUInt64LE(size, 8);
  descriptor.writeBigUInt64LE(size, 16);
  return descriptor;
}

function zip64CentralHeader(entry) {
  const extra = zip64Extra([entry.size, entry.size, entry.localOffset]);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE(0x0808, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosTime, 12);
  header.writeUInt16LE(FIXED_ZIP_DATE.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(MAX_UINT32, 20);
  header.writeUInt32LE(MAX_UINT32, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((FIXED_ZIP_MODE << 16) >>> 0, 38);
  header.writeUInt32LE(MAX_UINT32, 42);
  return Buffer.concat([header, entry.nameBytes, extra]);
}

function zip64EndRecords(entryCount, centralSize, centralOffset) {
  const count = BigInt(entryCount);
  const zip64Eocd = Buffer.alloc(56);
  zip64Eocd.writeUInt32LE(0x06064b50, 0);
  zip64Eocd.writeBigUInt64LE(44n, 4);
  zip64Eocd.writeUInt16LE((3 << 8) | 45, 12);
  zip64Eocd.writeUInt16LE(45, 14);
  zip64Eocd.writeUInt32LE(0, 16);
  zip64Eocd.writeUInt32LE(0, 20);
  zip64Eocd.writeBigUInt64LE(count, 24);
  zip64Eocd.writeBigUInt64LE(count, 32);
  zip64Eocd.writeBigUInt64LE(centralSize, 40);
  zip64Eocd.writeBigUInt64LE(centralOffset, 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeUInt32LE(0, 4);
  locator.writeBigUInt64LE(centralOffset + centralSize, 8);
  locator.writeUInt32LE(1, 16);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Math.min(entryCount, 0xffff), 8);
  eocd.writeUInt16LE(Math.min(entryCount, 0xffff), 10);
  eocd.writeUInt32LE(centralSize <= BigInt(MAX_UINT32) ? Number(centralSize) : MAX_UINT32, 12);
  eocd.writeUInt32LE(centralOffset <= BigInt(MAX_UINT32) ? Number(centralOffset) : MAX_UINT32, 16);
  eocd.writeUInt16LE(0, 20);
  return [zip64Eocd, locator, eocd];
}

function normalizeZip64Entries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 0xffff) fail("output_zip_entry_set_invalid", "ZIP requires between 1 and 65535 entries");
  const seen = new Set();
  return entries.map((entry) => {
    const name = normalizeZipName(entry?.name);
    if (seen.has(name)) fail("output_zip_entry_duplicate", `Duplicate ZIP entry: ${name}`);
    seen.add(name);
    const direct = entry?.bytes;
    const hasDirect = Buffer.isBuffer(direct) || direct instanceof Uint8Array;
    const size = hasDirect ? direct.byteLength : Number(entry?.byteSize);
    if (!Number.isSafeInteger(size) || size < 0) fail("output_zip_entry_size_invalid", `${name} has an invalid ZIP64 byte size`);
    if (!hasDirect && typeof entry?.open !== "function") fail("output_zip_entry_source_invalid", `${name} requires bytes or an open() stream factory`);
    return {
      name,
      nameBytes: Buffer.from(name, "utf8"),
      size: BigInt(size),
      direct: hasDirect ? (Buffer.isBuffer(direct) ? direct : Buffer.from(direct.buffer, direct.byteOffset, direct.byteLength)) : null,
      open: entry?.open,
    };
  }).sort((left, right) => Buffer.compare(left.nameBytes, right.nameBytes));
}

async function* deterministicZip64Generator(entries) {
  const completed = [];
  let offset = 0n;
  for (const entry of entries) {
    const localOffset = offset;
    const header = zip64LocalHeader(entry);
    yield header;
    offset += BigInt(header.length);
    let observedSize = 0n;
    let crcState = 0xffffffff;
    const source = entry.direct ? [entry.direct] : await entry.open();
    if (!source || (typeof source[Symbol.asyncIterator] !== "function" && typeof source[Symbol.iterator] !== "function")) fail("output_zip_entry_source_invalid", `${entry.name} open() did not return an iterable byte source`);
    for await (const value of source) {
      if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) fail("output_zip_entry_source_invalid", `${entry.name} yielded a non-byte chunk`);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      observedSize += BigInt(chunk.length);
      if (observedSize > entry.size) fail("output_zip_entry_size_mismatch", `${entry.name} streamed more bytes than declared`);
      for (const byte of chunk) crcState = CRC32_TABLE[(crcState ^ byte) & 0xff] ^ (crcState >>> 8);
      yield chunk;
      offset += BigInt(chunk.length);
    }
    if (observedSize !== entry.size) fail("output_zip_entry_size_mismatch", `${entry.name} streamed ${observedSize} bytes but declared ${entry.size}`);
    const crc = (crcState ^ 0xffffffff) >>> 0;
    const descriptor = zip64DataDescriptor(crc, entry.size);
    yield descriptor;
    offset += BigInt(descriptor.length);
    completed.push({ ...entry, localOffset, crc });
  }
  const centralOffset = offset;
  let centralSize = 0n;
  for (const entry of completed) {
    const central = zip64CentralHeader(entry);
    yield central;
    centralSize += BigInt(central.length);
    offset += BigInt(central.length);
  }
  for (const ending of zip64EndRecords(completed.length, centralSize, centralOffset)) yield ending;
}

function createDeterministicZip64Stream(entries) {
  return Readable.from(deterministicZip64Generator(normalizeZip64Entries(entries)));
}

module.exports = Object.freeze({
  BLEED_INCHES_PER_EDGE,
  FILE_DPI,
  FIXED_ZIP_DATE,
  FIXED_ZIP_MODE,
  FORMATS,
  FULL_SCALE_PIXELS_PER_INCH,
  MAX_EPS_ENCODED_BYTES,
  MAX_EPS_RAW_BYTES,
  OUTPUT_SCALE,
  PANEL_DATA_SLUG,
  OutputVerificationError,
  SURFACES,
  buildDeterministicRasterEps,
  buildDeterministicZip,
  createDeterministicZip64Stream,
  crc32,
  planEpsResources,
  sha256,
  verifyProductionOutputSet,
});
