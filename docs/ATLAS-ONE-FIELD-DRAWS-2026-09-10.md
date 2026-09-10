# One-field fail-over request, drawn four times (2026-09-10)

Owner instruction (Trish, 2026-09-10, "go"): measure the request the new
fail-over actually sends, on a real product brief, instead of re-running the
six-surface ablations the record already holds. This is the first time the
v25 one-field tail (`designpro.atlas-field-prompt.v2`) has been drawn.

## What ran

| | |
|---|---|
| workflow | `designiq-ab-precision.yml`, arm **F**, `field_draws: 4`, `runtime_source: checkout` |
| run | `34425798511` on `b9d1538d` → evidence artifact `10132676336`; storage `wrap-files/designiq-ab/2026-09-10T01-34-*` |
| edge | the deployed `design-panel-ai-generate`, `mode: atlas-artboard`, `fieldContract: designpro.atlas-field-prompt.v2`, `noseEdge {driver:left, passenger:right}`, no teaching sheet, no guide — the exact body `atlasEdgeRequestBody` emits for a `field-thirds-v2` manifest |
| lease | harness-only `designpro_generation_requests` row `0379ea56…` (canary operator, `attempt` pinned at 12, cancelled after the run) — the edge authorizes every Call 1 against a live lease since the durable provider cache |
| vehicle / brief | 2021 Lamborghini Urus (suv), New Aura Day Spa brief, industry "day spa and wellness", colors blush rose / champagne / gold |
| Gemini image requests | **4** (`imageRequestsExecuted: 4`), one per draw, distinct `attemptKey master:field:1..4` |
| scoring | `normalizeAtlasMaster` → `deterministicMasterChecks` → `cutCallOnePanels` with the same `field-thirds-v2` manifest (verified: the local manifest serializes to the identical normalized rectangles the request carried); centre distinctness = min pairwise MAD of hood/roof/front/rear at 128², near-white and neutral-grey share of the raw canvas at 512² |

The output-class question was not run on these four (the harness scored them
after the fact, off the droplet); everything below is deterministic or visual.

## Result

| draw | deterministic gates | anatomy / vehicle depiction | centre min-MAD | near-white | neutral grey | what it drew |
|---|---|---|---|---|---|---|
| F1 | pass, 0 hole, 0 cut-out | **none** | 0.124 | 0.0% | 0.0% | **one continuous full-bleed field** — ribbons, botanical line art, name once, corner to corner. The product as RULE 0.33 describes it. |
| F2 | pass | none | 0.136 | 1.2% | 0.0% | six **framed panels** separated by pale gutters, with the prompt's coordinate rows painted as captions (`0.0000 0.0176 1.0000 0.3157` …) |
| F3 | pass | none | 0.119 | 0.7% | **4.5%** | same: six framed panels on a neutral-grey gutter grid, coordinate captions on every panel |
| F4 | pass (driver edgeHole 0.0375) | none | 0.124 | 0.0% | 0.0% | continuous ground, but the coordinate rows painted as text across the sheet, and the name set four times plus two invented logo lock-ups |

Two facts the record did not have until now:

1. **The one-field request does not draw the vehicle.** 4/4 with no wheel
   arch, silhouette, body line, panel name or vehicle-shaped edge, on a
   vehicle (Urus) whose six-surface run the same day was accepted with both
   flanks drawn as an Urus side profile. That matches the only earlier
   one-field draw (`33659500846`) and is the opposite of every six-surface
   variant in `docs/ATLAS-CALL1-*.md`.
2. **The v25 coordinate rows leak into pixels 3/4.** `atlasFieldContract`
   writes six `left top right bottom` fraction rows into the prompt. Three
   draws painted those numerals as captions, and two of them drew the "areas"
   as framed panels with gutters. The captions land **inside** the cut
   territories (F2 hood, F3 roof, F4 driver), so they would print. This is the
   same class as the 2026-08-25 `artifactFreeContract` deaths (surface names
   painted from prompt text) and the 2026-09-10 New Aura captions (ROOF /
   REAR): text that reaches the model request becomes artwork.

The gates did not refuse any of the four. The hole gate convicts near-black
fields; pale gutters and painted numerals are neither, and the four centre
surfaces are genuinely distinct passages (min-MAD 0.12–0.14, against the
near-zero of the a503b91b band-reuse rejection).

## Reading

RULE 0.33's own contract says the model is shown **no normalized `[0,1]`
text** and that GENIE owns the territories as code. The v25 tail reintroduced
that text as "areas … written as fractions of the image". Measured on a real
brief, the fractions are read as layout and as copy. The tail's own wording
("They are not separate pictures … the joins are invisible") did not hold
against six explicit rectangles.

Everything else in the one-field request measured the way the product needs:
no anatomy, full bleed, distinct centre surfaces, the brief's palette and
subject, the name legible.

## What this does and does not decide

- It does not touch the six-surface primary path or its budget.
- It is a measurement of the **fail-over** request only, and the harness now
  draws it on demand (`arms: F`, `field_draws`, with an operator-minted lease).
- The next creative variable is the tail without the coordinate rows — the
  v24 wording the harness proof `37e4137e…` was drawn on — measured the same
  way before any product change. That is an edge prompt-contract change
  (`designpro.atlas-field-prompt.v2` → v3, runtime pin advanced with it), so
  it is a release, not a dispatch input.

## Harness corrections made to get this measurement

- The control-drift pin was re-pinned to the deployed source (every
  `buildDesignIQPrompt` hunk since 08-28 is an `atlasFlatMaster`/`atlasField`
  ternary whose else-branch keeps the original string).
- Edge arms (B, F) carry an operator-minted lease (`AB_LEASE_*`); the harness
  cannot insert one itself because the table's trigger calls a function whose
  EXECUTE is revoked from `service_role`.
- `design_name`, `industry`, `colors` are dispatch inputs, so a day-spa brief
  no longer rides with the HVAC defaults.
- `deterministicMasterChecks` is imported from `atlas-master-qc.cjs`, and the
  harness manifest carries `geometryResolution`, so `cutCallOnePanels` no
  longer fails closed on it.

## Correction: the four draws above used an invented brief

Owner, on seeing them: *"Where's the atlas design? This is clearly ai slop!
Missing key elements … my edge functions designer persona is not being used."*

She was right about the brief. The harness dispatch carried a brief I typed
("blush-rose ribbons and gold botanical line art"), not the stored New Aura
request, whose brief is: *"Custom wrap for New Aura Day Spa use spa colors
blues, sage, white, create a logo and a custom photo of a women getting a
professional facial in a spa setting must look modern and professional"*,
with `companyName: New Aura Day Spa`, `finish: Gloss`, no industry, no colors.
The four ribbon draws render what was asked and say nothing about her brief.

The persona claim was checked, not argued: the exact field prompt for her
brief was assembled from the transpiled control build (4,496 chars). It
carries the senior wrap-designer identity, THE CONCEPT + translation clause,
`Business: New Aura Day Spa` with the logo requirement, the contact lock, the
photographic-realism judgment and the PHOTOGRAPHIC IMAGERY clause. Only the
tail differs from the 3D commercial prompt: studio/camera text out, the
one-field output text in. The one-field tail also says every focal subject
"sits wholly inside a single area and well clear of its four edges", which
works directly against a photo the owner wants across most of the vehicle.

## Run 2 — her stored brief, field for field (run `34430841234`)

Harness now takes `company_name`, and empty `industry`/`colors` omit the
field. Lease row `042da9a3…` (cancelled after). Arm B (six-surface) was
refused by the edge before any call — `atlas_artboard_teaching_proof_incomplete`,
the harness's B body predates the labeled teaching proof — so only F drew.

| draw | gates | output class | centre min-MAD | near-white | what it drew |
|---|---|---|---|---|---|
| F1 | pass | flat_atlas | 0.205 | 1.9% | logo, name, facial photo in a swoosh window, blues/sage/white with orange accents — but drawn as a **poster with a dark-blue margin and a bevel**, so the margin lands inside the driver territory |
| F2 | pass | flat_atlas | 0.192 | 2.1% | same elements, framed on a grey mount — a mockup, not a print field |
| F3 | pass | flat_atlas | 0.162 | 12.7% | **closest to the brief**: continuous field, photo across ~60% of the sheet, logo and name — with **axis tick labels (0, 0.1 … 0.4) drawn down the left and along the bottom**, inside the driver panel |
| F4 | pass | flat_atlas | 0.234 | 14.1% | six framed panels with the coordinate rows painted as captions; every panel on-brief (logo, photo, stones, water) |

So with her real brief the persona and the brief's elements are present in
4/4 (logo, name spelled right, the facial photo, the palette; orange is the
model's addition). The defects are all the tail's: coordinate rows painted
as numerals (F3, F4), and the "square is one picture" framing read as a
poster or mockup with margins (F1, F2). No draw is production-usable as-is,
and none of the four gates or the classifier refuses any of them.
