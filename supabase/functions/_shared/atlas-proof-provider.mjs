import { Buffer } from 'node:buffer';
import { GeminiProviderError, authorizeAtlasProviderRequest, providerSha256,
  runDurableImageProviderRequest } from './gemini-provider-cache.mjs';

export const ATLAS_PROOF_RECOVERY_CONTRACT = 'designpro.atlas-proof-recovery.v1';
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Thought images are private reasoning artifacts, never customer proofs.
export function finalAtlasProofImage(payload) {
  if (payload?.candidates?.length !== 1) throw new GeminiProviderError('atlas_proof_ambiguous_candidates', 422, 'received', 1);
  const images = (payload.candidates[0]?.content?.parts || [])
    .filter(part => part?.thought !== true && part?.inlineData?.data);
  if (images.length !== 1) throw new GeminiProviderError('atlas_proof_final_image_missing_or_ambiguous', 422, 'received', 1);
  const { data, mimeType } = images[0].inlineData;
  if (!TYPES.has(mimeType) || typeof data !== 'string' || !data.length) {
    throw new GeminiProviderError('atlas_proof_final_image_invalid', 422, 'received', 1);
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.toString('base64') !== data) throw new GeminiProviderError('atlas_proof_final_image_invalid', 422, 'received', 1);
  return { bytes, contentType: mimeType };
}

/** One durable operation per camera shot, independent of HTTP/worker retries.
 * Only an explicit rate-limit rejection may advance the existing model ladder.
 * A timeout, lost response or 5xx never authorizes another paid image request.
 */
export async function runAtlasProofProvider({ supabase, ownerId, providerRequest, shotKey,
  authority, parts, promptContract, models, invoke, deadlineAt = Date.now() + 120_000,
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (providerRequest?.contractVersion !== ATLAS_PROOF_RECOVERY_CONTRACT
    || !/^[a-z][a-z_-]{0,39}$/.test(shotKey) || !Array.isArray(models) || models.length !== 3) {
    throw new GeminiProviderError('atlas_proof_recovery_identity_invalid', 400);
  }
  const modelRequest = JSON.stringify({ contents: [{ parts }], generationConfig: {
    responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '4K', aspectRatio: '16:9' },
  } });
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const attemptKey = `proof:${shotKey}:${index + 1}`;
    const request = { ...providerRequest, attemptKey };
    try {
      const cached = await runDurableImageProviderRequest({
        bucket: supabase.storage.from('wrap-files'),
        identity: { ...request, ownerId, mode: 'atlas-proof' },
        requestHash: await providerSha256(JSON.stringify({ model, promptContract, authority, modelRequest })),
        privateRequest: modelRequest, cacheOnly: providerRequest.cacheOnly === true,
        authorize: async () => {
          await authorizeAtlasProviderRequest(supabase, request, ownerId, now);
          if (providerRequest.cacheOnly !== true && deadlineAt - now() < 15_000) {
            throw new GeminiProviderError('atlas_proof_time_budget_exhausted', 503);
          }
        },
        invoke: () => invoke({ model, body: modelRequest, timeoutMs: Math.min(90_000, deadlineAt - now() - 10_000) }),
      });
      return { ...cached, ...finalAtlasProofImage(cached.payload), model, imageRequestCount: index + 1 };
    } catch (error) {
      if (error?.providerStatus !== 429 || index === models.length - 1) throw error;
      // Cached rate-limit receipts are followed read-only during recovery.
      // Never spend a second retry budget in the slot runner.
      if (providerRequest.cacheOnly !== true) {
        const supplied = Number(error.retryAfterSeconds);
        const delay = Math.max(1000 * 2 ** index, Number.isFinite(supplied) ? supplied * 1000 : 0);
        if (delay + 15_000 > deadlineAt - now()) throw error;
        await wait(delay);
      }
    }
  }
  throw new GeminiProviderError('atlas_proof_provider_exhausted', 502);
}
