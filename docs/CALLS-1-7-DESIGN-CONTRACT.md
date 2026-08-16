# Calls 1-7 — the design contract

The standalone had the frozen **camera** contract (`runtime/view-angles.cjs`)
and none of the **design** contract that sits around it. `designBrief()` in
`generation-worker.cjs` assembled four descriptive lines and appended a camera
angle, so every render was an unstudioed, unbriefed, un-elevated image of a
vehicle — and each of the seven slots invented independently, which is seven
different wraps on one vehicle rather than one design seen from seven angles.

This is what was ported, from where, and what was deliberately not carried over.

## The architecture

```
customer's raw brief ──▶ HERO (slot 1, `side`)          design-prompt-os.buildHeroPrompt
                              │  invents. text-only prompt.
                              ▼
                       accepted hero bytes
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            design anchor        hero image (full res)
            (one text pass)              │
                    └─────────┬──────────┘
                              ▼
        VIEWS 2-7 REPRODUCE   design-prompt-os.buildReproductionPrompt
        passenger · hood · front · rear · hero-3d · roof
```

Two phases, not one loop. `runSevenSlots` in `generation-worker.cjs` runs the
hero through its own bounded `engine.runRequest`, reads the accepted bytes back
from the bucket, builds the anchor, then runs the remaining six. The six
reproduction prompts **cannot** be assembled before the hero exists, because the
hero image is one of their prompt parts — `promptPartsFor` throws
`hero_reference_missing` rather than degrading to a text-only prompt, so the
ordering cannot be skipped by accident.

`requiresOwnGeneration` still returns `true` for all seven and is **not** the
reproduction contract. "Reproduces the hero" and "is not generated" are
different claims; the second one is a flip, and a flip reverses lettering. Ask
`originatesDesign` / `reproducesHero` for the design question.

## What was ported

| Behaviour | Source |
|---|---|
| Studio environment / lighting kernel | `_shared/studio-os.ts` `STUDIO_ENVIRONMENT` |
| Wrap coverage rules (reproduction path) | `_shared/view-angles-os.ts` `WRAP_COVERAGE_RULES` |
| Logo requirement (no form prescribed) | `design-panel-ai-generate` `LOGO_REQUIREMENT` |
| Photorealism gate (explicit request only) | `design-panel-ai-generate` `briefWantsPhoto` |
| Commercial depth / translation / judgment | `COMMERCIAL_DEPTH`, `COMMERCIAL_TRANSLATION`, `PROFESSIONAL_JUDGMENT` |
| Elevation (short brief → more direction) | `DESIGN AMPLIFICATION` |
| Commercial vs restyle personas and scenes | `design-panel-ai-generate` mode branches |
| VisionBoard grounding + intent | `visionBoardImages` / `visionboard_intent` |
| Hood/roof/front continuity lock | `design-panel-ai-generate` |
| Pickup bed clause | `truckBedClause` |
| Finish specs, substrate context, camera spec | `design-panel-ai-generate` |
| Hero reference + design anchor for views 2-7 | `generate-color-render` `designpanelpro` branch |

## Deliberate divergences, recorded rather than inherited

1. **`WRAP_COVERAGE_RULES` on the reproduction path only.**
   `design-panel-ai-generate` imports it and never uses it; the hero path's real
   coverage instruction is the one-liner. Only `generate-color-render` appends
   the block. Ported as it actually runs, not as the imports imply.

2. **Commercial secondary views keep their branding.** The source hard-codes the
   *restyle* scene text for every secondary view, so a commercial hood/roof is
   told "No text, no logos, no branding" while its own reference image plainly
   shows the lockup. Both scene texts exist in the source; the mode the hero was
   designed under picks between them. No new wording was written.

3. **The hero reference is attached at full resolution.** The source resizes to
   512px via storage transforms — an edge-function memory workaround. This
   runtime is a Node worker with real memory and does not inherit the crutch.

4. **The design anchor is bounded.** The source bounds it only by
   `maxOutputTokens: 1024` (~4,000 chars) and appends it to a prompt already
   ~5.4K, landing a reproduction view near 9-10K — well past where this model's
   image quality falls off, as the source's own `target <5000` log line admits.
   The anchor is asked for short and capped at 1,200 chars.

5. **Duplicated blocks removed.** The source says the camera angle twice, the
   coverage instruction twice (one-liner under the full block), and the
   placement demand twice (under the continuity lock). Each duplicate is
   dropped. Net effect with 4: reproduction prompts run **~6.1-6.8K** instead of
   ~9-10K; hero prompts **~5.1K**, inside the 6K guideline.

Frozen by `source-tests/runtime/design-prompt-os.test.mjs` — including the
length ceilings, so bloat cannot creep back.

## Per-surface identity

A companion fix, locked by `tests/per-surface-identity.test.mjs`: every surface
already has two deterministic addresses — its own full-resolution tile
(`MasterSheetTile.sourceUrl`) and its exact rectangle on the composed sheet — so
nothing needs to ask a model which side it is looking at.

`flatMasterSheet.ts`'s proof extractor used to fall back to feeding the **whole
all-sides proof** with a `sideKey` name. An ambiguous search over that sheet
resolves to the largest, most legible tile, which on every proof is the DRIVER
SIDE — the defect `MASTER_SHEET_VERSION` 6 exists to record ("v4 treated one
driver field as an all-sides master"), seen live as a giant driver lockup on
FRONT. The whole-proof feed is gone: without this side's own code-cropped tile
there is no extraction rung, and the ladder falls to an honest gap. A driver
fallback is now impossible by construction rather than by judgement.
