# Call 1 authors the ground; code owns everything a cut can destroy

**Owner ruling, Trish, 2026-09-05.** *"Fix composition before canonical master
acceptance. Required lettering, logos and focal imagery must fit their intended
surfaces. Resolve their asset sources before assembly; layering new text over
already-clipped lettering is not a fix."*

Contracts: runtime `designpro-flat-first-atlas-20260905.v25-ground-and-elements`,
edge `atlas-artboard-designiq.20260905.v25-ground-and-elements`, field
`designpro.atlas-field-prompt.v3`, elements `designpro.atlas-elements.v1`, plan
`designpro.atlas-element-plan.v1`, compose `designpro.atlas-compose-master.v1`,
element asset `designpro.atlas-element-asset.v1`.

---

## What was measured

Arctic Air, 2026-09-04, two runs, twelve panels, twelve failures — and every
deterministic gate green on both.

| | Run A `586abc83` | Run B `63e6629a` |
|---|---|---|
| accepted master | `de71a67c…` | `10779204…` |
| `masterQcPassed` | true | true |
| cut-outs | **none** | front, roof |
| Call-1 panels | **6** | 6 |
| 3D proofs | **0** | 7 |
| what printed | `www.GoArcticAC` severed both ends; a shield reading `ARCTI` | `Www.Arct` on the hood, `ticAir.com` on the rear |

The v24 Call 1 asked for **three equal horizontal thirds**. Gemini obeyed
exactly — the master is three bands, the third being one calm register with the
brand mark once, precisely as instructed. The cutter then took **six unequal
territories**, four of them interlocking inside that third band, across four
boundaries the model was never shown: `x=1071`, `x=2198`, `x=3325`, `y=3335`.

```
model was told            cutter actually took          discarded
third 1  y 0–1365         driver    y  72–1293          10.55% of the third
third 2  y 1365–2731      passenger y 1437–2658         10.54%
third 3  y 2731–4096      roof + hood + front + rear    27.83%
                          (four unequal rectangles)
                                                total   2,735,711 px = 16.31%
```

**The flanks survived because, and only because, `driver` and `passenger` map
1:1 onto a third. The four territories that do not, failed without exception.**
That is the whole defect in one sentence.

`normalizeAtlasMaster` masks to the zone rectangles, so the discarded 16.31% is
painted black in the stored master — in Run A a black rectangle *deletes* the
middle of `ARCTIC AIR` and both ends of the URL. Content there is not merely
split across panels; it is destroyed before extraction.

## The geometry was already on the wire

```
runtime/flat-first-atlas.cjs:1563   normalized: normalizedZoneTopology(zone, manifest)
        │  POST /functions/v1/design-panel-ai-generate   body.panels[6]
        ▼
index.ts:2352   normalized: atlasNormalizedRect(...)   ← revalidated, [0,1] enforced
index.ts:2387   atlasPanels: panels  →  buildDesignIQPrompt
index.ts:660    const atlasPanels = …                  ← in scope, all six rectangles
        ├── :929  LEGACY branch  atlasFlatMasterContract(atlasPanels, …)   CONSUMES it
        └── :924  LIVE branch    atlasFieldContract(vehicle, bodyClass, noseEdge, true)   DISCARDS it
```

Five lines apart. The dead branch was the correct one.

## What v25 does

**Call 1 authors the GROUND.** Palette, texture, depth, motion, and — where the
brief asks for them — nothing else. It paints no company name, no URL, no phone,
no contact bar, no glyph at all. Its tail carries the six real territory
rectangles from `panels[].normalized`, so the calm passages land where elements
are about to go. Those rectangles are **conditioning, not the guarantee**: Test 3
(`ATLAS-CALL1-TOPOLOGY-TEXT.md`) measured 0/6 compliance in both arms when
coordinates were asked to *be* the guarantee, and this contract does not repeat
that.

**Element sources resolve first, and are measured.** `runtime/atlas-elements.cjs`:

