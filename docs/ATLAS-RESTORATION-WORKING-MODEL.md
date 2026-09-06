# A.T.L.A.S. RESTORATION — VERIFIED TRACE, ORIENTATION SHEET, EXACT PROMPTS AND MINIMAL DIFF

Read-only. Baseline `origin/main` = `f2deb79cdfdf055c58e9978c3177bf3fa728aac8`.
Nothing applied: no repo file edited, no branch, no commit, no PR, no deploy,
no migration, no database write, no generation, no provider call. The divergent
branch `claude/dca-phase-1-execution-47019t` is not used and not merged.

---

# ITEM 1 — TERMINOLOGY CORRECTION (diff prepared, NOT applied)

## The four facts

| # | Correct fact | Evidence |
|---|---|---|
| 1 | **Supabase edge deployment version = 74** | Management API: `design-panel-ai-generate`, id `03f507ce…`, `version: 74`, updated 2026-09-02T20:59:40.324Z, `ezbr_sha256 ef567a7fc025bccb…` |
| 2 | **"v24" is prompt/architecture release terminology**, not an edge deployment version | `ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq.20260902.v24-one-field"` (index.ts:52); `PROMPT_VERSION = "designpro-flat-first-atlas-20260902.v24-one-field"` (flat-first-atlas.cjs:69) |
| 3 | **`buildDesignIQPrompt`, defined inside the deployed edge index, is the actual Call-1 prompt assembly** | `handleAtlasArtboard` calls it at index.ts:2364 with `atlasFlatMaster: true` |
| 4 | **RULE 0.26's referenced prompt files are stale** | `_shared/atlas-artboard-prompt.ts` does not exist on `origin/main`; `_shared/persona-designer-prompt.ts` exists but is **not** among the 12 files deployed with the function |

Deployment readback: all 12 deployed files hash byte-identical to `origin/main`,
including the RULE 0.29 pins `studio-os.ts` `7b02814bb1e9e867` and
`view-angles-os.ts` `8890be50c124a2c5`. The deployed `index.ts` is
`4e8fde920142c6b5`, equal to `origin/main` and to the working tree.

## Prepared documentation-only diff

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@
-- **Both runtime replicas reported release `f2deb79c` through `/health`;
-  `design-panel-ai-generate` edge version 24 was deployed** (owner-supplied
-  readback, 2026-09-03). The edge function is NOT bound to that Git SHA
-  without a deployed-byte readback receipt. The product Call-1 path calls the
-  edge's one-field branch (rejected, RULE 0.34); the earlier single-call
-  six-surface A.T.L.A.S. topology branch of the same function is still
-  present and, for its fixture, byte-identical to the v23 assembly.
+- **Both runtime replicas reported release `f2deb79c` through `/health`**
+  (owner-supplied readback, 2026-09-03; the runtime `/health` ports are bound
+  to localhost on the droplet and Caddy answers 404 for every `/worker/*`
+  path, so this cannot be re-read without droplet shell access).
+- **`design-panel-ai-generate` is at Supabase edge deployment VERSION 74**,
+  deployed 2026-09-02T20:59:40Z — 28 minutes before generation `1a0e6b70`
+  began, so that run executed against these exact bytes. Measured 2026-09-03
+  through the Management API. **"v24" is prompt/architecture release
+  terminology (`…20260902.v24-one-field`), never the edge deployment
+  version; do not compare the two numbers.** Byte readback: all 12 deployed
+  files hash byte-identical to `origin/main`, deployed `index.ts`
+  `4e8fde920142c6b5`.
+- The product Call-1 path calls the edge's one-field branch (rejected,
+  RULE 0.34). **The earlier single-call six-surface A.T.L.A.S. topology
+  branch of the same function is still deployed and merely BYPASSED**: it is
+  selected whenever the request body carries no `fieldContract`.
@@
-| 1 | Call 1 A.T.L.A.S. is the SOLE creative authority | **DEPLOYED-VERIFIED** | deployed `design-panel-ai-generate` index.ts hashes `a5b3c1e850d7eca4`, byte-identical to the branch; `tests/atlas-sole-design-authority.test.mjs` |
+| 1 | Call 1 A.T.L.A.S. is the SOLE creative authority | **DEPLOYED-VERIFIED (re-measured 2026-09-03)** | deployed `design-panel-ai-generate` v74 index.ts hashes `4e8fde920142c6b5`, byte-identical to `origin/main`; all 11 shared deps match; `tests/atlas-sole-design-authority.test.mjs` |
```

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ RULE 0.26
-- The prompt assembly is ONE canonical module,
-  `supabase/functions/_shared/atlas-artboard-prompt.ts`: it EXECUTES the real
-  `buildDesignerPrompt` (never re-types it), swaps ONLY the presentation tail
+- **CORRECTION (measured 2026-09-03): `_shared/atlas-artboard-prompt.ts` does
+  not exist on `main`, and `_shared/persona-designer-prompt.ts` is not among
+  the 12 files deployed with the function. The real Call-1 prompt assembly is
+  `buildDesignIQPrompt`, defined INSIDE
+  `supabase/functions/design-panel-ai-generate/index.ts` and invoked by
+  `handleAtlasArtboard` with `atlasFlatMaster: true`. The paragraph below is
+  retained as the historical intent.** The assembly
+  EXECUTES the real designer prompt (never re-types it), swaps ONLY the presentation tail
   (studio scene, side camera, on-vehicle photo lines) for the flat-master
```

