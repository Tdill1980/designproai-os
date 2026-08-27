# A.T.L.A.S. — ONE ARTIFACT GRAPH, ONE SOURCE, PARALLEL FAN-OUT

**Owner directive, Trish, 2026-08-27.** This supersedes any earlier wording about
how RevisionStudioIQ and PanelPro Studio get their panels. It is an
**artifact-graph** correction, not a prompt correction. Do not respond to it by
writing another prompt.

> "THE SCREENSHOTS PROVE THE PIPELINE IS STILL SPLIT. FIX THE ARTIFACT GRAPH,
> NOT ANOTHER PROMPT."

---

## 0. The contradiction that proves it

On one generation, at the same moment, two surfaces disagreed:

| surface | says |
|---|---|
| PanelPro Studio | **Print panels 0/6** — "Cut deterministically from the accepted master" |
| RevisionStudioIQ | shows images in its right-hand Production Pack column |
| PanelPro Studio | **3D proofs 8/7** — a count above its own denominator |
| RevisionStudioIQ | shows a **roof** proof |
| the run | reports the roof slot **failed** |

Three numbers that cannot all be true about one design. That is the diagnosis:
**one source design is being re-represented independently by each consumer,
instead of one lineage being published to both.**

The owner's summary, which is the correct statement of the defect:

> "Your intended architecture was one source → duplicate publication, whereas
> the current implementation has become one source → several independently
> reconstructed representations."

---

## 1. HARDWIRE THE ARTBOARD SHELL. CODE OWNS GEOMETRY; A.I. OWNS DESIGN.

**Stop making Gemini responsible for drawing the A.T.L.A.S. containers.**

The reference is the Houdini PANEL LAYOUT sheet: labeled rectangles — REAR
BUMPER · HATCH · PASSENGER · DRIVER · VENT · ROCKER · ROOF · HOOD · FRONT
BUMPER — each a filled rectangle of continuous artwork, in fixed positions, at
real proportions.

Code/GENIE must deterministically construct the flattened master shell:

- the six rectangular surface containers;
- their surface labels;
- their real GENIE proportions and dimensions;
- their fixed positions on the canvas;
- fixed surface IDs;
- the master canvas itself.

**DesignPanelAI then authors ONE cohesive wrap INSIDE those six defined surface
interiors, in ONE Call 1.** The AI owns the design. The code owns the artboard
geometry. This is still one source design and one design-generation call — it
removes only the part the model should never have been trusted with: recreating
the diagram correctly every time.

This does not conflict with RULE 0.15 or RULE 0.24. The Houdini pair remains a
STRUCTURAL reference and still teaches layout; hardwiring the shell means the
layout no longer *depends* on the model having learned it.

### The owner's restatement, 2026-08-27

> "6 panel flattened topo should be labeled container with the 6 panels."

Her screenshot shows the two halves side by side on the DesignPro page and they
do not agree:

- **"Vehicle layout"** — the deterministic guide. It ALREADY has the six labeled
  containers in the canonical Houdini arrangement: `PASSENGER · REAR · ROOF ·
  HOOD · FRONT · DRIVER`, at GENIE proportions, drawn by code.
- **"Flattened top-view design"** — the authored master. It does NOT fill those
  containers. Its panels sit at different sizes and positions, with dark
  cut-outs where the guide has clean rectangles.

**The master is supposed to BE the guide, filled.** Today the guide is only
shown to the model as a reference and then shown to the customer as a separate
card; nothing makes the output land inside those rects.

### The machinery for this already exists — it was demoted, not missing

`runtime/atlas-artwork-compose.cjs` exports **`composeAtlasFromArtwork({
artworkBytes, manifest, branding })`**, which lays artwork into the manifest's
zones with the passenger flank mirrored deterministically. Its own header now
reads *"A MEASUREMENT ARM. NOT THE ARCHITECTURE. (Owner correction,
2026-08-26)"* — on 2026-08-26 it was stood down in favour of Call 1 authoring
the whole sheet freehand.

**This directive reverses that specific decision.** The composer goes back to
owning the master's geometry: code places and labels the six containers from the
GENIE manifest, and the authored artwork fills them. Do not rebuild it from
scratch, and do not read the 2026-08-26 demotion as still standing — it is
superseded by this rule.

---

## 2. AFTER MASTER ACCEPTANCE — IMMEDIATE PARALLEL FAN-OUT

```text
        ONE DesignPanelAI + A.T.L.A.S. CALL 1
                        │
          4096×4096 ACCEPTED A.T.L.A.S. MASTER
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   A. PANELS       B. ASSETS       C. CUSTOMER PROOF
```

