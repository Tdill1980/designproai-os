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

## 5. Test 15 — from four real pre-migration heroes to the flat field (run `34567769071`)

Owner, 2026-09-11: *"the 3D design portion must be coded like we had prior
to migration — it worked 99% accuracy, we did over 500 designs."* So the
design step is the hero, and the open question is the flat step. Four real
heroes from the RestylePro database (`scripts/fixtures/premigration-heroes.json`:
Flamingo Pools F-250, Harbor Line Transit, Designer Dental Urus, McLaren
720S watercolor), each turned into a flat field two ways, one image call
each, `scripts/atlas-hero-to-field-ab.mjs`, workflow test `15-hero-to-field`.

| hero | R: one-field Call 1, hero as `exact_reference`, 1:1 4K, thirds cut | E: the July edit verbatim, 21:9 2K |
|---|---|---|
| Flamingo | faithful; a white field fills the roof territory, gate REFUSES (`roof lumaStddev=1.04`); glare band | faithful, clean; a light margin around the strip |
| Harbor Line | faithful; the contact bar painted TWICE; glare band; the DRIVER cut slices the anchor logo in half | faithful, clean, full bleed, one contact bar |
| Designer Dental | design faithful but staged as a MOUNTED square on a wall; 4 near-black cut-out flags | faithful, clean, full bleed |
| McLaren | faithful watercolor, but the word JAPANEASE from the brief painted as lettering; DRIVER cut slices it | faithful, clean, full bleed, no lettering |
| no vehicle drawn | 4 of 4 | 4 of 4 |
| usable as the flat master as returned | 1 of 4 (Harbor, with the duplicated bar) | 3 of 4 clean, 4 of 4 faithful |
| time per call | 50–55 s | 22–30 s |

Previews: `docs/ab/hero-to-field-34567769071-sheet-*.jpg` (hero, R, R driver
cut, E per hero) and the individual `-1600.jpg` files.

**Reading.** Given the approved hero, the July edit request reproduces the
design flat, at the flank's own proportions, without the vehicle, in every
one of four tries, in under half a minute. Its 2026-07-30 pass rate (48.6%)
was measured on the `-preview` model with a silent retry loop; on the GA
model with the request sent once it went 4 for 4 here. The direct one-field
call with the hero as reference also never drew the vehicle, but the square
canvas and the thirds cut are the wrong shape for a design composed along a
flank: they slice logos, invite mounts, and let brief words become lettering.

**The collision the owner has to rule on.** CLAUDE.md, 2026-08-29: *"No
pixel originating from a 3D proof may ever become a Call-8 surface,
production panel, print file, or ZIP asset."* That ruling was made after
Northgate's panels turned out to be crops of proof photographs, and it is
what makes a Standard run fail at `panels.build` today
(`production_panels_not_created`). The July flat step is an edit OF the hero,
so it is pixels descended from a 3D render, transcribed flat by the model
rather than cropped from the photograph. Restoring "the 3D design portion as
before" with print files means reversing that ruling for the transcription
case, or not restoring it. Nothing in this document changes code.