---

# ITEM 2 — ORIENTATION SHEET (deterministic, no provider call)

Produced by compiling `origin/main`'s `runtime/flat-first-atlas.cjs` in memory
and calling its real `buildAtlasManifest` with the actual GENIE trim inches for
the 2022 Ford F250 Crew Cab, read from the stored manifest of revision
`16154e4d` (generation `1a0e6b70`).

```
manifest.contract  designpro.flat-first-atlas-manifest.v1
manifest.topology  rectangular-preview-v1
canvas             4096 x 4096
installerMap       {"passenger":"left","driver":"right",
                    "centerOrderTopToBottom":["rear","roof","hood","front"],
                    "longitudinalOrder":"vehicle-rear-to-front"}
per-zone noseEdge  ABSENT on the six-surface manifest
```

## The rotation convention, MEASURED not assumed

`cutCallOnePanels` does `sharp(master).extract(zone.extraction).rotate(zone.extraction.outputRotationDegrees)`.
A test image with a uniquely coloured band on each edge was extracted and
rotated by both values actually used. Result:

| `.rotate()` | output TOP | output RIGHT | output BOTTOM | output LEFT |
|---|---|---|---|---|
| `-90` (passenger) | drawn RIGHT | drawn BOTTOM | drawn LEFT | drawn TOP |
| `+90` (driver) | drawn LEFT | drawn TOP | drawn RIGHT | drawn BOTTOM |

## The sheet

| | PASSENGER | REAR | ROOF | HOOD | FRONT | DRIVER |
|---|---|---|---|---|---|---|
| placement | left-flank | center-column | center-column | center-column | center-column | right-flank |
| canvas rect x,y | 192, 624 | 1417, 329 | 1417, 1304 | 1417, 2310 | 1417, 3368 | 2751, 624 |
| canvas rect w×h | 1153×2848 | 1262×939 | 1262×970 | 1262×1022 | 1262×399 | 1153×2848 |
| drawn shape | portrait | landscape | landscape | landscape | landscape | portrait |
| stored rotation | **+90** | 0 | 0 | 0 | 0 | **−90** |
| extraction rect | = canvas rect | = canvas rect | = canvas rect | = canvas rect | = canvas rect | = canvas rect |
| `outputRotationDegrees` | **−90** | 0 | 0 | 0 | 0 | **+90** |
| trim rect x,y,w,h | 279,711,979,2674 | 1490,402,1116,793 | 1492,1379,1112,820 | 1494,2387,1108,868 | 1462,3413,1172,309 | 2838,711,979,2674 |
| trim / print inches | 153×56 / 163×66 | 76×54 / 86×64 | 74.3×54.8 / 84.3×64.8 | 71.5×56 / 81.5×66 | 129×34 / 139×44 | 153×56 / 163×66 |
| effective PPI | 17.47 | 14.67 | 14.97 | 15.48 | 9.07 | 17.47 |
| final production orientation | 3565×1224 landscape | 1262×939 | 1262×970 | 1262×1022 | 1262×399 | 3565×1224 landscape |

## Drawn edge → production edge, per surface

| surface | drawn TOP → | drawn RIGHT → | drawn BOTTOM → | drawn LEFT → |
|---|---|---|---|---|
| PASSENGER (out −90) | production LEFT | production TOP | production RIGHT | production BOTTOM |
| DRIVER (out +90) | production RIGHT | production BOTTOM | production LEFT | production TOP |
| REAR / ROOF / HOOD / FRONT (out 0) | TOP | RIGHT | BOTTOM | LEFT |

## Nose edge — derived and cross-checked by three independent facts

The six-surface manifest declares no per-zone nose edge, so it is derived:

1. `installerMap.longitudinalOrder = "vehicle-rear-to-front"` with
   `centerOrderTopToBottom = [rear, roof, hood, front]` puts **vehicle-front at
   the BOTTOM** of the centre column.
2. A fold-out unwrap keeps the longitudinal axis aligned across all six
   surfaces, so each flank column also runs vehicle-rear at top to
   vehicle-front at bottom. **Drawn nose edge = BOTTOM for both flanks.**
3. Apply the measured rotation table: passenger drawn BOTTOM → production
   **RIGHT**; driver drawn BOTTOM → production **LEFT**.

That reproduces the codebase's only nose-edge declaration exactly —
`NOSE_EDGE = { driver: "left", passenger: "right" }`
(`atlas-field-territories.cjs:33`). Three independent sources agree.

| surface | nose (vehicle front) in DRAWN space | nose in PRODUCTION space | roof-side edge in DRAWN space |
|---|---|---|---|
| PASSENGER | BOTTOM of the left column | RIGHT | drawn RIGHT (faces the sheet centre) |
| DRIVER | BOTTOM of the right column | LEFT | drawn LEFT (faces the sheet centre) |

**Both flank columns carry their roof-side edge facing the centre column and
their vehicle-front at the bottom.** That is a consistent fold-out unwrap, and
it is the fact the prompt's sweep wording must agree with.

**Consequence for the wiring defect.** `atlasEdgeRequestBody` currently sends
`manifest?.installerMap?.noseEdge || NOSE_EDGE`. The six-surface `installerMap`
has no `noseEdge`, so it falls back to the print-space constant
`{driver:"left", passenger:"right"}` and hands a **print-space** edge to a
prompt describing a **drawn** rotated column. Under the mapping above the
correct drawn values are `{driver:"bottom", passenger:"bottom"}`. This is a
deterministic wiring error, and it is the same failure class as the recorded
"inverted rear, mirrored passenger" on `84a3eadf`.

**Still to verify before a draw:** render `renderAtlasAuthoringGuide(manifest)`
and the labelled installer map from this manifest and confirm visually that
rear sits at the top of the centre column and front at the bottom. That is a
local render with no provider call; it is not included here because plan mode
forbids writing the image file. It is step 1 of the authorized test.

---

# ITEM 3 — THE THREE COMPLETE PROMPTS

Assembled by executing the deployed `buildDesignIQPrompt` through the repo's
own harness (`tests/helpers/load-designiq.mjs` → `scripts/build-control-prompt.mjs`),
against the real stored fixture for generation `1a0e6b70`: 2022 Ford F250 Crew
Cab, Precision Climate Solutions, Gloss, commercial, no references, no phone,
no website. The working tree, `origin/main` and the deployed function all hash
`4e8fde920142c6b5`, so these are the deployed bytes.

## 3A — CURRENTLY DEPLOYED ONE-FIELD PROMPT (what `1a0e6b70` sent)
`3908 chars · sha256 ff04b18b7d220db8616cb90f3868a28ec99a6fb8d7a92a71b6603c1df632dcdd`

```text
You are the senior vehicle-wrap designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.

Design the printed wrap artwork for a 2022 Ford F250 Crew Cab (truck) as ONE continuous full-bleed field of pure printed vinyl artwork — the way the vinyl looks coming off the printer before anything is cut or applied, never an on-vehicle photograph. This is the single design authority for the complete vehicle — one design, one composition. The design is built from layered elements — background color and texture flowing continuously across the whole field, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare vinyl. The company name reads clearly at a glance; how the branding is composed is your creative call.

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif company name, high contrast and legible at highway distance."
Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment ("stealth bomber" becomes angular faceted plates with sharp swept edges). What the client named should be obvious at a glance.

CLIENT BRIEF:
Business: Precision Climate Solutions.
Spell the business name exactly. This business needs its own logo — decide its form from this brief alone.
No phone number was provided — show the company name only and add no contact information.
No website was supplied — invent no website, email address or street address, and display none anywhere on the design.

When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism — lifelike detail, natural light, depth, and dimension, crisp and high-resolution as if professionally photographed, then printed cleanly onto the vinyl.
Finish: GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the printed graphic elements. The vinyl finish is gloss across the whole field — one consistent finish throughout.
The artwork fills the entire field edge to edge — solid printed vinyl, corner to corner.

OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.
Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact 2022 Ford F250 Crew Cab (truck) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.

Compose it in three equal horizontal thirds that read as one picture:
• THE UPPER THIRD — the primary hero passage: a complete, wide statement of the design, the company name whole and legible inside it, clear of the third's top and bottom edges. Forward energy sweeps left to right.
• THE MIDDLE THIRD — a second hero passage telling the brand story in full, composed afresh as its own arrangement, the company name whole and legible inside it too. Forward energy sweeps right to left.
• THE LOWER THIRD — the supporting register: the same ground, palette and motion at a calmer intensity, secondary motifs, finished artwork everywhere. The brand mark may appear here once, compact and whole; every other letter lives in the upper two thirds.

Lettering reads left to right throughout. Each focal element sits inside one third; the ground and its motion flow through all three continuously, so the transitions are invisible. Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.
```

Model request: 1 text part, 0 image parts (no customer references on this
fixture), `gemini-3-pro-image`, `responseModalities ["TEXT","IMAGE"]`,
`imageConfig {aspectRatio "1:1", imageSize "4K"}`, no `temperature`.

## 3B — CURRENTLY DEPLOYED SIX-SURFACE PROMPT (present, bypassed)
`4443 chars · sha256 bae1d8c4541d4923d422b68c5368f7019e8c55e319947fca8ac58f396a5a8eed`

This hash matches the value `CLAUDE.md` already records for this fixture,
which independently confirms the harness is faithful.