All three branches start **at once**, on master acceptance. None waits for
another.

### A — PANELS
`master → cutCallOnePanels → six deterministic GENIE surface crops → +5" bleed
→ persist six canonical panel artifacts`

Publish **those same six persisted artifacts** simultaneously to:
- RevisionStudioIQ right column
- PanelPro Studio

**No separate RevisionStudio panel generator. No client-side crop. No preview
artifact standing in for a production panel.**

### B — ASSETS
`same master → logo / lettering / brand extraction → persist`

Publish **the same persisted extracted assets** to RevisionStudioIQ (below the
panels) and PanelPro Studio's asset gallery.

### C — 3D PROOFS, ONE PER EXTRACTED PANEL (owner spec, 2026-08-27)

> **ALL 3D PROOFS ARE RENDERED FROM THE EXTRACTED A.T.L.A.S. PANELS — NOT FROM A
> SEPARATE DESIGN GENERATION, AND NOT WAITING ON OTHER SIDES.**

```text
MASTER
  → deterministic extraction of Driver / Passenger / Hood / Front / Rear / Roof
  → each panel persisted immediately with trim + 5" bleed + lineage
        │
        ├── DRIVER PANEL     → Driver 3D proof
        ├── PASSENGER PANEL  → Passenger 3D proof
        ├── HOOD PANEL       → Hood 3D proof
        ├── FRONT PANEL      → Front 3D proof
        ├── REAR PANEL       → Rear 3D proof
        ├── ROOF PANEL       → Roof 3D proof
        └── CLOSE-UP         → the appropriate extracted panel / detail authority
                               from the same accepted A.T.L.A.S. revision
```

**No proof waits for another proof.** Driver is prioritised for latency and
customer experience only — **it is not the design authority.**

### VERIFIED 2026-08-27: the proof half ALREADY works this way

An earlier revision of this section said this "corrects the current
`hydrateDriver()` shape, where Driver is rendered and hash-verified before the
other six are allowed to start." **That was wrong — I wrote it from the rule
rather than from the code.** Read out of the running source:

- `runAtlasProofStages` passes `parallel: true`, and `runRequest` dispatches
  `Promise.all(slots.map(runSlot))` — all seven overlap.
- Driver keeps priority by being **first in the slot array**, so its provider
  call is issued first and it is still what the customer sees first (RULE 0.23).
- The code says so in its own words: *"PRIORITY IS NOT PREREQUISITE ... a failed
  Driver now leaves the other five free to complete."* It was fixed after
  `a6dd78aa` (passengerMirrorMae 0.29343) and `fc2f2e80` (upside-down passenger
  lettering), where Passenger was built by mirroring Driver's pixels outright.

And the panels are already ahead of the proofs, not behind them:
`cutCallOnePanels` runs inside Call 1, on the accepted master, **before any
proof is dispatched**. So `master → six panels` genuinely happens before and
independently of proof completion, which is the hard dependency rule.

### WHAT IS STILL NOT TRUE, AND IT IS ONE LINE

`runRequest` computes `state: failed.length ? "failed" : ...`. **One refused
slot marks the whole request `failed`,** which is what turns a design with five
good proofs and six good panels into a red FAILED badge across the library
(`04cc0b29`: five accepted, roof and close-up refused).

The artifacts survive — nothing is deleted, and the handoff gate reads
`masterQcPassed`, not the proof set — so this is a REPORTING defect, not a
data-loss one. But it directly contradicts the rule above:

> A failed Close-Up **cannot** cancel the Driver / Passenger / Front / Rear /
> Roof artifacts.

Fixing it means separating "this slot failed" from "this request failed", and
`outputs_ready` is what several gates key on — so it is an owner-level decision
about what a partially-complete run *is*, not a tidy-up. Flagged, not silently
changed.

### 3D proof inputs

Every 3D proof receives:

- the exact extracted A.T.L.A.S. panel for that surface as **ARTWORK AUTHORITY**;
- exact YMM / configuration;
- the canonical RestylePro **3D vehicle / view-angle edge-function logic**;
- **`studio-os`** for the professional studio and lighting;
- the 3D proof example / reference, **presentation only**.

The proof renderer may change camera, vehicle perspective, lighting, studio and
physical vinyl presentation. **It may NOT redesign the artwork.** (Already true
and locked — `buildAtlasProjectionPrompt` carries none of the creative blocks,
`tests/atlas-proof-presentation-only.test.mjs`.)

