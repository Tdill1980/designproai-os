/**
 * flat-master-prompt.ts — FLAT-FIRST master artwork prompt builder.
 *
 * ⚠️ UNVERIFIED / RENDER-TEST REQUIRED. This is the front-of-pipeline half of the
 * flat-first architecture (docs/FLAT_FIRST_ARCHITECTURE.md). It is gated behind
 * the FLAT_FIRST_PANELS flag (default OFF) and is NOT deployed to the live golden
 * renderer. It MUST be render-tested before being trusted/enabled — the two prior
 * front-of-pipeline changes (DESIGNPRO_CLEAN_FIRST, RESTYLE_FOCAL_SEPARATION)
 * both regressed to "AI slop" and were kill-switched after a render test. Treat
 * this the same way: render-test first.
 *
 * GOAL: produce the design as a FLAT production master — each body panel painted
 * as a flat orthographic rectangle on a white artboard, at true relative
 * proportions — so the deterministic slicer can crop pixel-perfect, true-size
 * panels straight out of it. NO vehicle body, NO 3D, NO perspective. This is the
 * "born flat" source of truth; the on-vehicle proof is meant to be DERIVED from
 * it (Stage 2 projection), not the other way around.
 *
 * Signature mirrors buildDesignIQPrompt / buildLayer1CleanPrompt: (params) => string.
 */

// Loosely typed to avoid coupling to the locked function's DesignIQParams shape.
export function buildFlatMasterPrompt(params: any): string {
  const vehicle = [params?.vehicleYear, params?.vehicleMake, params?.vehicleModel]
    .filter(Boolean).join(" ") || "vehicle";
  const finish = params?.finish || "Gloss";
  const brief = String(params?.prompt || "").slice(0, 1500);

  return `Create ONE FLAT vehicle-wrap PRODUCTION MASTER ARTBOARD for a ${vehicle}.

OUTPUT FORMAT (critical):
- A single flat artboard on a PURE WHITE background. NO vehicle body, NO 3D, NO
  perspective, NO wheels, NO windows, NO photography. Orthographic flat artwork only.
- Lay the design out as flat rectangular PANELS, edge to edge, in this order:
  Driver Side (largest, top), Passenger Side (exact horizontal MIRROR of driver,
  below it), then a bottom row: Hood, Front, Rear. Each panel is a clean flat
  rectangle at the true relative proportions of that body panel.
- The wrap design must read as ONE continuous design across the panels — colors,
  patterns, and graphics flow consistently from panel to panel.

THE DESIGN:
${brief}

RULES:
- Reproduce the requested design faithfully as FLAT art filling each rectangle.
- Finish intent: ${finish}.
- Print-ready: crisp edges, full-bleed art to each rectangle edge, vivid color.
- Do NOT draw a car. Do NOT add a vehicle silhouette. Flat panels only.`;
}
