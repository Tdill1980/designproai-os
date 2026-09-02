# Test 2 — removing the blank target guide eliminates the flank black-hole defect

Run [33579220719](https://github.com/Tdill1980/designproai-os/actions/runs/33579220719),
2026-09-02, deployed image `designproai-runtime:fb58f702…`, `gemini-3-pro-image`,
6 image calls + 6 production output-class inspections. Capture-only parity first
([33579134790](https://github.com/Tdill1980/designproai-os/actions/runs/33579134790), zero provider calls).

**A** = the exact deployed 5-part Call-1 request (byte-size identical to the
deployed edge: 4,762,109 / 4,587-char prompt / 2 images).
**B** = byte-identical with parts `[3]` target-guide instruction and `[4]` neutral
target guide image absent — 4,579,105 / same prompt / 1 image.
3 draws per arm, interleaved A,B,A,B,A,B.

## Result — raw pre-repair, per draw

| draw | driver edgeHole | passenger edgeHole | driver largest shape | driver flatBlack | anatomy-sized components (driver) | template signature | accepted |
|---|---|---|---|---|---|---|---|
| **A1** | **0.714** | 0.385 | 15.0% | 16.4% | 5 | 4 surfaces | ✗ |
| **A2** | **0.305** | 0.245 | 9.9% | 18.5% | 9 | 0 | ✗ |
| **A3** | **0.840** | 0.515 | 29.7% | 60.7% | 10 | 4 surfaces | ✗ |
| **B1** | **0.000** | 0.000 | 0.0% | 0.0% | 0 | 0 | ✓ |
| **B2** | **0.005** | 0.005 | 0.1% | 0.5% | 929 (sub-pixel texture) | 0 | ✓ |
| **B3** | **0.002** | 0.002 | 0.0% | 0.0% | 501 (sub-pixel texture) | 0 | ✓ |

**Complete separation on every flank metric, both flanks, all three draws.** The
arms do not overlap anywhere. Deterministic acceptance: **A 0/3, B 3/3**.
`passengerMirrorMae` A 0.040 / 0.006 / 0.141 vs B 0.089 / 0.004 / 0.006.
Latency A 31.9 / 35.7 / 42.6 s, B 42.5 / 40.4 / 38.0 s.

The high component counts on B2/B3 are anti-aliased artwork texture, not shapes:
their largest component is 0.1–0.2% of the zone against A's 9.9–29.7%.

## ⚠️ B's clean acceptance is PARTLY A MEASUREMENT BLIND SPOT — do not read it as "B is correct"

Both arms leave a large non-artwork field. Only its colour changed:

| draw | background | share of canvas | near-black share |
|---|---|---|---|
| A1 / A2 / A3 | `rgb(4,4,4)` / `rgb(20,20,20)` / `rgb(4,4,4)` | 33.2% / 44.8% / 52.9% | 33.3% / 44.6% / 53.2% |
| B1 / B2 / B3 | `rgb(92,92,92)` | 25.0% / 55.5% / 40.1% | 0.0% / 2.1% / 0.7% |

`holeAt` — shared by the gate, the cut-out detector and the fill — is *near-black
or transparent*. A grey field is neither, so the identical structural defect
passes when it is grey and blocks when it is black.

**B's six panels are still contoured die-cut silhouettes, not full-bleed
rectangles.** That violates RULE 0.15 and RULE 0.28 exactly as much as A does.
Removing the guide fixed the BLACK, not the SHAPE.

## Output class — and a third class the gate cannot name

Production gate (`classifyAtlasCandidate`, `gemini-2.5-flash`, temp 0):
A `vehicle_depiction` ×3; B `vehicle_depiction`, `flat_atlas`, `vehicle_depiction`.
So the guide is not the output-class cause on this evidence.

The gate is binary and has no verdict for die-cut, vehicle-shaped flat artwork.
Production rows prove it: `134fc3ca` passed as `flat_atlas` at 0.95 with its own
evidence reading *"resembling a template for a vehicle wrap"*. That is an
ACCEPTANCE defect, separate from authoring, and a third rejection class only
stops bad output after it has been made.

## The structural defect this exposed

The normalized `[0,1]` topology is validated by the edge and recorded as
`topologyContract: designpro.atlas-normalized-topology.v1`, and **never becomes a
model input in any form** — no coordinates, no topology language, no orientation,
no DS/PS surface identity, no 3–4dp decimal anywhere in the assembled prompt.
The blank neutral guide occupies the slot the V17 contract intended for it.

## What this does and does not license

It licenses a proposal, not an edit. Nothing in production changed in this run:
teaching proof, its hash pin, the creative prompt, model, 1:1 canvas, GENIE
geometry, extraction, repair and QC are all untouched.

Before any acceptance-rate claim is believed, `holeAt` must stop being colour-
specific — otherwise "accepted" measures the background's colour, not the
panel's validity.
