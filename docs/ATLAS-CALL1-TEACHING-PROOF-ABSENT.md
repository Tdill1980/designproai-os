# Test 8 — the teaching proof PRESENT vs ABSENT

Run `33597621527`; capture-only parity gate `33597562478`. 3 draws per arm,
interleaved A1 · B1 · A2 · B2 · A3 · B3. Six image calls, six flash inspections.
Harness only. No production file changed. No deploy.

## What was varied, and what was held

**A** is the deployed Call-1 request, byte for byte (4,762,109 B / 5 parts /
2 images / 4,587-char prompt — identical to the deployed edge measured on run
`33577484230`).

**B** is byte-identical except parts [1] (the teaching instruction, 502 chars,
`6f92d8ae60d392a5`) and [2] (the labeled Flamingo proof, `684534d27f8e7d70`) are
ABSENT. 187,845 B / 3 parts / 1 image. Not replaced with another image. No
topology added. No new format clause.

| held | value |
|---|---|
| creative prompt (part 0) | sha `dcb73e9eae229cd8`, 4,587 chars, byte-identical in both arms |
| target guide text (part 3 → B part 1) | `a93e2c7a16fea22a`, present in both arms |
| target guide image (part 4 → B part 2) | `7c10d6ae0a3249ef`, present in both arms |
| model / config | `gemini-3-pro-image`, `1:1`, `4K`, `["TEXT","IMAGE"]` |
| customer fixture, vehicle, GENIE manifest | unchanged |

The creative prompt cites no attachment (no "teaching", "example", "reference",
"attached", "supplied" or "provided" wording about an image), so removing the
pair leaves no dangling citation. Locked by `tests/atlas-teaching-proof-ab.test.mjs`.

## PRIMARY ENDPOINT — pane-edge compliance (RULE 0.32)

```
A1: 0/6 full-bleed panes
B1: 0/6 full-bleed panes
A2: 0/6 full-bleed panes
B2: 0/6 full-bleed panes
A3: 0/6 full-bleed panes
B3: 0/6 full-bleed panes
```

**0 of 36 panes** in the run reached compliance (artwork on ≥98% of the pane's
own border and no non-artwork field over 2% of the pane). Colour-blind measure,
`designpro.atlas-fullbleed-colourblind.v1`; no near-black predicate involved.

## 2 — missing-artwork share, per pane (share that is NOT artwork)

| draw | arm | driver | passenger | hood | roof | front | rear | worst |
|---|---|---|---|---|---|---|---|---|
| A1 | A | 56.5% | 54.9% | 81.1% | 57.5% | 67.6% | 63.5% | 81.1% |
| B1 | B | 51.9% | 47.8% | 49.0% | 51.3% | 11.1% | 26.1% | 51.9% |
| A2 | A | 35.2% | 49.2% | 73.4% | 65.3% | 61.6% | 51.1% | 73.4% |
| B2 | B | 39.8% | 38.8% | 37.3% | 46.9% | 51.5% | 29.7% | 51.5% |
| A3 | A | 48.4% | 50.9% | 43.5% | 53.2% | 65.6% | 57.2% | 65.6% |
| B3 | B | 35.5% | 53.8% | 47.3% | 20.9% | 71.2% | 52.0% | 71.2% |

Across all 18 panes per arm: **A mean 57.5%** (range 35.2–81.1%),
**B mean 42.3%** (range 11.1–71.2%). B carried less missing
artwork on average. That is a directional difference on a secondary metric, not
progress toward the endpoint: the single best pane in the whole run (B1 front,
11.1%) is still more than five times the 2% ceiling, no B draw reached even 1/6,
and the two arms' ranges overlap almost completely.

## 3 — largest single missing field, share of pane

| draw | arm | driver | passenger | hood | roof | front | rear |
|---|---|---|---|---|---|---|---|
| A1 | A | 26.3% | 26.2% | 54.5% | 34.6% | 11.1% | 49.1% |
| B1 | B | 19.9% | 20.3% | 32.7% | 27.1% | 1.9% | 17.8% |
| A2 | A | 9.8% | 20.0% | 38.1% | 29.8% | 24.7% | 9.3% |
| B2 | B | 10.2% | 10.3% | 17.1% | 27.5% | 28.1% | 14.2% |
| A3 | A | 15.9% | 15.9% | 23.7% | 26.8% | 43.6% | 15.3% |
| B3 | B | 5.5% | 9.4% | 9.9% | 6.5% | 17.2% | 11.2% |

