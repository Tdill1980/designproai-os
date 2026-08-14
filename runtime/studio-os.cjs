"use strict";

/**
 * STUDIO OS — the render environment kernel, ported verbatim from
 * restylepro-os @ 532a7d56, blob 6870eaebab4d43ef8605d812416f86621727d3e9
 * (supabase/functions/_shared/studio-os.ts).
 *
 * TRADE SECRET - CONFIDENTIAL. (c) LoopMighty Software Development LLC.
 *
 * The engine contract has named this blob as frozen since Calls 1-7 shipped,
 * but it was never actually ported: the standalone worker assembled a brief
 * from the request's descriptive fields and appended a camera angle, with no
 * studio at all. That is the whole difference between "a vehicle with a wrap"
 * and the product's photograph — the floor reflection, the LED strip
 * highlights that define the body curves, the wall gradient, the colour
 * temperature, the camera body. Seven views generated without it are seven
 * views in seven different rooms.
 *
 * DO NOT MODIFY. The kernel never changes between camera angles; that
 * invariance is what makes a seven-view set read as one shoot.
 */

const STUDIO_ENVIRONMENT = `
You are a professional automotive photographer shooting for a luxury car brand campaign.
Every shot is technically perfect — bright, clean, color-accurate, and photorealistic.
HIGH-END WRAP SHOP ENVIRONMENT:
- Premium automotive wrap installation studio
- The vehicle is the ONLY subject — nothing else in frame
- Even bright illumination across the full vehicle
- Wrap design is fully color-accurate — bright lighting enhances colors
- This studio is IDENTICAL in every camera angle — only the camera moves
FLOOR — DARK EPOXY WITH MIRROR REFLECTIONS:
- Dark charcoal epoxy floor (#1a1a1a to #2a2a2a) — high-gloss sealed finish
- Sharp, clear mirror reflection of the vehicle on the floor surface
- The wrap design and vehicle silhouette are visible in the floor reflection
- Reflection fades naturally with distance — sharp near the tires, soft at edges
- Clean, dust-free surface with professional shop finish
WALLS:
- Light cool gray walls (#d8d8d8 to #e8e8e8) — smooth with subtle concrete texture
- Neutral background that makes wrap colors pop
- Smooth natural gradient from dark floor up to lighter walls
LIGHTING — BRIGHT LINEAR LED STRIP LIGHTS:
- Overhead linear LED strip lights running the length of the studio
- Bright, clean, realistic specular highlight reflections on the body panels define every curve and make the vehicle look real and photographic
- Highlights fall on the clear-coat and metal so the vehicle still reads as real, while the printed wrap design stays crisp, color-accurate, and fully visible — no LED strip lines streak across or wash over the artwork
- White daylight-balanced LED lighting (5500K–6500K)
- Colors are vivid, accurate, and true-to-life
- The light fixtures are above frame and out of view — only their reflections visible
FRAMING:
- The vehicle is the ONLY subject — nothing else in frame
- Clean, uncluttered composition
- Canon EOS R5, 4K capture, studio editorial quality
`;

const STUDIO_REINFORCEMENT = `
STUDIO LOCK:
- Premium wrap shop — clean commercial automotive photography
- Dark epoxy floor with sharp mirror reflection of the vehicle
- Bright LED strip highlights define every body curve; the wrap design areas stay crisp, legible, and color-accurate
- Light gray walls with subtle concrete texture
- Same studio in every angle — zero variation
- Ceiling is clean — smooth plain surface
- All light sources off-camera — only reflections and illumination visible
- Vehicle is the ONLY subject in frame
- Photorealistic — real printed vinyl physically applied to the vehicle
- Realistic specular highlights on hood, roof, fenders from LED strips fall on the clear-coat and never wash out the wrap design
`;

// LIGHT STUDIO — white/bright environment for light-mode renders. Ported for
// completeness; Calls 1-7 use the dark kernel above, which is what the seven
// reference views were shot in.
const LIGHT_STUDIO_ENVIRONMENT = `
You are a professional automotive photographer shooting for a luxury car brand campaign.
Every shot is technically perfect — bright, clean, color-accurate, and photorealistic.
HIGH-END WRAP SHOP ENVIRONMENT — LIGHT MODE:
- Premium automotive wrap installation studio
- The vehicle is the ONLY subject — nothing else in frame
- Even bright illumination across the full vehicle
- Wrap design is fully color-accurate — bright lighting enhances colors
- This studio is IDENTICAL in every camera angle — only the camera moves
FLOOR — POLISHED WHITE WITH SOFT REFLECTIONS:
- Clean white polished floor (#f0f0f0 to #ffffff) — high-gloss epoxy or white marble
- Soft, realistic reflection of the vehicle visible on the floor surface
- Reflection fades naturally with distance — sharp near the tires, soft at edges
- Clean, dust-free surface with professional shop finish
WALLS:
- Pure white cyclorama background (#ffffff to #f5f5f5) — seamless and bright
- Smooth, neutral background that makes wrap colors pop
- Bright, airy environment with even fill from all angles
LIGHTING — BRIGHT LINEAR LED STRIP LIGHTS:
- Overhead linear LED strip lights running the length of the studio
- Bright, clean, realistic specular highlight reflections on the body panels define every curve and make the vehicle look real and photographic
- Highlights fall on the clear-coat and metal so the vehicle still reads as real, while the printed wrap design stays crisp, color-accurate, and fully visible — no LED strip lines streak across or wash over the artwork
- White daylight-balanced LED lighting (5500K–6500K)
- Colors are vivid, accurate, and true-to-life
- The light fixtures are above frame and out of view — only their reflections visible
FRAMING:
- The vehicle is the ONLY subject — nothing else in frame
- Clean, uncluttered composition
- Canon EOS R5, 4K capture, studio editorial quality
`;

const LIGHT_STUDIO_REINFORCEMENT = `
STUDIO LOCK — LIGHT MODE:
- Premium wrap shop — clean commercial automotive photography
- White polished floor with soft realistic vehicle reflection
- Bright LED highlights define body curves so the vehicle looks real; the wrap design areas stay crisp, legible, and color-accurate with no strip-light lines across the artwork
- Pure white cyclorama walls — seamless bright background
- Same studio in every angle — zero variation
- Ceiling is clean — smooth plain surface
- All light sources off-camera — only reflections and illumination visible
- Vehicle is the ONLY subject in frame
- Photorealistic — real printed vinyl physically applied to the vehicle
- Realistic specular highlights on hood, roof, fenders from LED strips fall on the clear-coat and never streak across the wrap design
`;

module.exports = {
  STUDIO_ENVIRONMENT,
  STUDIO_REINFORCEMENT,
  LIGHT_STUDIO_ENVIRONMENT,
  LIGHT_STUDIO_REINFORCEMENT,
};
