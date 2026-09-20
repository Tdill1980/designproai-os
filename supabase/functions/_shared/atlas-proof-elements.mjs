import { finalAtlasProofImage } from './atlas-proof-provider.mjs';
import { providerSha256, runDurableImageProviderRequest } from './gemini-provider-cache.mjs';

export function proofLogoRequested(input) {
  if (input.hasCustomerLogo || input.logoAsset || input.generateLogo === false) return false;
  if (input.generateLogo === true) return true;
  const brief = String(input.customerPrompt || '');
  if (/\b(?:no logo|without (?:a )?logo|(?:do not|don't|never)\b[^.!?\n]{0,60}\blogo)\b/i.test(brief)) return false;
  const requests = brief.matchAll(/\b(?:create|design|generate|need|want)\s+([^.!?\n]{0,100}?)\blogo\b/gi);
  for (const [, modifiers] of requests) {
    // Descriptive subjects (bicycle-chain, paw-and-floral, sun/lightning) are
    // valid logo requests. A request for a wrap USING a logo is not one.
    if (!/\b(?:wrap|vehicle|panel|artwork|using|with|existing|supplied|uploaded|my)\b/i.test(modifiers)) return true;
  }
  return false;
}

// The existing text-layer designer authors a missing brand mark. Its operation
// is separate from the artwork candidate and survives worker/HTTP recovery.
export async function authorProofLogo({ bucket, ownerId, providerRequest, input,
  model, buildPrompt, normalize, authorize, invoke, runProvider = runDurableImageProviderRequest }) {
  if (input.logoAsset || input.generateLogo !== true || !String(input.companyName || '').trim()) return null;
  const prompt = buildPrompt(input, { id: 'brand-logo', kind: 'logo', role: 'logo', text: input.companyName });
  const modelRequest = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '4K' } } });
  const cached = await runProvider({ bucket,
    identity: { ...providerRequest, ownerId, mode: 'atlas-panel-proof-element', attemptKey: 'brand-logo:1' },
    requestHash: await providerSha256(JSON.stringify({ model, contract: 'designpro.proof-logo.v1', modelRequest })),
    privateRequest: modelRequest, cacheOnly: providerRequest.cacheOnly === true,
    authorize, invoke: () => invoke(modelRequest),
  });
  const bytes = await normalize(finalAtlasProofImage(cached.payload).bytes);
  const contentHash = await providerSha256(bytes);
  const storagePath = `atlas-elements/${contentHash}.png`;
  const { error } = await bucket.upload(storagePath, bytes, { contentType: 'image/png', upsert: false });
  if (error && !/exists/i.test(String(error.message))) throw error;
  return { role: 'logo', source: 'designpro-text-layer-art', storagePath, contentHash,
    byteSize: bytes.length, contentType: 'image/png', providerCacheHit: cached.providerCacheHit === true };
}