```text
You are the senior vehicle-wrap designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.

Design the printed wrap artwork for a 2022 Ford F250 Crew Cab (truck) as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. This is the single design authority for the complete vehicle, not six independent graphics. The design is built from layered elements — background color and texture flowing across the panels, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel. The company name reads clearly at a glance; how the branding is composed is your creative call.

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif company name, high contrast and legible at highway distance."
Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment ("stealth bomber" becomes angular faceted panels with sharp swept edges). What the client named should be obvious at a glance.

CLIENT BRIEF:
Business: Precision Climate Solutions.
Spell the business name exactly. This business needs its own logo — decide its form from this brief alone.
No phone number was provided — show the company name only and add no contact information.
No website was supplied — invent no website, email address or street address, and display none anywhere on the design.

When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism — lifelike detail, natural light, depth, and dimension, crisp and high-resolution as if professionally photographed, then printed cleanly onto the vinyl.
Finish: GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the printed graphic elements. The vinyl finish is gloss across every panel — consistent finish on every surface.
The artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.

OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD on one square 4K canvas.
Design ONE flat vehicle-wrap A.T.L.A.S. ARTBOARD for this exact 2022 Ford F250 Crew Cab (truck) — the full wrap laid out FLAT as rectangular print panels on one sheet — the complete flattened panel layout of the vehicle. The output is flat print artwork on a 2D sheet.

Lay out these panels, the wrap artwork filling each panel edge to edge, and the SAME cohesive design flowing across every panel as ONE CONNECTED WRAP UNWRAPPED FLAT:
• PASSENGER SIDE — the tall panel down the left
• DRIVER SIDE — the tall panel down the right
• REAR, then ROOF, then HOOD, then FRONT — the centre column, top to bottom

Fill every panel corner to corner; the space between panels is sheet separation. Set no panel names, surface IDs, legends or captions anywhere in the artwork — those words are for the server, never for the sheet.

One wrap, unwrapped. The left and right flanks are the two sides of the SAME vehicle carrying the SAME design — the palette, the imagery, the motion and the branding continue from one to the other, and a person walking around the finished truck sees one design, not two. The centre panels carry that same composition across the truck's top and ends. Customer-facing wording reads normally on every panel.

Every panel is opaque, unbroken and full-bleed to all four edges: flat printed graphic art, the same kind of image as a printed poster or a roll of printed vinyl laid flat on a table. It is the artwork by itself, before anything is cut or applied. Customer-requested photographic imagery is a photograph printed INTO that flat art. Vehicle appearance, installed boundaries and presentation lighting are produced downstream by the seven proof projections and are absent here.

Gallery-grade custom artwork with real depth, movement and a wow factor — never generic AI filler, never a template. Output ONE flat 2D artboard sheet, drawn straight-on and flat for printing.
```

Model request: 1 text part **plus 2 role-text parts and 2 image parts** — the
labelled Flamingo teaching proof (`684534d2…`) and the neutral six-region
guide, guide last. Same model, aspect ratio, resolution and absent temperature.

## 3C — PROPOSED PROMPT FOR THE FIRST AUTHORIZED DRAW

**Byte-identical to 3B. Zero prompt-text change.**
`4443 chars · sha256 bae1d8c4541d4923d422b68c5368f7019e8c55e319947fca8ac58f396a5a8eed`

The proposed first draw changes **no prompt text at all**. It changes only:
the manifest (six-surface instead of thirds), the request keys that select the
already-deployed six-surface branch, and the verified nose-edge value — which
this prompt does not consume, because `atlasFieldContract` is not called on
this branch.

## 3D — LITERAL UNIFIED PROMPT DIFF

**Deployed one-field (3A) → proposed (3C):**

