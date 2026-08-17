"use strict";

/**
 * STUDIO OS — ported verbatim from restylepro-os
 * supabase/functions/_shared/studio-os.ts (STUDIO_ENVIRONMENT :26,
 * STUDIO_REINFORCEMENT :58).
 *
 * The single source of truth for the render environment. Every view imports
 * this; no inline studio strings anywhere. It is the kernel — identical in
 * every camera angle, because only the camera moves.
 *
 * Trade secret (LoopMighty Software Development LLC). Same owner, private
 * repository, so this reuse is internal. The prompt text must not surface in
 * any published artifact.
 *
 * DO NOT MODIFY. Values are byte-identical to the proven file; a change here
 * changes every render's look.
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

module.exports = { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT };
