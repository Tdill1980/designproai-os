# A.T.L.A.S. — TETHER THE HERO-DRIVER CASCADE AS CALL 1 (design, awaiting owner ruling)

Drafted 2026-09-11 against `origin/main` `82da00d` (PR #356). Nothing applied:
no runtime file edited, no migration, no deploy, no generation. Read-only
evidence from `designproai-os-prod` (`wozyamlnygaddievzuwn`) and the tree.

## 1. What the owner asked for, in her words

> "It must create the hero driver side and then flip the driver for passenger
> side then show each to each side generated in parallel so for instance rear
> would see driver, passenger, front and hood then roof would see all."
> — Trish, 2026-09-11 (Flat Panel Pro spec, RestylePro
> `src/lib/flatPanelProStages.ts`, now to be tethered here)

> "Requires multi-turn spatial reasoning. Passing the thought_signature from
> the hero driver-side generation into the passenger/rear/hood requests locks
> the design continuity across all panels." — Trish, 2026-09-11

> "DO NOT USE VERTEX or IMAGEN. Keep Gemini Image Pro 3." — Trish, 2026-09-11

## 2. What is failing, measured (last 21 days, production)

| state | n |
|---|---|
| failed | 73 |
| outputs_ready | 43 |
| cancelled (harness rows) | 2 |

Failure codes, same window:

| code | n | window | what it is |
|---|---|---|---|
| generation_slots_failed | 21 | 08-21 → 08-26 | old slot infra, gone since 08-26 |
| flat_atlas_master_qc_failed | 12 | 08-23 → 08-27 | Call 1 master refused by the gate |
| flat_atlas_master_deterministic_failed | 11 | 08-28 → **09-08** | Call 1 drew anatomy / holes into the sheet |
| flat_atlas_master_output_class_invalid | 5 | 09-01 → **09-08** | classifier: vehicle depiction, not printed media |
| generation_worker_failed | 5 | 08-27 → 08-31 | runtime |
| generation_atlas_lineage_invalid | 4 | 08-27 → 08-28 | lineage |
| flat_atlas_master_semantic_failed | 4 | 08-30 → 08-31 | Call 1 master refused |
| flat_atlas_conditioning_invalid | 2 | 09-02 → 09-04 | prompt conditioning |
| flat_atlas_unrepaired_cutout | 2 | 09-06 → **09-10** | wheel/glass shape cut out of a panel (Distressed Porsche, DID-B53702B4) |
| provider_outcome_unknown | 1 | 09-09 | the roof 409 incident |
| GENIE grounding / dimension | 4 | 08-21 → 08-31 | geometry |
| other | 2 | | |

Since the slot infra was fixed (08-27), **36 of the remaining 52 failures are the
same event: the ONE-IMAGE Call 1 (six-surface sheet, or the one-field
composition) draws the vehicle into the print sheet and a gate correctly
refuses it.** The last twelve revisions cycle through five prompt versions
(v23, v24 one-field, v27 field-compose, v28 authored-topology, v29
one-field-thirds) and every one is `production_eligible = false`. The CLAUDE.md
count agrees: 20 requests, 8 delivered, 12 failed, seven of them Call 1 drawing
anatomy. Prompt versions are not moving this number. The shape of the ask is.

Asking one image request to compose six related rectangles of one wrap on a
4096² sheet is the hardest thing this model is asked to do anywhere in the
product. Asking it for ONE 21:9 driver flank is the easiest, and it is the ask
the DesignPanelAI hero has been answering cleanly for months.

## 3. What already exists here, and is most of the tether

`runtime/atlas-panel-authoring.cjs` + `handleAtlasPanel` in
`design-panel-ai-generate` already implement the multi-turn cascade the owner
described: driver leads, each later surface is shown the finished siblings as
downscaled references, exact user/model exchanges are replayed with their
thought signatures on the part they arrived on, the chain is trimmed from the
oldest end to fit the request budget, and every surface is checkpointed so a
worker restart resumes without regenerating. It is gated by
`DESIGNPRO_ATLAS_PANEL_FINISH=on` and it runs only as **optional FINISHING on
top of a six-surface master that Call 1 must first produce** — which is the
step that keeps failing.

`runtime/atlas-passenger-mirror.cjs` already composes Passenger from Driver in
code with the brand bands re-dropped forward-reading (owner ruling 2026-09-07).

So the tether is not a new pipeline. It is: **let the cascade AUTHOR, not just
finish, and make Driver the only thing Call 1's first image request draws.**

## 4. The proposed topology — `hero-driver`

A third `authoringTopology` beside `six-surface` and `field`, selected by
`DESIGNPRO_ATLAS_TOPOLOGY=hero-driver` (deploy input), and once accepted, the
product default.

```
Call 1 (one cohesive creative act, one multi-turn conversation, checkpointed per surface)
  1. DRIVER      — one image request: the driver flank only, GENIE 21:9, full bleed.
                   Existing master gates run on THIS rectangle (anatomy, holes,
                   output class, full bleed). RULE 0.23 "driver first, then ask"
                   becomes literal: the customer can see it ~35 s in.
  2. PASSENGER   — atlas-passenger-mirror, code only. No image request.
  3. HOOD, FRONT — in parallel, each a turn continuing the SAME conversation
                   (driver exchange + signature replayed; passenger attached as
                   a reference image), asked to PRODUCE the surface at its GENIE
                   size as a continuation of the finished flanks.
  4. REAR        — sees driver, passenger, hood, front (owner's order).
  5. ROOF        — sees all five.
  6. ASSEMBLE    — atlas-finished-master places the six rectangles into the
                   GENIE manifest zones (code). Whole-master gates run once
                   more. Publish ONE canonical master + deterministic crops,
                   exactly as today.
```

Everything after step 6 is untouched: proofs, Call 8, Call 9 promotion, QC,
Topaz, ZIP, WrapBox. Lineage is unchanged: one Call-1 master, six Call-1
panels, one RevisionID.

What changes in code (all inside the Call-1 boundary):

| file | change |
|---|---|
| `runtime/flat-first-atlas.cjs` `generateOrReuseFlatAtlas` | accept `hero-driver`; author the driver zone alone (driver-only manifest for the request; the six-surface GENIE manifest stays the canonical identity); run the cascade in AUTHOR mode; assemble; gates; publish |
| `runtime/atlas-panel-authoring.cjs` | `PANEL_CASCADE_ORDER` / `PANEL_NEIGHBOURS` become the owner's graph (hood+front parallel; rear sees d/p/h/f; roof sees all); an `author` mode whose subject is a blank GENIE-sized canvas rather than a crop to finish; parallel branches linearised into the next turn's chain (strip signatures once if the API rejects a replayed one, report `signaturesUsed`) |
| `design-panel-ai-generate` `handleAtlasPanel` | an authoring prompt variant: "produce the HOOD sheet of this wrap (W × H in), continuing the finished sheets; identical palette, gradient direction, pattern scale, stroke direction; carry artwork across shared edges" — positive framing, no vehicle nouns, same structured `<inputs>` tags |
| tests | `tests/atlas-panel-authoring.test.mjs` pins the new order; new `atlas-hero-driver-topology.test.mjs` locks: driver is the only first-request surface, passenger is code, every AI side replays every earlier stage, no Flash fallback, no Vertex/Imagen |

Budget: 5 image requests per generation (driver + hood + front + rear + roof)
instead of 1 + up to 6 finishing calls. At the measured ~35 s per call with
hood/front in parallel, a full A.T.L.A.S. is ~2.5 minutes. The owner's ceiling
was "it should never take 7 minutes".

## 5. Why this is expected to move the number, honestly

- The anatomy failure is a **composition** failure: shown six named regions of a
  vehicle, the model draws the vehicle. Shown one rectangle and asked for the
  artwork, it draws artwork. That is the measured behaviour of the hero path.
- Cohesion comes from the conversation, not from co-presence on one sheet:
  the roof is drawn by the model that is still "holding why it drew the
  flanks" (thought signatures), with all five finished sheets attached.
- Passenger lettering orientation stops being a model problem entirely.
- Each surface is its own checkpoint, so a 409 on the roof (the 09-09 incident)
  costs one surface, not the generation.

What it does NOT guarantee: that four center surfaces authored as continuations
read as one wrap to the owner's eye. That is the acceptance test, and it must
be inspected on a real generation before it is called creative success — the
same standard CLAUDE.md sets for the six-surface restoration.

## 6. The ruling only the owner can make

`docs/ATLAS_ONE_ARTIFACT_GRAPH.md` (2026-08-31) and the 2026-09-06 correction
say **"Call 1 must author the complete six-surface topology in ONE image
request."** The hero-driver cascade keeps Call 1 as the sole creative authority
and one cohesive creative act, but executes it as **one multi-turn conversation
of five image requests** rather than one request. That is a change to a written
owner ruling, so it needs a written owner ruling to replace it:

> **Ruling requested:** Call 1 = one cohesive creative act executed as one
> multi-turn Gemini 3 Pro Image conversation: Driver first (the only
> from-scratch request), Passenger mirrored in code, then Hood + Front,
> Rear, Roof authored as continuations with thought signatures replayed.
> The six-surface single-request path and the one-field failover stay in the
> tree, tested, and become the fallback when `hero-driver` is refused on the
> driver rectangle.

With that ruling recorded in CLAUDE.md the work ships as: (1) runtime + edge +
tests behind `DESIGNPRO_ATLAS_TOPOLOGY=hero-driver`, dark-deployed; (2) one
real generation inspected by the owner; (3) default flip.

## 7. Out of scope here

`generation_slots_failed` (21, all before 08-27) and the four GENIE grounding
failures are not Call-1 problems and are not addressed by this tether.