**What changes in code:** `buildViewAuthorities` / `viewAuthorityFor` hash-bind
each view to a surface crop of the repaired master (`surfaceSourceBytes`). They
must bind to the persisted Call-9 **panel** for that `surfaceKey`, so the hash a
proof carries is the panel's hash. The identity check stays exactly as strict —
`flat_atlas_view_authority_identity_mismatch` still throws — it simply points at
the artifact the customer is actually buying.

### Parallel publication

As each pair becomes available, publish it immediately to **both**:

| surface | shows |
|---|---|
| **RevisionStudioIQ** | `3D PROOF ∥ MATCHING EXTRACTED PANEL`, plus trim/bleed downloads and logo assets |
| **PanelPro Admin Studio** | the same proof/panel pair plus technical metadata, lineage, dimensions, hashes, QC, versions and downloadable assets |

**Do not duplicate or regenerate the panel for either UI. Both consume the same
persisted artifact.**

### Upscale

Every raster production asset that requires upscale creates a **derivative while
preserving the source**. PanelPro must retain and display all three:

```
SOURCE PANEL  ·  UPSCALED DERIVATIVE  ·  ACTIVE PRODUCTION DERIVATIVE
```

each with dimensions, effective DPI, upscale factor, hash, timestamp and QC
state.

### HARD DEPENDENCY RULE

```
accepted master → six extracted panels
```

must happen **before, and independently of, proof completion.**

- A failed Hood 3D proof **cannot** prevent the Hood production panel existing.
- A failed Close-Up **cannot** cancel the Driver / Passenger / Front / Rear /
  Roof artifacts.
- Each surface is independently renderable from its own extracted panel.

**This is the direct fix for `generation_slots_failed`**, where two refused views
(roof, close-up) marked an entire design FAILED although five views and six
panels were correct.

### AUTHORITY

| layer | authority |
|---|---|
| A.T.L.A.S. master | the ONE source design |
| extracted panel | per-surface **artwork** authority |
| 3D edge functions + view angles + `studio-os` | **presentation** authority |
| RevisionStudioIQ + PanelPro | **consumers** — never producers |

**No downstream design generation exists.**

---

## 3. REVISION BEHAVIOUR

Clicking **Revise** opens RevisionStudioIQ, where each surface is one row:

> **LEFT = the 3D proof · RIGHT = the exact persisted A.T.L.A.S. panel + 5" bleed**

with the extracted logos and brand assets below.

A revision prompt creates **V2 = ONE new DPAG + A.T.L.A.S. source master**, and
immediately repeats the whole fan-out: panel extraction, logo extraction, Driver
proof, then the remaining proofs concurrently. **V1 remains intact and
inspectable** (RULE 0.22).

---

## 4. THE FIVE DATA CONTRADICTIONS TO CLOSE

These are the work items. Each must end with both surfaces resolving to the
**same six artifact IDs and hashes**.

1. **PanelPro's `0/6` is the WRONG NUMBER. The panels exist.** *(Corrected
   2026-08-27 from the owner's RevisionStudio screenshots — the first reading of
   this contradiction guessed the opposite, that RevisionStudio was showing
   something fake. It is not.)*

   `designpro-production-layers.ts` builds RevisionStudio's right column from
   artifacts of kind **`panel`** (branded) and **`qc-panel`** (clean), and
   **returns `null` unless ALL SIX branded surfaces exist**. It cannot render a
   partial or invented pack: six or nothing.

   The owner's screens show six labelled rows — DRIVER SIDE · PASSENGER SIDE ·
   HOOD · ROOF · FRONT · REAR — each stamped **`v2:a4dfe5244c00cd554bba6b6e`**,
   and `a4dfe5244c00cd55` is exactly the master hash PanelPro itself prints
   (`a4dfe5244c00cd55 · 4096×4096`). **Six master-bound panel artifacts exist,
   from the accepted master, on the run PanelPro reports as `0/6`.**

   So the defect is in PanelPro's projection, not in the panels. Its badge
   counts `panels[side]?.gemini_url` over `PRODUCTION_SURFACES`, fed by
   `panelProStudioPanel()` in `app/src/lib/panelpro-studio-source.ts`, which
   projects the run into the legacy page shape
   (`concept_json.qc_side_panels[sideKey]`). **Suspect first: the surface-key
   namespace.** The artifacts key on `driver` / `passenger` / `hood` / `roof` /
   `front` / `rear`; the legacy board keys on its own `sideKey` labels. A
   projection that misses on the key yields an empty map and an honest-looking
   `0/6` over artifacts that are present and correct.

   **Fix the counter to read the same six artifact IDs the right column reads,
   and assert the two agree in a test.** Do NOT "fix" this by making
   RevisionStudio produce or re-derive anything.

