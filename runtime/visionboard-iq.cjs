"use strict";

/**
 * VisionBoardIQ — the reference pre-pass, ported from the proven producer.
 *
 * SOURCE: supabase/functions/design-panel-ai-generate/index.ts:661
 * `analyzeVisionBoardStyles()`. It reads the customer's supplied reference
 * images and returns their visual style DNA as text, which the authoring call
 * then carries as `styleDescriptors`.
 *
 * WHY IT HAD TO BE PORTED. The runtime already CONSUMED `styleDescriptors` in
 * four places — including the STYLE INSPIRATION branch in designiq-prompt.cjs —
 * and nothing anywhere PRODUCED it. Measured across all 11 real A.T.L.A.S. runs:
 * styleDescriptors populated on 0 of them. The branch could not fire, so a
 * customer's reference images reached the design call as pictures with no
 * extracted style intelligence at all.
 *
 * WHAT IS VERBATIM. The six categories and their wording are the reference's,
 * character for character — they are the creative content and RULE 1 says port,
 * do not redesign.
 *
 * WHAT IS ADAPTED, AND ONLY THIS. Transport. The reference fetches
 * gemini-2.5-flash directly with a raw key and asks for text/plain; here the
 * call goes through the runtime's existing provider so it shares the server key
 * pool, its health tracking and its cooldowns — the same adaptation RULE 1
 * allows for persistence and auth. The provider returns JSON, so the six
 * categories are requested as six named fields and re-joined into the same
 * `CATEGORY: value` lines the consumer already expects.
 *
 * IT FAILS SOFT, exactly as the reference does. A refusal, a timeout, an empty
 * answer or a malformed one returns null and the design call proceeds on the
 * brief alone. A reference pre-pass is an enhancement to the professional
 * designer persona; it is never a precondition for it.
 */

const VISIONBOARD_IQ_CONTRACT = "designpro.visionboard-iq.v1";

// Verbatim from the reference (index.ts:669-677).
const ANALYSIS_PROMPT = `Analyze these reference images and extract their visual style DNA in a concise format. Output ONLY the following categories, one per line:

COLOR PALETTE: List the 3-5 dominant colors with approximate hex values
ART STYLE: The overall artistic style (e.g. cyberpunk, minimalist, graffiti, photorealistic, abstract geometric)
MOOD: The emotional energy (e.g. aggressive, elegant, playful, dark, futuristic)
COMPOSITION: How visual elements are arranged (e.g. flowing curves, sharp angular cuts, radial burst, layered depth)
TEXTURE: Surface quality (e.g. smooth gradients, gritty distressed, metallic sheen, organic splatter)
VISUAL WEIGHT: Where the eye is drawn (e.g. center-heavy, bottom-anchored, diagonal flow left-to-right)

Be specific and concise. No introductions or explanations. Just the six categories.`;

const CATEGORIES = Object.freeze([
  ["colorPalette", "COLOR PALETTE"],
  ["artStyle", "ART STYLE"],
  ["mood", "MOOD"],
  ["composition", "COMPOSITION"],
  ["texture", "TEXTURE"],
  ["visualWeight", "VISUAL WEIGHT"],
]);

const RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.fromEntries(CATEGORIES.map(([key]) => [key, { type: "string" }])),
  required: CATEGORIES.map(([key]) => key),
  additionalProperties: false,
});

/** The image parts out of a reference part list; the text labels are dropped. */
function imagePartsOf(referenceParts = []) {
  return referenceParts.filter((part) => part?.inlineData?.data);
}

/**
 * Style DNA for the supplied references, or null.
 *
 * `referenceParts` is the list `verifiedCustomerReferenceParts()` already built,
 * so the bytes have been hash-verified against their immutable identity before
 * they reach here. Nothing is downloaded twice.
 */
async function analyzeVisionBoardStyles({ provider, referenceParts = [], signal, timeoutMs = 20_000 } = {}) {
  const images = imagePartsOf(referenceParts);
  if (!images.length) return null;
  if (typeof provider?.generateSpecification !== "function") return null;

  try {
    const result = await provider.generateSpecification({
      parts: [{ text: ANALYSIS_PROMPT }, ...images],
      schema: RESPONSE_SCHEMA,
      temperature: 0.4,
      timeoutMs,
      signal,
      label: "visionboard-iq",
    });
    const spec = result?.specification || result;
    if (!spec || typeof spec !== "object") return null;
    const lines = CATEGORIES
      .map(([key, label]) => {
        const value = String(spec[key] ?? "").trim();
        return value ? `${label}: ${value}` : "";
      })
      .filter(Boolean);
    // A partial answer is still style DNA; an empty one is not.
    return lines.length ? lines.join("\n") : null;
  } catch {
    // Fail soft. The persona designs from the brief.
    return null;
  }
}

module.exports = {
  VISIONBOARD_IQ_CONTRACT,
  ANALYSIS_PROMPT,
  CATEGORIES,
  analyzeVisionBoardStyles,
  _test: { imagePartsOf, RESPONSE_SCHEMA },
};