```diff
-Design the printed wrap artwork for a 2022 Ford F250 Crew Cab (truck) as ONE continuous full-bleed field of pure printed vinyl artwork — the way the vinyl looks coming off the printer before anything is cut or applied, never an on-vehicle photograph. This is the single design authority for the complete vehicle — one design, one composition. The design is built from layered elements — background color and texture flowing continuously across the whole field, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare vinyl. The company name reads clearly at a glance; how the branding is composed is your creative call.
+Design the printed wrap artwork for a 2022 Ford F250 Crew Cab (truck) as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. This is the single design authority for the complete vehicle, not six independent graphics. The design is built from layered elements — background color and texture flowing across the panels, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel. The company name reads clearly at a glance; how the branding is composed is your creative call.
@@
-Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment ("stealth bomber" becomes angular faceted plates with sharp swept edges). What the client named should be obvious at a glance.
+Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment ("stealth bomber" becomes angular faceted panels with sharp swept edges). What the client named should be obvious at a glance.
@@
-Finish: GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the printed graphic elements. The vinyl finish is gloss across the whole field — one consistent finish throughout.
-The artwork fills the entire field edge to edge — solid printed vinyl, corner to corner.
+Finish: GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the printed graphic elements. The vinyl finish is gloss across every panel — consistent finish on every surface.
+The artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.
@@
-OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.
-Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact 2022 Ford F250 Crew Cab (truck) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.
-
-Compose it in three equal horizontal thirds that read as one picture:
-• THE UPPER THIRD — the primary hero passage: a complete, wide statement of the design, the company name whole and legible inside it, clear of the third's top and bottom edges. Forward energy sweeps left to right.
-• THE MIDDLE THIRD — a second hero passage telling the brand story in full, composed afresh as its own arrangement, the company name whole and legible inside it too. Forward energy sweeps right to left.
-• THE LOWER THIRD — the supporting register: the same ground, palette and motion at a calmer intensity, secondary motifs, finished artwork everywhere. The brand mark may appear here once, compact and whole; every other letter lives in the upper two thirds.
-
-Lettering reads left to right throughout. Each focal element sits inside one third; the ground and its motion flow through all three continuously, so the transitions are invisible. Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.
+OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD on one square 4K canvas.
+Design ONE flat vehicle-wrap A.T.L.A.S. ARTBOARD for this exact 2022 Ford F250 Crew Cab (truck) — the full wrap laid out FLAT as rectangular print panels on one sheet — the complete flattened panel layout of the vehicle. The output is flat print artwork on a 2D sheet.
+
+Lay out these panels, the wrap artwork filling each panel edge to edge, and the SAME cohesive design flowing across every panel as ONE CONNECTED WRAP UNWRAPPED FLAT:
+• PASSENGER SIDE — the tall panel down the left
+• DRIVER SIDE — the tall panel down the right
+• REAR, then ROOF, then HOOD, then FRONT — the centre column, top to bottom
+
+Fill every panel corner to corner; the space between panels is sheet separation. Set no panel names, surface IDs, legends or captions anywhere in the artwork — those words are for the server, never for the sheet.
+
+One wrap, unwrapped. The left and right flanks are the two sides of the SAME vehicle carrying the SAME design — the palette, the imagery, the motion and the branding continue from one to the other, and a person walking around the finished truck sees one design, not two. The centre panels carry that same composition across the truck's top and ends. Customer-facing wording reads normally on every panel.
+
+Every panel is opaque, unbroken and full-bleed to all four edges: flat printed graphic art, the same kind of image as a printed poster or a roll of printed vinyl laid flat on a table. It is the artwork by itself, before anything is cut or applied. Customer-requested photographic imagery is a photograph printed INTO that flat art. Vehicle appearance, installed boundaries and presentation lighting are produced downstream by the seven proof projections and are absent here.
+
+Gallery-grade custom artwork with real depth, movement and a wow factor — never generic AI filler, never a template. Output ONE flat 2D artboard sheet, drawn straight-on and flat for printing.
```

**Deployed six-surface (3B) → proposed (3C): empty diff. No change.**

---

# ITEM 4 — HYPOTHESIS CLASSIFICATION, CORRECTED

**The owner is right and my earlier framing was wrong.** Replacing the thirds
paragraph with six spatial A.T.L.A.S. regions IS a topology-text change, and I
should not have claimed otherwise or called it "the only matrix cell never
drawn" without a complete matrix.

**So the proposed first draw abandons that idea entirely.** It changes no
prompt text. The corrected position:

> The six-surface conditioning has never been run against a **verified**
> orientation mapping. `84a3eadf`'s recorded defects were "wheel arches and
> body lines painted as artwork, **inverted rear, mirrored passenger**".
> Inversion and mirroring are orientation failures. The runtime feeds a
> **print-space** nose edge into a layout whose flanks are drawn rotated ±90°,
> and the six-surface manifest declares no nose edge at all. Draw 1 tests one
> variable — the corrected orientation wiring — against the byte-identical
> deployed six-surface prompt.

If Draw 1 still paints wheel arches, that isolates anatomy as a genuine
conditioning defect, separate from orientation, and only then is a prompt-text
experiment justified. Any such follow-up must be classified honestly as a
topology-text variation and placed in the matrix.

**A complete experiment matrix is being extracted from the repository's own
evidence documents** (`docs/ATLAS-CALL1-*`, `docs/ATLAS-FIELD-*`,
`docs/ATLAS-ANCHOR-*`, `docs/ATLAS-TEACHING-PROOF-*`, `docs/ab/`) and will be
appended before any prompt-text proposal is put forward. No prompt-text
variation should be approved until that matrix is complete and shows the exact
cell is untested.

---

# ITEM 5 — PRINTED-TEXT AND FURNITURE GUARANTEE

The proposed prompt (3C) already carries both mitigations that the deployed
one-field tail lacks, verbatim in the deployed bytes:

| risk | sentence already present in 3C |
|---|---|
| printed region names / labels / legends | "Set no panel names, surface IDs, legends or captions anywhere in the artwork — those words are for the server, never for the sheet." |
| frames, borders, gutters as drawn furniture | "Fill every panel corner to corner; the space between panels is sheet separation." |
| template furniture generally | "never generic AI filler, never a template" |

**This is direct evidence about v24's rendered-label defect.** The one-field
tail contains neither sentence, and `1a0e6b70` came back with "UPPER THIRD" /
"MIDDLE THIRD" printed into the sheet and grey frame strips. The six-surface
tail forbids exactly those two outcomes in its own words.

"Named by position" is therefore prompt semantics only in 3C: the surface names
appear in the instruction and are explicitly excluded from the pixels. No
change is needed to satisfy this item, because the proposal is the deployed
text unchanged.

---

# ITEM 6 — EXACT MINIMAL CODE DIFF FROM origin/main