2. **Why the roof exists in RevisionStudio but is reported missing elsewhere.**
   A 3D *proof* artifact and a canonical *production* surface are different
   artifact classes. The UI is conflating them. Name the class in the UI.

3. **Why the proof count can read 8/7.** `designpro-production-layers.ts` states
   the likely cause in its own comment: *"Call 8 emits seven artifacts of kind
   `flat-proof`: the six canonical production surfaces and the one customer
   proof."* A counter that sums that class against a denominator of 7 canonical
   camera slots will overshoot. Count by **role**, never by kind.

4. **Which artifact kinds RevisionStudio's right column queries.** Document it,
   then assert it.

5. **Which artifact kinds PanelPro counts as canonical panels.** Same.

**Neither UI may synthesize its own representation of a missing canonical
artifact.** A missing panel is reported as missing.

---

## 4B. THE SIZES ARE WRONG BECAUSE THE GENIE CATALOG IS EMPTY (2026-08-27)

Owner: *"None of them are the right size. It should be using GENIE Panelizer
database to get sizes for ATLAS."* Measured, and she is right — with a root
cause neither of us had named:

| project | table | rows |
|---|---|---|
| RestylePro `kfapjdyythzyvnpdeghu` | `vehicle_dimensions` | **1781** |
| DesignProAI `wozyamlnygaddievzuwn` | `designpro_vehicle_dimensions` | **0** |

The DesignProAI table exists with exactly the right per-surface columns —
`side_width, side_height, hood_width, hood_length, roof_width, roof_length,
front_width, front_height, rear_width, rear_height, back_width, back_height,
total_sqft` — and is **completely empty**. The catalog was never migrated.

### What A.T.L.A.S. does instead

`resolveFlatAtlasPreviewDimensions` finds no validated surface row and falls
through to `provisionalDimensionsFromCandidate`, which takes a grounded guess at
overall length/width/height and multiplies by **hardcoded class constants**:

```js
sideHeightFactor = { car: 0.76, truck: 0.72, suv: 0.78, van: 0.82 }
roofLengthFactor = { car: 0.60, truck: 0.45, suv: 0.55, van: 0.50 }
```

Every vehicle therefore gets its CLASS's average proportions, not its own
measured panel sizes. **That is why none of the containers are the right size**,
and hardwiring the shell (§1) cannot fix it: perfect containers at guessed sizes
are still the wrong sizes.

### Two resolvers, opposite policies, same table

- **Call 1 / A.T.L.A.S.** — `resolveFlatAtlasPreviewDimensions`: falls back to
  the estimator and proceeds **silently**.
- **The paid path** — `manifest.resolve` → `resolveOrQueueUniversalDimensions`:
  **refuses** to guess and raises `genie_dimension_validation_required` for a
  human.

So the proof dims and the panel dims cannot be trusted to agree with GENIE.
RULE 0.19 moved GENIE after purchase deliberately (runs were parking on human
validation); the cost of that move was this silent estimator, and the fix is the
populated catalog, not re-parking the free run.

### The owner's fallback IS implemented — but it inputs the wrong thing

Owner: *"With the fallback, if vehicle not on list it does a Google search for
wheel well then calculates and inputs dimensions."*

`groundedCandidate()` already does this: `gemini-2.5-flash` with
`tools: [{ googleSearch: {} }]`, temperature 0.1, fail-closed parsing, retried
once with a stricter instruction; `insertOrReadGroundedCandidate()` persists it
so the next job reads the row instead of searching again.

**The gap is WHAT it persists.** The grounded row carries only the bounding box
— `overall_length_in`, `overall_width_in`, `overall_height_in`, `wheelbase_in`.
The six panel sizes are never calculated and never stored; they are
re-approximated from class constants on every read. The owner's spec is that the
fallback **calculates and inputs the dimensions** — i.e. writes the six real
per-surface panel sizes into the panelizer catalog, so that vehicle is measured
once and every later job (and the paid path) reads the same numbers.

### Work items, in order

1. **Run `.github/workflows/migrate-genie-catalog.yml`** (`MIGRATE_GENIE_CATALOG`).
   It copies the 1,781 rows verbatim and idempotently, upserting by id, touching
   only that catalog table. One dispatch. Do this first — it is the difference
   between measured and averaged sizes for every vehicle already known.
2. **Make the grounded fallback write per-surface panel sizes** into
   `designpro_vehicle_dimensions`, not just the bounding box, so an unknown
   vehicle is measured once and then behaves exactly like a catalog vehicle.
