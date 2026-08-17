/**
 * tiff-builder.ts — Shared RGB TIFF builder with Deflate compression
 *
 * Builds a valid TIFF binary from raw RGB pixel data with DPI metadata.
 * Used by generate-master-artboard and upscale-panel-to-print for
 * production-ready print output that RIP software can open directly.
 *
 * No external dependencies — uses built-in CompressionStream for Deflate.
 */

// ── Deflate Compression ─────────────────────────────────────────

export async function zlibCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

// ── RGB TIFF Builder ────────────────────────────────────────────

export function buildRgbTiff(
  width: number,
  height: number,
  compressedData: Uint8Array,
  dpi: number,
): Uint8Array {
  // TIFF layout: [Header 8B] [Image Data] [IFD] [Extra Data]
  const samplesPerPixel = 3; // R, G, B
  const headerSize = 8;
  const imageDataOffset = headerSize;
  const ifdOffset = imageDataOffset + compressedData.length;

  // IFD: 12 tags
  const numTags = 12;
  const ifdSize = 2 + (numTags * 12) + 4; // count + tags + next-ifd-pointer

  const extraDataOffset = ifdOffset + ifdSize;
  const bpsOffset = extraDataOffset;         // BitsPerSample (3 x uint16 = 6 bytes, padded to 8)
  const xResOffset = bpsOffset + 8;          // XResolution (rational = 8 bytes)
  const yResOffset = xResOffset + 8;         // YResolution (rational = 8 bytes)

  const totalSize = headerSize + compressedData.length + ifdSize + 8 + 8 + 8;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // TIFF Header (little-endian)
  bytes[0] = 0x49; bytes[1] = 0x49; // "II" = little-endian
  view.setUint16(2, 42, true);       // Magic number
  view.setUint32(4, ifdOffset, true); // Offset to first IFD

  // Image data
  bytes.set(compressedData, imageDataOffset);

  // IFD
  let off = ifdOffset;
  view.setUint16(off, numTags, true); off += 2;

  const writeTag = (tag: number, type: number, count: number, value: number) => {
    view.setUint16(off, tag, true); off += 2;  // Tag
    view.setUint16(off, type, true); off += 2;  // Type
    view.setUint32(off, count, true); off += 4;  // Count
    view.setUint32(off, value, true); off += 4;  // Value/Offset
  };

  // Tags in ascending order (REQUIRED by TIFF spec)
  writeTag(256, 4, 1, width);                           // 0x100 ImageWidth (LONG)
  writeTag(257, 4, 1, height);                          // 0x101 ImageLength (LONG)
  writeTag(258, 3, 3, bpsOffset);                       // 0x102 BitsPerSample → offset to [8,8,8]
  writeTag(259, 3, 1, 8);                               // 0x103 Compression = Adobe Deflate
  writeTag(262, 3, 1, 2);                               // 0x106 PhotometricInterpretation = 2 (RGB)
  writeTag(273, 4, 1, imageDataOffset);                 // 0x111 StripOffsets
  writeTag(277, 3, 1, samplesPerPixel);                 // 0x115 SamplesPerPixel = 3
  writeTag(278, 4, 1, height);                          // 0x116 RowsPerStrip = all
  writeTag(279, 4, 1, compressedData.length);           // 0x117 StripByteCounts
  writeTag(282, 5, 1, xResOffset);                      // 0x11A XResolution → rational
  writeTag(283, 5, 1, yResOffset);                      // 0x11B YResolution → rational
  writeTag(296, 3, 1, 2);                               // 0x128 ResolutionUnit = 2 (inches)

  // Next IFD pointer = 0 (no more IFDs)
  view.setUint32(off, 0, true);

  // Extra data: BitsPerSample [8, 8, 8] (6 bytes, 2 bytes padding)
  view.setUint16(bpsOffset, 8, true);
  view.setUint16(bpsOffset + 2, 8, true);
  view.setUint16(bpsOffset + 4, 8, true);

  // XResolution: rational (numerator/denominator)
  view.setUint32(xResOffset, dpi, true);
  view.setUint32(xResOffset + 4, 1, true);

  // YResolution: rational
  view.setUint32(yResOffset, dpi, true);
  view.setUint32(yResOffset + 4, 1, true);

  return bytes;
}