Scope check first, because "stop sending `fieldContract`" alone is **not**
sufficient. The deployed six-surface branch requires
`teachingProofStoragePath` (it throws `atlas_artboard_teaching_proof_incomplete`
without it) and downloads inputs only from paths matching
`^atlas-call1-inputs/[0-9a-f]{64}\.(png|jpg)$`. The v24 runtime no longer
uploads to that prefix; only the harness scripts do. So the minimal diff also
restores the two Call-1 input uploads.

```diff
--- a/runtime/flat-first-atlas.cjs
+++ b/runtime/flat-first-atlas.cjs
@@ -42,7 +42,10 @@
-const { buildFieldTerritories, NOSE_EDGE } = require("./atlas-field-territories.cjs");
+// NOSE_EDGE is the PRINT-space declaration. `buildFieldTerritories` is a
+// harness module only: the product path authors on the six-surface topology.
+const { NOSE_EDGE } = require("./atlas-field-territories.cjs");
+const { loadBundledAtlasTeachingProof } = require("./flat-atlas-topology-examples.cjs");
@@ -66,10 +69,12 @@
-const PROMPT_VERSION = "designpro-flat-first-atlas-20260902.v24-one-field";
-// The model-facing contract the runtime asks the edge for: one continuous
-// full-bleed composition, one text part plus verified customer references,
-// zero structural images. Echoed back by the edge and verified on receipt.
-const ATLAS_FIELD_PROMPT_CONTRACT = "designpro.atlas-field-prompt.v2";
+const PROMPT_VERSION = "designpro-flat-first-atlas-20260903.v25-topology-restored";
+// v24's one-field contract. NOT sent by the product path any more: omitting it
+// is what selects the deployed six-surface A.T.L.A.S. branch inside
+// handleAtlasArtboard. Retained so harness run 33659500846 stays reproducible.
+const ATLAS_FIELD_PROMPT_CONTRACT = "designpro.atlas-field-prompt.v2";
@@ -148,7 +153,7 @@
-const ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq.20260902.v24-one-field";
+const ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq.20260903.v25-topology-restored";
```

```diff
--- a/runtime/flat-first-atlas.cjs
+++ b/runtime/flat-first-atlas.cjs
@@ -1516,6 +1521,34 @@
+/**
+ * THE NOSE EDGE IN DRAWN SPACE, NOT PRINT SPACE.
+ *
+ * On the six-surface topology the flanks are laid down as tall columns rotated
+ * +90 (passenger) and -90 (driver), and `cutCallOnePanels` rotates each crop by
+ * `extraction.outputRotationDegrees` to restore print orientation. Measured
+ * with sharp: rotate(-90) sends drawn BOTTOM to production RIGHT; rotate(+90)
+ * sends drawn BOTTOM to production LEFT. With NOSE_EDGE = {driver:"left",
+ * passenger:"right"} in PRINT space, the drawn nose edge is BOTTOM for both,
+ * which agrees with installerMap.longitudinalOrder "vehicle-rear-to-front"
+ * over centerOrderTopToBottom [rear, roof, hood, front].
+ *
+ * Sending the print value against a rotated region is the defect class
+ * recorded on 84a3eadf as "inverted rear, mirrored passenger".
+ */
+function drawnNoseEdge(manifest) {
+  const edges = {};
+  for (const surfaceKey of ["driver", "passenger"]) {
+    const zone = (manifest?.zones || []).find((z) => z.surfaceKey === surfaceKey);
+    const printEdge = NOSE_EDGE[surfaceKey];
+    const rotation = Number(zone?.rotationDegrees) || 0;
+    if (rotation === 0) { edges[surfaceKey] = printEdge; continue; }
+    if (Math.abs(rotation) !== 90) {
+      throw new FlatAtlasError("flat_atlas_nose_edge_rotation_invalid", `${surfaceKey} rotation ${rotation} is not 0 or +/-90`);
+    }
+    // outputRotationDegrees = -rotationDegrees. Invert the measured mapping.
+    const outRot = -rotation;
+    const map = outRot === -90
+      ? { top: "right", right: "bottom", bottom: "left", left: "top" }
+      : { top: "left", right: "top", bottom: "right", left: "bottom" };
+    edges[surfaceKey] = Object.keys(map).find((drawn) => map[drawn] === printEdge);
+  }
+  return Object.freeze(edges);
+}
+
 function atlasEdgeRequestBody(input, manifest, extras = {}) {
@@ -1564,13 +1597,17 @@
-    // ONE-FIELD CONTRACT (owner ruling 2026-09-02). The edge assembles the
-    // same DesignPanelAI creative brief with the field wording and the field
-    // tail, and sends the model ONE text part plus the verified customer
-    // references. No teaching proof, no guide, no topology text travels. The
-    // `panels` list above stays on the request as OS data the edge validates;
-    // it never enters the field prompt.
-    fieldContract: ATLAS_FIELD_PROMPT_CONTRACT,
-    noseEdge: manifest?.installerMap?.noseEdge || NOSE_EDGE,
+    // NO `fieldContract`. Omitting that one key is what selects the deployed
+    // six-surface A.T.L.A.S. branch inside handleAtlasArtboard, which requires
+    // the teaching proof and presents the neutral guide last. `noseEdge` is
+    // inert on this branch (only atlasFieldContract reads it) and is sent in
+    // DRAWN space so a later consumer cannot pick up a print-space value.
+    noseEdge: drawnNoseEdge(manifest),
+    teachingProofStoragePath: extras.teachingProofStoragePath,
+    teachingProofIdentity: extras.teachingProofIdentity,
+    guideStoragePath: extras.guideStoragePath,
     referenceImagesBase64: extras.referenceImagesBase64,
   };
 }
```