Border artwork ratio (1.000 = artwork reaches all four of the pane's own edges):

| draw | arm | driver | passenger | hood | roof | front | rear |
|---|---|---|---|---|---|---|---|
| A1 | A | 0.082 | 0.082 | 0.140 | 0.177 | 0.134 | 0.194 |
| B1 | B | 0.538 | 0.607 | 0.647 | 0.265 | 0.983 | 0.462 |
| A2 | A | 0.662 | 0.625 | 0.501 | 0.351 | 0.529 | 0.414 |
| B2 | B | 0.189 | 0.243 | 0.290 | 0.192 | 0.705 | 0.722 |
| A3 | A | 0.117 | 0.099 | 0.632 | 0.219 | 0.729 | 0.291 |
| B3 | B | 0.550 | 0.510 | 0.986 | 0.814 | 0.846 | 0.751 |

Contour / silhouette score (0 = the artwork fills its own bounding box):

| draw | arm | driver | passenger | hood | roof | front | rear |
|---|---|---|---|---|---|---|---|
| A1 | A | 0.508 | 0.491 | 0.750 | 0.385 | 0.661 | 0.580 |
| B1 | B | 0.519 | 0.478 | 0.490 | 0.432 | 0.111 | 0.106 |
| A2 | A | 0.352 | 0.492 | 0.734 | 0.617 | 0.616 | 0.495 |
| B2 | B | 0.398 | 0.388 | 0.373 | 0.332 | 0.515 | 0.297 |
| A3 | A | 0.441 | 0.468 | 0.435 | 0.387 | 0.655 | 0.569 |
| B3 | B | 0.355 | 0.538 | 0.473 | 0.209 | 0.712 | 0.520 |

## 4 — technical furniture

Not the deciding term: no pane in either arm is free of non-artwork field.
Arm B, with no teaching image at all, still returned six discrete rectangles
arranged on a sheet in every draw — the panel-board gestalt is produced by the
prompt and the neutral guide alone. Whether printed labels appear is a
judgement on the images.

## 5 — Driver/Passenger cohesion

| draw | arm | passenger-mirror MAE |
|---|---|---|
| A1 | A | 0.00379 |
| B1 | B | 0.05330 |
| A2 | A | 0.07010 |
| B2 | B | 0.00375 |
| A3 | A | 0.00337 |
| B3 | B | 0.09828 |

## 6 — output class (last)

| draw | arm | disposition | inspector evidence |
|---|---|---|---|
| A1 | A | `vehicle_depiction` | The image displays individual vehicle body panels with their specific contours, laid out flat, which constitutes a mockup or montage of vehicle parts. |
| B1 | B | `vehicle_depiction` | The image shows a 3D render of a truck body with applied graphics, clearly depicting vehicle body contours and implied lights. |
| A2 | A | `vehicle_depiction` | The image displays various vehicle parts like the hood, roof, and front, showing body contours and reflections. |
| B2 | B | `flat_atlas` | The image displays multiple flat 2D print artwork panels laid out side by side, with no vehicle body depicted. |
| A3 | A | `flat_atlas` | The image displays multiple flat 2D print artwork panels laid out on a single sheet, without any vehicle body depiction. |
| B3 | B | `flat_atlas` | The image displays multiple rectangular print artworks laid out side by side on a single sheet, with no vehicle depicted. |

A: vehicle_depiction ×2, flat_atlas ×1. B: vehicle_depiction ×1, flat_atlas ×2.
The same coin flip every test has measured. `flat_atlas` verdicts landed on
sheets that are 21–71% missing artwork per pane.

## 7 — latency

| draw | arm | latency |
|---|---|---|
| A1 | A | 38.1s |
| B1 | B | 46.1s |
| A2 | A | 36.0s |
| B2 | B | 39.2s |
| A3 | A | 32.6s |
| B3 | B | 36.5s |

## Legacy gate, for the record — NOT the endpoint

| draw | arm | `deterministicMasterChecks.accepted` | blocking findings |
|---|---|---|---|
| A1 | A | True | 0 |
| B1 | B | True | 0 |
| A2 | A | True | 0 |
| B2 | B | False | 0 |
| A3 | A | False | 5 |
| B3 | B | True | 0 |

The production-shaped gate ACCEPTED four of these six masters, each carrying
35–81% missing artwork per pane. `holeAt` is near-black-or-transparent, and none
of these fields is either. This is RULE 0.32's blind spot measured again.

## Conclusion

**Null. Removing the teaching proof does not produce continuous edge-to-edge
print media.** Both arms 0/6 in every draw; 0/36 panes.

Two things this run establishes beyond its own null:

1. **The panel-board gestalt does not come from the teaching image.** With no
   example image in the request, Gemini still drew six discrete rectangles on a
   sheet, each with artwork floating inside a surround. The prompt's named
   surface list and the neutral six-region guide are sufficient to produce it.
2. **The conditioning investigation is complete.** Eight isolated variables —
   teaching-proof field, guide presence, topology text, teaching-proof order,
   object clause, printed labels, output-object description, teaching-proof
   presence — and pane compliance never left 0/6 in any draw of any arm.

Per the owner's decision rule, all Call-1 prompt/reference experimentation stops
here. The evidence says the single-image "draw the A.T.L.A.S. sheet yourself"
task is not reliably producing the A.T.L.A.S. raster contract, and the next move
is architectural — the authoring object changes while A.T.L.A.S. stays the
canonical design authority — not another prompt hypothesis.

Raw evidence: `docs/ab/teaching-proof-absent-33597621527-results.json`,
`-parity.json`, `-requests.json`, `-run.log`.
