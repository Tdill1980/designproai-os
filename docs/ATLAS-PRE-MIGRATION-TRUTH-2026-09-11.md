# What actually produced the print panels before the migration (traced 2026-09-11)

Owner (Trish, 2026-09-11): *"Why don't you just look at our code, it was
working before migration!"* This is that look, from the RestylePro source at
`Tdill1980/restylepro-os` `f663d8a` (2026-09-10, with history to 2026-07)
and the live RestylePro database (project `kfapjdyythzyvnpdeghu`), not from
memory or from this repo's CLAUDE.md.

## 1. The chain that ran, July 22 to August 2

Sanctioned order, in the app's own words
(`src/hooks/useDesignPanelProLogic.ts:1113-1131`):

> `3D hero/views -> generate-2d-proof -> panel/logo extraction`

1. **The design origin is the driver-side 3D hero**, rendered by
   `design-panel-ai-generate` in `commercial` mode, one pass, the full
   golden designer prompt, no artboard, no layout, no sheet. Six more
   views follow. Flamingo Pools `d0c43c25` (2026-07-25): `render_urls.side`
   is a photoreal F-250 in the studio.
2. **The "master artboard" is that side view with the truck edited out.**
   `generate-2d-proof/index.ts:3213-3520` takes `views[0]` (the driver
   view) and asks Gemini to EDIT it: *"COMPLETELY remove every vehicle
   part ... KEEP the wrap design EXACTLY as shown ... Fill and extend the
   real design seamlessly out to all four edges, so the result is ONE
   continuous flat rectangle."* Aspect is the nearest supported ratio to
   the GENIE side inches (`CLEAN_ASPECTS`, line 3269: 21:9 for a
   pickup flank), size 2K on the first attempt, four attempts laddering
   aspect and size. Two variants: `artboard-branded` (lettering kept) and
   `artboard-clean` (lettering removed, the Layer-0 the editable overlays
   sit on). Both are persisted to `designiq_generations.master_artboard_url`
   / `master_artboard_clean_url` (lines 3427, 3489).
   Every one of the 205 rows with a master artboard (2026-06-04 to
   2026-08-02) that was sampled is 3168×1344: a continuous 21:9 strip with
   no panels, no labels and no vehicle. Previews:
   `docs/ab/premigration-flamingo-d0c43c25-*.jpg`,
   `docs/ab/premigration-harbor-3ff0a82a-*.jpg`, and the whole chain in
   `docs/ab/premigration-flamingo-d0c43c25-chain.jpg`.
3. **Panels are code crops of that strip.** `buildProductionPanels.ts`
   → `panel-artboard-generator step:"gridslice"` (`index.ts:1623-1692`):
   cover-fit the WHOLE strip to each side's trim aspect, crop the overscan,
   add the 5" bleed by mirroring the strip's own edges, 150 ppi cap. Pure
   geometry. Every side gets the same composition, scaled and cropped to
   its aspect. Passenger is the driver panel mirrored with the logo
   overlays lifted and re-dropped un-flipped (`mirrorpanel`).
4. **Branding is a layer, not a bake**, wherever the clean strip exists:
   LayerLiftIQ overlays on the clean Layer-0.

## 2. What was NOT the working path

- **`mode:"artboard"` (the labeled multi-panel sheet) is disabled in
  RestylePro** (`useDesignPanelProLogic.ts:1131`, `hasArtboardInput =
  false`), with the reason recorded above it: *"the pre-hero artboard-first
  PROJECTION is DISABLED. It made A.C.E. paint a flat 2K sheet first and
  then re-interpret it onto the vehicle ... the projection softened +
  drifted the design."* And: *"`mode:'artboard'` was an experimental
  flat-first path that escaped into the customer flow and became a hard
  precondition for the hero render."*
- **The few-shot example artboards** (`wrap-files flat panel`, two labeled
  Forged Fitness sheets, 3443×1976, bucket created 2026-06-08) only ever
  fed that disabled mode. The bucket does not exist on the DesignProAI
  project (`wozyamlnygaddievzuwn` has one bucket, `wrap-files`). Nothing
  in the sanctioned July chain read it.
- **`designpro-artboard`** (AI paints clean artwork, CODE composes the
  labeled, dimensioned panel sheet with ImageScript) exists and is the
  code-owned "unroll sheet" the owner's 2026-09-11 Tier 3 describes. It is
  not in the July customer chain either.
- **`panelize-artboard`** (Gemini at temperature 0 locating each labeled
  panel's rectangle, code cropping it) exists for a LABELED sheet or a 2D
  proof. On a continuous strip it has nothing to locate; the strip path is
  `gridslice`.

## 3. How well it worked, by its own measurement

`generate-2d-proof/index.ts:3302-3312` (commit `a3e4917`, 2026-07-30):
*"of 148 designs that produced a 2D proof in the prior 90 days, only 72
(48.6%) also emitted a branded artboard and 36 (24.3%) a clean one."*
That commit added the four-attempt aspect/size ladder and the per-attempt
diagnostics. No later measurement of the pass rate is recorded before the
migration.

Two defects in the same frames are recorded in
`docs/LAST-WORKING-STATE-2026-07-24.md` (passenger lettering printed
backwards; hood/roof/front/rear are the driver strip cover-cropped, so a
centre surface can carry the middle of the flank composition rather than
its own artwork). The 2026-09-06 rejection of `a503b91b` ("its center
surfaces repeat one source band") is the same property, seen again.

## 4. What this means for the DesignProAI Call 1

The pre-migration source of every print panel was ONE CONTINUOUS FIELD
with no panels, no labels and no vehicle in it, cut by code. That is the
one-field contract, which is now the primary Call 1 on this branch
(`resolvePrimaryAuthoringTopology`, 2026-09-11). The differences that
remain, each an owner decision, not a bug:

| July (RestylePro) | now (this branch) | note |
|---|---|---|
| the field is an EDIT of the driver 3D view: remove the vehicle, keep the design, extend to the edges | the field is text-to-image from the brief, no vehicle image | the edit inherits the persona's on-vehicle composition (RULE 0.1's gold standard) at the cost of a second image call and a 48.6% pass rate before `a3e4917`; the direct call measured 0 body lines in 17 of 18 |
| 21:9 at 2K (3168×1344), nearest ratio to the flank | 1:1 at 4K (4096²), thirds cut in code | a wide field composes as a flank; the square puts lettering across the cut (3 of 5 clean draws) |
| every side is the whole strip cover-fit to its aspect | six territories, each its own region | cover-fit never slices lettering and never leaves a side empty; it repeats the flank on the centre surfaces |
| clean Layer-0 + editable overlays | lettering baked into the field | the overlay is what made the passenger mirror read forward |
| no deterministic gate; the operator looked at the pair | near-black hole gate, output-class gate, both terminal | the gates were added for holes the edit prompt never produced, because it removed the vehicle from an image that had one |

Nothing in this document changes code. It is the trace the owner asked for.
