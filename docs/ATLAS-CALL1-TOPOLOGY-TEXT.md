# Test 3 — the normalized topology text does not produce rectangles, and costs output class

Run [33580839109](https://github.com/Tdill1980/designproai-os/actions/runs/33580839109),
2026-09-02, deployed image `designproai-runtime:fb58f702…`, `gemini-3-pro-image`,
6 image calls + 6 production output-class inspections, 3 draws per arm,
interleaved. Capture-only parity first
([33580486185](https://github.com/Tdill1980/designproai-os/actions/runs/33580486185), zero provider calls).

**A** = guide absent (test 2's arm B, byte-pinned to 4,579,105). **B** = the same
plus 388 chars of normalized `[0,1]` topology, built from the manifest's own
`panels[].normalized`. Parts 0–2 sha256-identical, one image each, prompt
identical, the whole delta one appended text part.

## PRIMARY ENDPOINT — full-bleed rectangular compliance, colour-blind

| draw | compliant zones | worst non-artwork | worst contour | output class | mirror MAE | latency |
|---|---|---|---|---|---|---|
| A1 | **0/6** | 57.3% | 0.546 | `flat_atlas` | 0.0043 | 46.4s |
| A2 | **0/6** | 64.5% | 0.645 | `flat_atlas` | 0.0041 | 38.9s |
| A3 | **0/6** | 44.3% | 0.429 | `flat_atlas` | 0.0048 | 36.7s |
| B1 | **0/6** | 58.5% | 0.537 | `vehicle_depiction` | 0.0033 | 38.9s |
| B2 | **0/6** | 85.1% | 0.851 | `vehicle_depiction` | 0.0765 | 41.4s |
| B3 | **0/6** | 57.6% | 0.553 | `vehicle_depiction` | 0.0761 | 37.4s |

**Null on the endpoint: 0/6 in every draw of both arms.** Worst non-artwork mean
A 55.4% / B 67.1%; worst contour mean A 0.540 / B 0.647. The topology text moved
both the wrong way.

**Output class separated completely, in the wrong direction.** A `flat_atlas`
3/3, B `vehicle_depiction` 3/3. B3 came back as three photoreal views of a
wrapped pickup — grille, wheels, glass, mirrors. Cohesion also degraded: A's
passenger-mirror MAE is tight at 0.0041–0.0048, B has two draws at 0.076.

## The finding that reframes the whole investigation

Across tests 1, 2 and 3 — **15 draws** — the colour-blind metric records **not one
full-bleed compliant sheet.** Test 2's "clean" arm scored 3/3 on `holeAt` while
carrying 28–54% non-artwork field. Call 1 has never produced six solid
rectangles in any measured run; it produces contoured die-cut panels floating in
a field, and the flank black holes were one symptom of that, not the disease.

## A structural incompatibility, verified from the artifact

The teaching proof's centre column, read from its own printed labels:

```
HOOD → ROOF → REAR → FRONT      (runtime/atlas-examples/flamingo-labeled-…png)
REAR → ROOF → HOOD → FRONT      (CENTER_ORDER, and the topology text's own y-values)
```

HOOD and REAR are swapped between the owner-approved example and the coordinates
the deployed geometry produces. Arm B therefore handed Gemini a coordinate table
contradicting the image directly above it in the same request, and the class
collapsed on all three draws.

That contradiction cannot be resolved by moving either side: the coordinates must
match `manifest.zones` or deterministic extraction breaks, the teaching proof is
owner-pinned and may not be re-authored, and `CENTER_ORDER` is production
geometry. **This is an owner-level finding, not a test.**

## What this does and does not license

Per the owner's decision rule, a null or inconsistent result routes to Test 4 —
resolve the ordering contradiction before any creative prose. The one-line
"cohesive flat wrap / edge-to-edge artwork" sentence stays untouched until two
structural signals agree.

Nothing in production changed: teaching proof, hash pin, deployed creative
prompt, model, temperature, 1:1 canvas, GENIE geometry, extraction, repair, QC.