```diff
--- a/runtime/flat-first-atlas.cjs
+++ b/runtime/flat-first-atlas.cjs
@@ -2185,13 +2222,12 @@
-  // GENIE's six-region layout is built first — inches, square feet, bleed,
-  // proof dependencies and the human installer map all come from it — and the
-  // ONE FIELD the model paints is then serialized onto code-only territories
-  // (`field-thirds-v2`): Driver centred in the top third, Passenger centred in
-  // the middle third, roof · hood · front abreast in the lower third with the
-  // rear beneath the shortest of them. Same zone shape, rotation 0 everywhere.
-  // The model is shown none of it.
-  const legacyManifest = buildAtlasManifest(surfaces, geometryAuthority, input?.vehicle?.type);
-  const manifest = buildFieldTerritories(legacyManifest);
+  // THE SIX-SURFACE A.T.L.A.S. TOPOLOGY IS THE MANIFEST (owner direction,
+  // 2026-09-03). PASSENGER down the left as a column rotated +90, REAR → ROOF
+  // → HOOD → FRONT as the centre column, DRIVER down the right rotated -90,
+  // at GENIE inches with 5" bleed. Its `contract` stays MANIFEST_CONTRACT for
+  // every downstream consumer. v24 re-laid these six zones as horizontal
+  // thirds AND overwrote that contract, and the run died before its first
+  // proof. `buildFieldTerritories` remains available to the harness only.
+  const manifest = buildAtlasManifest(surfaces, geometryAuthority, input?.vehicle?.type);
@@ -2236,10 +2272,12 @@
-  // the fence now carries the contract and the territory layout instead, so a
-  // master authored against the six-container request is never reused here.
+  // The fence carries the model-facing teaching-proof identity and the
+  // manifest topology, so a master authored against the v24 thirds request is
+  // never reused here.
   const currentExampleSetHash = sha256(canonicalBytes({
-    atlasDesignTeachingExample: null,
-    fieldContract: ATLAS_FIELD_PROMPT_CONTRACT,
-    territories: manifest.contract,
+    atlasDesignTeachingExample: teachingProof.identity,
+    fieldContract: null,
+    territories: manifest.territoriesContract || null,
     topology: manifest.topology,
   }));
@@ -2857,10 +2895,10 @@
-      atlasFieldContract: ATLAS_FIELD_PROMPT_CONTRACT,
-      territoriesContract: manifest.contract,
+      atlasFieldContract: null,
+      territoriesContract: manifest.territoriesContract || null,
       fieldLayout: manifest.fieldLayout || null,
```

Plus the two Call-1 input uploads, immediately before `atlasEdgeRequestBody` is
called, using the store helper the file already uses everywhere else:

```diff
+  // THE TWO CALL-1 INPUTS THE SIX-SURFACE EDGE BRANCH DOWNLOADS. The edge
+  // accepts only `atlas-call1-inputs/<sha256>.(png|jpg)` and re-hashes the
+  // bytes, so the path IS the integrity check.
+  const teachingProof = loadBundledAtlasTeachingProof();
+  const teachingBytes = Buffer.from(teachingProof.flattenedTopView.bytes);
+  const authoringGuideBytes = await renderAtlasAuthoringGuide(manifest);
+  const teachingInputPath = `atlas-call1-inputs/${sha256(teachingBytes)}.png`;
+  const guideInputPath = `atlas-call1-inputs/${sha256(authoringGuideBytes)}.png`;
+  await Promise.all([
+    store.putImmutableBytes({ storagePath: teachingInputPath, bytes: teachingBytes, contentType: "image/png" }),
+    store.putImmutableBytes({ storagePath: guideInputPath, bytes: authoringGuideBytes, contentType: "image/png" }),
+  ]);
```
and the extras passed through:
```diff
-  const edgeBody = atlasEdgeRequestBody(input, manifest, { referenceImagesBase64 });
+  const edgeBody = atlasEdgeRequestBody(input, manifest, {
+    referenceImagesBase64,
+    teachingProofStoragePath: teachingInputPath,
+    teachingProofIdentity: teachingProof.identity,
+    guideStoragePath: guideInputPath,
+  });
```

## What this diff does and does not touch

