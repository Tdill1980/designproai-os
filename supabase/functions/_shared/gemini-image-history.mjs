// Exact generateContent history transport. Signatures are opaque metadata;
// never summarize, truncate, merge or relabel the parts they accompany.
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
  if (imagePart.inlineData.mimeType !== 'image/png') throw new Error(`${errorPrefix}_final_image_mime_invalid`);
  const textOut = candidateParts.filter((part) => typeof part?.text === 'string' && part.thought !== true)
    .map((part) => part.text).join('\n').trim();
  return { candidateParts, imagePart, textOut };
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
