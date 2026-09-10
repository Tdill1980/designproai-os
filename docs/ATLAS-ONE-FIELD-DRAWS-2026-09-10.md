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
