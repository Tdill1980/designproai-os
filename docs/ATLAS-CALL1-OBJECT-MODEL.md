# Test 7b — the model-facing description of the OUTPUT OBJECT

Screening run, 2 draws per arm, interleaved A1 · B1 · A2 · B2.
Workflow run `33595250518`; capture-only parity gate `33595205469`.
Harness only. No production file changed. No deploy.

## What was varied, and what was held

**A** is the deployed Call-1 request, byte for byte.
**B** is byte-identical except the output-contract tail, which describes the
object the model is asked to produce in RULE 0.32's terms — printed vinyl
before installation — instead of "the complete flattened panel layout of the
vehicle".

Held identical in both arms, proven by hash before any provider call:

| held | value |
|---|---|
| DesignPanelAI creative assembly | 2,622 chars, byte-identical in both arms and a prefix of both prompts |
| teaching reference text (part 1) | `6f92d8ae60d392a5` |
| teaching proof image (part 2) | `684534d27f8e7d70` — the owner-approved bytes, unmodified |
| target guide text (part 3) | `a93e2c7a16fea22a` |
| target guide image (part 4) | `7c10d6ae0a3249ef` |
| model / config | `gemini-3-pro-image`, `1:1`, `4K`, `["TEXT","IMAGE"]` |
| parts / images per request | 5 / 2 |

| varied | A | B |
|---|---|---|
| output-contract tail | `655632686d7e76c1` (1,989 B) | `8fd7c31fc848f971` (1,424 B) |
| whole prompt | `dcb73e9eae229cd8` (4,587 chars) | `3af72960a6ed8b5a` (4,030 chars) |
| request size | 4,762,109 B | 4,761,542 B |

Arm A's 4,762,109 bytes / 4,587 chars / 2 images are identical to the deployed
edge measured on run `33577484230`, so A is a control and not a reconstruction.

The surface-name list was kept in both arms, per the owner's instruction for
this screening run.

## PRIMARY ENDPOINT — pane-edge compliance (RULE 0.32)

```
A1: 0/6 panes edge-to-edge
B1: 0/6 panes edge-to-edge
A2: 0/6 panes edge-to-edge
B2: 0/6 panes edge-to-edge
```

Compliance is measured colour-blind (`designpro.atlas-fullbleed-colourblind.v1`):
a pane passes only when artwork reaches ≥98% of its own border and no
non-artwork field exceeds 2% of the pane. Neither `holeAt` nor any near-black
predicate is used.

## 2 — missing-artwork extent, share of each pane that is NOT artwork

| draw | arm | driver | passenger | hood | roof | front | rear | worst |
|---|---|---|---|---|---|---|---|---|
| A1 | A | 42.4% | 40.8% | 55.4% | 49.6% | 47.0% | 38.4% | 55.4% |
| B1 | B | 43.6% | 42.3% | 69.5% | 49.0% | 57.6% | 29.0% | 69.5% |
| A2 | A | 44.2% | 39.6% | 65.8% | 56.6% | 71.1% | 46.0% | 71.1% |
| B2 | B | 65.0% | 58.2% | 68.8% | 50.3% | 63.9% | 44.4% | 68.8% |

Border artwork ratio (1.000 = artwork runs off all four sides):

| draw | arm | driver | passenger | hood | roof | front | rear |
|---|---|---|---|---|---|---|---|
| A1 | A | 0.441 | 0.473 | 0.706 | 0.802 | 0.617 | 0.422 |
| B1 | B | 0.717 | 0.721 | 0.314 | 0.207 | 0.437 | 0.411 |
| A2 | A | 0.593 | 0.675 | 0.431 | 0.736 | 0.242 | 0.392 |
| B2 | B | 0.571 | 0.600 | 0.488 | 0.557 | 0.500 | 0.314 |

Largest single non-artwork region, share of pane:

| draw | arm | driver | passenger | hood | roof | front | rear |
|---|---|---|---|---|---|---|---|
| A1 | A | 6.7% | 6.7% | 24.8% | 11.5% | 11.3% | 7.3% |
| B1 | B | 13.7% | 13.0% | 35.5% | 17.9% | 15.0% | 9.2% |
| A2 | A | 8.8% | 9.7% | 27.1% | 8.9% | 16.2% | 10.4% |
| B2 | B | 17.3% | 14.6% | 26.5% | 11.1% | 18.0% | 16.6% |

Contour / silhouette score (0 = the artwork fills its own bounding box):

| draw | arm | driver | passenger | hood | roof | front | rear |
|---|---|---|---|---|---|---|---|
| A1 | A | 0.424 | 0.408 | 0.554 | 0.496 | 0.470 | 0.383 |
| B1 | B | 0.436 | 0.423 | 0.689 | 0.433 | 0.559 | 0.288 |
| A2 | A | 0.442 | 0.396 | 0.658 | 0.566 | 0.676 | 0.416 |
| B2 | B | 0.650 | 0.582 | 0.688 | 0.503 | 0.619 | 0.444 |

**B is not an improvement on any of these.** On the primary endpoint both arms
are 0/6. On extent, B's worst pane is worse than A's in draw 1 (69.5% vs 55.4%)
and comparable in draw 2 (68.8% vs 71.1%); B's largest single missing region is
larger than A's on 10 of 12 panes.

## 3 — technical furniture

No pane in either arm is free of non-artwork field, so furniture is not the
deciding term in this run. Both arms continue to place the design as shapes
floating inside their panes rather than media filling them.

## 4 — output class (last, per the owner's ordering)

| draw | arm | disposition | inspector evidence |
|---|---|---|---|
| A1 | A | `flat_atlas` | "flat, uninstalled 2D print artwork panels for various vehicle parts laid out on a sheet" |
| B1 | B | `vehicle_depiction` | "multiple views of a truck, including its sides, hood, rear, roof, and front" |
| A2 | A | `vehicle_depiction` | "a pickup truck from multiple angles … clearly depicting a vehicle body" |
| B2 | B | `vehicle_depiction` | "multiple 3D rendered views of a pickup truck with a wrap design, showing body contours, windows, and lights" |

A1's `flat_atlas` disposition sits on a sheet that is 38–55% missing artwork per
pane. That is the point RULE 0.32 makes: a `flat_atlas` verdict is not success.

## Latency and cohesion

| draw | arm | latency | passenger-mirror MAE |
|---|---|---|---|
| A1 | A | 34.8s | 0.00453 |
| B1 | B | 33.1s | 0.07014 |
| A2 | A | 34.4s | 0.09716 |
| B2 | B | 34.4s | 0.05306 |

## Conclusion

**Null-to-negative. Rewriting the model-facing description of the output object
does not produce continuous edge-to-edge print media.** Both B draws remained
0/6 and neither showed a boundary or extent improvement over the A controls.

Per the owner's decision rule for this screening test, the investigation stops
here rather than spending more generations on image- or prose-side variants.
Seven variables have now been isolated (teaching-proof field, guide ablation,
topology text, teaching-proof order, object clause, printed labels, output-object
description) and none of them moves first-attempt pane compliance off zero.

Raw evidence: `docs/ab/object-model-33595250518-results.json`,
`-parity.json`, `-prompt-A.txt`, `-prompt-B.txt`.