| element | source | provider calls |
|---|---|---|
| company name, URL, phone, tagline | the frozen request, outlined from a **pinned font file** | 0 |
| brand mark | the customer's uploaded logo, else one isolated `atlas-element` image | 0 or 1 |
| focal photograph | one isolated `atlas-element` image, only when `briefWantsPhoto` | 0 or 1 |
| ground | Call 1, unchanged | 1 |

Both element calls are issued **concurrently with Call 1** — neither depends on
the ground — and the brief that reaches them is **redacted of every canonical
string**, with the edge refusing the call if one survived.

**Containment is computed, not requested.** `runtime/atlas-element-plan.cjs`
partitions each surface's safe box into **disjoint slots**, fits each element to
its slot by its measured aspect, and re-derives the inclusion from the manifest
before returning. A required element that will not fit **throws
`atlas_element_unplaceable` and the run fails without a master** — a wrap missing
the customer's URL is not a cheaper outcome than a refusal.

- placement is inside `zone.trim`, itself inside the 5″ bleed, inset a further
  **2″** for installer tolerance;
- sizing is in **inches on the vehicle**, never pixels: 22.61 PPI on the flanks
  and 16.35 on the front make the same pixel box two different physical objects;
- legibility is physical too — roughly 1″ of cap height per 10 ft of reading
  distance, so a 2.5″ contact line reads from the next lane.

**Composition happens before acceptance.** `runtime/atlas-compose-master.cjs`
paints the elements onto the ground between `normalizeAtlasMaster` and
`deterministicMasterChecks`. Everything downstream — QC, the output-class gate,
the cut-out fill, acceptance, the six panels, the seven proofs, Call 8, the ZIP —
sees the finished sheet, and none of it needed changing.

It **refuses a v2 ground by version** (`atlas_compose_ground_contract_unsupported`):
composing over a sheet that already carries its own lettering would stack a
correct URL on a severed one, which is the move the owner ruled out by name.

## Provenance

`groundMasterHash` is what the model authored. `canonicalMasterHash` is what the
customer buys. The receipt records the exact string that printed next to the
rectangle it printed in, in pixels **and in vehicle inches from the trim corner**,
plus the font digest — so a spelling or fit question is answerable without
opening an image. A surface left bare records the measurement that decided it.

## What the UI now says

`Print panels 6/6` counted files. `SixPanelBoard` shows six thumbnails with
surface, orientation, trim, effective PPI, per-panel state and refusal reason,
and states **files cut** and **panels that passed their gates** as two separate
numbers. A run that cut six panels and then died before its first proof — Run A
exactly — keeps its artwork on screen and names the stage that stopped it.

## What this does not do

- It does not make Gemini deterministic, and does not rely on it being so.
- It does not deploy the dormant Design Master pipeline. One primitive is
  reused — `opentype-outline.cjs`, which turns a string and font bytes into a
  path and authors nothing. The thirteen producers stay dormant, still asserted
  by `tests/atlas-sole-design-authority.test.mjs`, which now also proves the
  compositor cannot reach them.
- It does not change `cutCallOnePanels`, GENIE, the manifest identity fix from
  PR #300, or the pinned photographer/studio/view-angle proof stack.
- It does not bind a customer's *placement request* ("photo on the rear") to a
  surface. The policy that assigns elements to surfaces is fixed. Reading the
  brief for placement is separate work.

## Open, and honest about it

1. **The wordmark is typeset, not illustrated.** Arctic Air's chrome-and-ice
   `Arctic Air` lettering was Gemini's, and it was good. Code sets the name in
   the pinned font instead, which is exact and contained and plainer. The
   alternative — a generated wordmark asset — returns styling but puts the
   spelling of the customer's own name back in a model's hands. Owner's call.
2. **Ground quality under composition is unmeasured.** No draw has been spent on
   a v3 ground. The prompt asks for calm passages inside each territory; whether
   the model leaves them, and whether type sits well on what it returns, needs a
   real generation to answer.
3. **The legibility plate is a design decision.** A dark scrim sits under the
   contact line by default so it reads over a busy ground. It is one constant and
   can be turned off.