| requirement | how it is met |
|---|---|
| six-surface branch executes | `fieldContract` removed from the body; `handleAtlasArtboard` falls to the six-container branch |
| orientation / nose edge corrected | `drawnNoseEdge()`, derived from the measured rotation table and cross-checked three ways |
| canonical manifest contract preserved | `buildFieldTerritories` is never called on the product path, so `manifest.contract` is `MANIFEST_CONTRACT` by construction |
| consumer identity guards unchanged | `flat-first-atlas.cjs:2022` and `:3004` are **not in the diff**. No accept-set, no allowlist, no compatibility branch |
| GENIE prep preserved | prep consumption, `geometryResolution`, `genieManifestHash` are outside the diff |
| identity lineage preserved | `generationId`, `designId`, `revisionId`, `master_content_hash`, `manifest_content_hash`, `panelSourceHash` untouched |
| deterministic panel extraction preserved | `cutCallOnePanels` untouched; it already honours `extraction.outputRotationDegrees` |
| immediate PanelPro persistence preserved | `onSurfaceReady` / progressive publication untouched |
| edge function | **no edge change at all** — the branch is already deployed |
| divergent branch | not imported, not merged, not referenced |

**Producer-side manifest correction, additionally, so the defect cannot recur
in the harness:**

```diff
--- a/runtime/atlas-field-territories.cjs
+++ b/runtime/atlas-field-territories.cjs
@@ -231,7 +231,13 @@ function buildFieldTerritories(legacyManifest) {
   return {
     ...legacyManifest,
-    contract: FIELD_TERRITORIES_CONTRACT,
+    // The atlas manifest keeps its own identity: `contract` is inherited from
+    // legacyManifest above and stays MANIFEST_CONTRACT. Overwriting it here is
+    // what killed generation 1a0e6b70 with flat_atlas_conditioning_invalid
+    // before a single proof was requested. The territory layout gets its own
+    // named field, and no consumer guard is relaxed to accommodate it.
+    territoriesContract: FIELD_TERRITORIES_CONTRACT,
     topology: FIELD_TOPOLOGY,
```

---

# ITEM 7 — THE FUTURE AUTHORIZED TEST

**Exactly one Gemini image call. Stop after the raw master, canonical master
and six panels are persisted and displayed. No 3D proofs until the owner
approves the Call-1 A.T.L.A.S. visually.**

## Step 0 — no provider call
Render `renderAtlasAuthoringGuide(manifest)` and the labelled installer map
from the six-surface manifest above and confirm visually: rear at the top of
the centre column, front at the bottom, both flank columns with their
roof-side edge facing the centre. Local render, no provider call. If this
disagrees with the orientation sheet, stop and re-derive.

## Step 1 — the gate
```diff
--- a/runtime/generation-worker.cjs
+++ b/runtime/generation-worker.cjs
@@ launchAtlasProof
       const launchAtlasProof = ({ atlas, sourceViewType, prerequisites = [] }) => {
+        // CALL-1-ONLY STOP. Set for an authorized Call-1 acceptance draw: the
+        // master and the six panels persist and publish exactly as normal, and
+        // the run halts before any proof request. Clearing the flag and
+        // re-queueing resumes from the SAME persisted revision -- the authoring
+        // fence makes a second Call 1 impossible -- so the proofs later run
+        // from the identical canonical master.
+        if (String(process.env.DESIGNPRO_ATLAS_CALL1_ONLY || "") === "1") {
+          throw new FlatAtlasError("flat_atlas_call1_only_stop", "Call-1 acceptance draw: stopping before 3D proofs for owner visual review");
+        }
         if (progressiveProofRuns.has(sourceViewType)) return progressiveProofRuns.get(sourceViewType);
```
Non-retryable, so the request settles at `failed` with the code
`flat_atlas_call1_only_stop` while the master and panels are already persisted
and visible in PanelPro. Nothing is left looping.

## Step 2 — what to report, in this order
1. **Raw master** as returned by Gemini, before normalization.
2. **Canonical master** with GenerationID, DesignID, RevisionID, raw sha256,
   canonical sha256, GENIE manifest hash.
3. **Six panels** — Driver, Passenger, Hood, Roof, Front, Rear — each with
   pixel dimensions, print inches, sha256, `sourceMasterHash`, native PPI, and
   its production orientation checked against the orientation sheet above.
4. **Latency**: prep hit, dispatch, authoring time, raw master, canonical
   accepted, first panel, six panels.
5. **STOP.** No proofs. No repair. No re-roll. No second draw on a failure.

## Step 3 — acceptance, owner's eyes only
One flattened six-surface A.T.L.A.S. design; intentional artwork through every
region's bleed; no wheel wells, windows, body seams, vehicle pieces, labels,
grey or white frame strips, or internal gutters; Hood, Roof, Front and Rear
intentionally composed; Driver and Passenger different but cohesive. **No
automated gate may overrule a visual rejection**, and none can today: no gate
marks a run creatively accepted.

---

# WHAT IS STILL OPEN BEFORE APPROVAL

1. The complete experiment matrix (item 4) is still being extracted and will be
   appended. No prompt-text variation should be approved until it lands.
2. Step 0's guide render must be done and looked at.
3. Deploy order: this diff is **runtime-only**. The edge needs no deploy. The
   runtime and its `PROMPT_VERSION` change ship together.
4. Honest expectation to set now: Draw 1 uses the exact conditioning that
   produced anatomy on `84a3eadf`. It tests the orientation fix, not the
   anatomy question. If anatomy recurs, that is information, not failure, and
   the next step is a matrix-checked conditioning experiment.
