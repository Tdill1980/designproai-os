import { finalAtlasProofImage } from './atlas-proof-provider.mjs';
import { providerSha256, runDurableImageProviderRequest } from './gemini-provider-cache.mjs';

export function proofLogoRequested(input) {
  if (input.hasCustomerLogo || input.logoAsset || input.generateLogo === false) return false;
  if (input.generateLogo === true) return true;
  const brief = String(input.customerPrompt || '');
  if (/\b(?:no logo|without (?:a )?logo|(?:do not|don't|never)\b[^.!?\n]{0,60}\blogo)\b/i.test(brief)) return false;
  /**
   * READ THE WORDS ATTACHED TO "LOGO", NOT A HUNDRED CHARACTERS OF SENTENCE.
   *
   * This used to span up to 100 characters back from `logo` to the nearest
   * request verb and veto the whole span if it mentioned a wrap. That veto is
   * right about "design a wrap USING my existing logo" and catastrophically
   * wrong about one long sentence, because the span swallows the brief:
   *
   *   "Create a wrap for a landscape design company for Botanical Gardens
   *    landscape Design feature a custom logo"
   *
   * matched, contained "wrap", and was vetoed -- so a brief that says "feature
   * a custom logo" in plain words produced no logo at all (live bbdd0db0,
   * 2026-09-21: Zone 3 carried two elements, both text). People write one
   * sentence; the old window only worked when "logo" happened to sit in a
   * short clause of its own.
   *
   * So the decision is made on the ~60 characters IMMEDIATELY before the word,
   * which is where a writer actually says whose logo it is:
   *
   *   · an ownership or existing-asset marker there means theirs, not ours;
   *   · otherwise a request verb OR a creation adjective there means draw one.
   *
   * "feature", "include", "add", "incorporate" and "showcase" join the verbs:
   * the old list demanded create/design/generate/need/want, and a customer
   * asking to FEATURE a custom logo is asking for a logo.
   */
  // `with` and `using` stay here rather than in the ask list: "a wrap WITH a
  // logo" is the customer describing what the wrap carries, not asking for one
  // to be drawn, and that reading is already locked by
  // `tests/atlas-proof-elements.test.mjs`. Scoped to the near window, it no
  // longer reaches across a whole sentence to veto "feature a custom logo".
  const OWNED = /\b(?:my|our|your|their|its|his|her|clients?'?s?|customers?'?s?|existing|supplied|uploaded|provided|attached|current|same|with|using)\b/i;
  const ASKS = /\b(?:create|design|generate|need|want|feature|featuring|include|including|add|adding|incorporate|incorporating|showcase|showcasing|make|build)\b/i;
  const MADE_FOR_THEM = /\b(?:custom|new|original|bespoke|unique|fresh|brand[- ]new)\b/i;
  for (const match of brief.matchAll(/\blogos?\b/gi)) {
    const window = brief.slice(Math.max(0, match.index - 60), match.index);
    // A clause boundary ends the window: words from the previous sentence are
    // not describing this logo.
    const clause = window.split(/[.!?\n;]/).pop();
    // OWNERSHIP IS READ CLOSER THAN THE ASK, because "my" attaches to whatever
    // noun it precedes. "Wrap my van ... add an original logo" is a request to
    // draw one; "using my existing logo" is not. The van is 25 characters away
    // and the ownership of the logo is never that far from the word.
    if (OWNED.test(clause.slice(-25))) continue;
    if (ASKS.test(clause) || MADE_FOR_THEM.test(clause)) return true;
  }
  return false;
}

// The existing text-layer designer authors a missing brand mark. Its operation
// is separate from the artwork candidate and survives worker/HTTP recovery.
export async function authorProofLogo({ bucket, ownerId, providerRequest, input,
  model, buildPrompt, normalize, authorize, invoke, runProvider = runDurableImageProviderRequest,
  /**
   * CALL 1'S OWN EXCHANGE, so the mark CONTINUES the design instead of opening
   * a fresh conversation about it.
   *
   * Without it this call drew a brand mark blind -- no sight of the artwork it
   * was about to be composited onto -- and guessed the palette. `priorTurns`
   * carries the accepted sheet and the thought signature ON THE MODEL PART IT
   * ARRIVED ON, which is the shape Gemini reads it in.
   *
   * Absent is legitimate and is exactly the previous behaviour: the model does
   * not always emit a signature, and a mark drawn without one still ships.
   */
  priorTurns = null }) {
  if (input.logoAsset || input.generateLogo !== true || !String(input.companyName || '').trim()) return null;
  const prompt = buildPrompt(input, { id: 'brand-logo', kind: 'logo', role: 'logo', text: input.companyName });
  const contents = [
    ...(Array.isArray(priorTurns) ? priorTurns : []),
    { role: 'user', parts: [{ text: prompt }] },
  ];
  const modelRequest = JSON.stringify({ contents,
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '4K' } } });
  const cached = await runProvider({ bucket,
    identity: { ...providerRequest, ownerId, mode: 'atlas-panel-proof-element', attemptKey: 'brand-logo:1' },
    requestHash: await providerSha256(JSON.stringify({ model, contract: priorTurns?.length ? 'designpro.proof-logo.v2-continues-call-one' : 'designpro.proof-logo.v1', modelRequest })),
    privateRequest: modelRequest, cacheOnly: providerRequest.cacheOnly === true,
    authorize, invoke: () => invoke(modelRequest),
  });
  const native = finalAtlasProofImage(cached.payload);
  // Edge only checkpoints encoded bytes. Full-resolution pixel decoding and
  // chroma keying belong to the existing runtime compositor, not Edge CPU.
  const deferred = typeof normalize !== 'function';
  const bytes = deferred ? native.bytes : await normalize(native.bytes);
  const contentType = deferred ? native.contentType : 'image/png';
  const contentHash = await providerSha256(bytes);
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : 'png';
  const storagePath = `atlas-elements/${contentHash}.${extension}`;
  const { error } = await bucket.upload(storagePath, bytes, { contentType, upsert: false });
  if (error && !/exists/i.test(String(error.message))) throw error;
  return { role: 'logo', source: 'designpro-text-layer-art', storagePath, contentHash,
    byteSize: bytes.length, contentType, needsChromaKey: deferred, providerCacheHit: cached.providerCacheHit === true };
}