3. **Delete the class-constant estimator as a silent read-time path.** After 1
   and 2 the only sources are: a catalog row, or a grounded row that was
   calculated and stored. An unresolvable vehicle is an honest refusal.
4. Only then does §1's hardwired shell produce correctly sized containers.

---

## 5. THE 4K MASTER

The canonical Call-1 master must be **stored at its true 4096×4096**. PanelPro
already reports `contentHash · 4096×4096`, so the "it looks tiny" symptom is UI
scaling, not resolution — but the UI must expose a **1:1 / open-original**
control so an admin can verify real pixels instead of judging a thumbnail. The
page already has *Open full size* and *Download master*; make them obvious and
state the pixel dimensions beside the image.

---

## 6. END-TO-END ACCEPTANCE

One fresh generation must prove, in one run:

- 1 accepted master, stored at 4096×4096
- **6/6** persisted panels
- 5" bleed on all six
- logo / brand assets extracted and persisted
- Driver proof first
- 7 canonical 3D proof slots
- RevisionStudioIQ populated from the persisted artifacts
- PanelPro Studio populated from **the same** persisted artifacts

and every artifact bound to the same `generationId`, `DesignID`,
`atlasRevisionId` and `masterContentHash`.

> **Do not report READY while either UI is synthesizing its own representation
> of a missing canonical artifact.**

---

## 7. WHAT IS ALREADY TRUE (verified 2026-08-27, do not redo)

Confirmed against the deployed system, not against source:

- **Call 1 runs through the real `design-panel-ai-generate` edge function.** The
  deployed body carries `atlas-artboard-designiq.20260827.v2`,
  `atlasFlatMasterContract`, `COMMERCIAL_DEPTH`, and the customer-text port
  (`TEXT LAYER DIRECTION` / `textLayerPrompt`).
- **The Houdini pair is attached in full.** Both halves — the flattened
  top-view sheet and the finished 3D proof — plus their framing text. Until
  2026-08-27 the staging step took `topologyParts.find(...)`, the FIRST inline
  image, so the finished-proof half was silently dropped.
- **The authoring model is the GA id** `gemini-3-pro-image`. The three most
  recent failed runs (`04cc0b29`, `13bdc331`, `fb63e76f`) were authored on
  `gemini-3-pro-image-preview`, the id the eleven-run table in CLAUDE.md says
  loses on the flanks.
- **The 3D proof branch cannot redesign.** `buildAtlasProjectionPrompt` carries
  none of `LOGO_REQUIREMENT`, `buildLogoArchitecture`, `COMMERCIAL_DEPTH`,
  `COMMERCIAL_TRANSLATION`, `PROFESSIONAL_JUDGMENT`, the brief header, or the
  brand/industry fields. Locked by `tests/atlas-proof-presentation-only.test.mjs`.
- **Runtime v10-edge and its DB gate are live and matched.**

### Why the recent runs read FAILED

Not a mislabel — an all-or-nothing verdict. On `04cc0b29`: five views accepted
(side, passenger, hood, front, rear), two refused after four attempts each
(roof, close-up) with `semantic_review_required`. One failed slot sets
`generation_slots_failed`, which the library renders as FAILED across the whole
design.

**Open question for the owner:** should 5-of-7 read as FAILED? A count
("5 of 7 views") distinguishes a near-miss from a real failure. Not changed
unilaterally, because it changes what the downstream gates mean.

---

## 8. STILL OPEN, NOT YET DONE

- The hardwired artboard shell (§1) — **not built**. This is the top item.
- **The parallel fan-out is the owner's restated priority (2026-08-27):** "It
  needs to use our edge function design panel ai generate — SINGLE ATLAS is
  created and all the other assets done sequentially and in parallel." Call 1
  already executes through the deployed `design-panel-ai-generate` (verified,
  §7); what remains is that panels, asset extraction and the Driver proof must
  all start on master acceptance rather than queue behind one another.
- The parallel fan-out (§2) — panels and assets are not proven to publish
  independently of the proof set.
- The five contradictions (§4) — diagnosed, not fixed.
- The design-quality failure is **separate and still real**. The Harbor Point
  artwork is subpar on the owner's judgement. Do not treat any artifact-graph
  fix as answering it, and do not treat a graph fix as licence to rewrite the
  creative prompt (RULE 0.1).
- **The served HTML still carries no `Cache-Control` header**, so phones keep
  replaying old bundles — the owner's device was on build `5f889ad` while the
  origin served far newer code. The fix is written in `ops/Caddyfile.fragment`
  and has never been applied to the droplet: dispatch `install-caddy.yml` with
  the live release SHA. **Until that is applied, treat any owner screenshot as
  potentially showing stale code.**
