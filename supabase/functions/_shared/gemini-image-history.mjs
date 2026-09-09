// Exact generateContent history transport. Signatures are opaque metadata;
// never summarize, truncate, merge or relabel the parts they accompany.
import { Buffer } from 'node:buffer';
const IMAGE_EXTENSIONS = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
const clone = (value) => JSON.parse(JSON.stringify(value));
function assertTurn(turn) {
  if (!turn || !['user', 'model'].includes(turn.role)) throw new Error('atlas_panel_prior_turn_role_invalid');
  if (!Array.isArray(turn.parts) || !turn.parts.length || turn.parts.length > 256) throw new Error('atlas_panel_prior_turn_empty');
}

// Thought images belong to private replay history, never to the final artwork.
// Fail closed on multiple candidates/images instead of choosing whichever the
// provider happened to serialize first.
export function selectFinalGenerateContentImage(payload, errorPrefix) {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) throw new Error(`${errorPrefix}_no_image`);
  if (candidates.length !== 1) throw new Error(`${errorPrefix}_ambiguous_candidates`);
  const candidateParts = candidates[0]?.content?.parts;
  if (!Array.isArray(candidateParts)) throw new Error(`${errorPrefix}_no_image`);
  const finalImages = candidateParts.filter((part) => part?.inlineData?.data && part.thought !== true);
  if (!finalImages.length) throw new Error(`${errorPrefix}_no_image`);
  if (finalImages.length !== 1) throw new Error(`${errorPrefix}_ambiguous_final_images`);
  const imagePart = finalImages[0];
  if (!Object.hasOwn(IMAGE_EXTENSIONS, imagePart.inlineData.mimeType)) throw new Error(`${errorPrefix}_final_image_mime_invalid`);
  const textOut = candidateParts.filter((part) => typeof part?.text === 'string' && part.thought !== true)
    .map((part) => part.text).join('\n').trim();
  return { candidateParts, imagePart, textOut };
}

// Preserve the native encoded bytes and MIME. PNG normalization belongs to the
// existing runtime image decoder, after the raw response is durably banked.
// Relabeling JPEG bytes as PNG would also corrupt signed image-history replay.
export function decodeGenerateContentImage(inlineData, errorPrefix) {
  const mimeType = inlineData?.mimeType;
  if (!Object.hasOwn(IMAGE_EXTENSIONS, mimeType)) throw new Error(`${errorPrefix}_final_image_mime_invalid`);
  const data = inlineData?.data;
  if (typeof data !== 'string' || !data || data.length > 64 * 1024 * 1024
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error(`${errorPrefix}_final_image_bytes_invalid`);
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.toString('base64') !== data) throw new Error(`${errorPrefix}_final_image_bytes_invalid`);
  const png = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]));
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  const webp = bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
  if (!({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[mimeType]) {
    throw new Error(`${errorPrefix}_final_image_bytes_invalid`);
  }
  return { bytes, mimeType, extension: IMAGE_EXTENSIONS[mimeType] };
}

export async function captureImageTurn(turn, storeImage) {
  assertTurn(turn);
  const stored = clone(turn);
  for (let index = 0; index < stored.parts.length; index += 1) {
    const part = stored.parts[index];
    if (part.imageRef) throw new Error('atlas_panel_provider_returned_internal_reference');
    if (!part.inlineData) continue;
    const { data, ...inlineDataMetadata } = part.inlineData;
    if (typeof data !== 'string' || !data) throw new Error('atlas_panel_history_image_empty');
    const ref = await storeImage(part.inlineData, index);
    delete part.inlineData;
    part.imageRef = { ...ref, inlineDataMetadata };
  }
  return stored;
}

export async function replayImageTurn(turn, downloadImage) {
  assertTurn(turn);
  const replayed = clone(turn);
  for (const part of replayed.parts) {
    if (part.inlineData) throw new Error('atlas_panel_prior_turn_carries_inline_image');
    if (part.imageRef) {
      const ref = part.imageRef;
      const metadata = ref.inlineDataMetadata ?? { mimeType: 'image/png' }; // old stored image turns
      if (Object.hasOwn(metadata, 'data')) throw new Error('atlas_panel_history_metadata_invalid');
      part.inlineData = { ...metadata, data: await downloadImage(ref.storagePath, ref.contentHash) };
      delete part.imageRef;
    }
  }
  return replayed;
}
