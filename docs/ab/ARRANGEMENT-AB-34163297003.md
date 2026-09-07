# Arrangement A/B — vehicle UNROLL vs STACKED BANDS — run 34163297003 (2026-09-07)

**Result: NULL on the primary endpoint. 0/18 zones in both arms. The arrangement is
cleared as the cause of vehicle anatomy in the artwork.**

Harness only. Branch `claude/atlas-arrangement-ab` @ `ddbbadad`, workflow option
`arrangement-ab`, 3 draws per arm interleaved A,B,A,B,A,B on the F250 / Precision
Climate fixture, `gemini-3-pro-image`, 1:1, 4K. No generation, revision, view or
artifact row was created. Evidence artifact: `atlas-teaching-proof-ab-34163297003`
(six raw masters, both guides, both prompts, six cut panels per draw,
`results.json`, `COMPARISON.md`).

## The two arms

| | A — unroll (Test 8's arm B, drawn fresh) | B — stacked bands |
|---|---|---|
| parts | 3: deployed prompt · guide text · unroll guide | 3: prompt with five arrangement phrases swapped · same guide text · bands guide |
| prompt | 4,587 chars, `dcb73e9e…` (the deployed prompt) | 4,617 chars, `b4d419eb…` |
| images | 1 (production neutral unroll guide) | 1 (bands guide: driver band, passenger band, rear/roof/hood/front row) |
| teaching proof | absent | absent |
| request bytes | 188,110 | 149,780 |

Creative assembly identical in both arms (2,622 chars). The five swaps reverse to the
deployed tail byte for byte. Neither arm carries the Flamingo proof.

## Per draw

| draw | arm | gate class | zones passing | template signature | worst edgeHole | worst largest dark shape | worst non-artwork share |
|---|---|---|---|---|---|---|---|
| A1 | unroll | flat_atlas | 0/6 | 4 surfaces | 0.936 (hood) | 26.6% (front) | 51.8% |
| B1 | bands | vehicle_depiction | 0/6 | 0 | 0.045 | 0.3% | 89.8% (hood) |
| A2 | unroll | vehicle_depiction | 0/6 | 0 | 0.134 | 2.8% | 76.4% |
| B2 | bands | vehicle_depiction | 0/6 | 0 | 0.016 | 4.0% | 77.8% |
| A3 | unroll | vehicle_depiction | 0/6 | 0 | 0.010 | 0.0% | 61.6% |
| B3 | bands | vehicle_depiction | 0/6 | 0 | 0.039 | 4.1% | 82.2% |

Inspector evidence, verbatim (production `classifyAtlasCandidate`, gemini-2.5-flash, temp 0):

- B1: "multiple views of a truck body, including side profiles and individual panels like the hood and tailgate"
- B2: "multiple views of vehicle body parts like truck sides, a hood, a tailgate, and a bumper"
- B3: "multiple 3D rendered views of a truck body with contours, windows, mirrors, and lights"
- A2: "a vehicle (a truck or van) with graphics applied to its body, including the hood, roof, and side"
- A3: "multiple views of a truck, showing its body contours and lights"

## What the images show

- **B1, B2, B3**: inside each band the model drew the **side profile of a pickup** —
  cab, bed, wheel arches, windows, mirrors — with the wrap artwork applied to that
  body, on a plain grey or white ground. The bottom row holds a roof/tailgate piece, a
  hood piece, a tailgate and a bumper. Every one is a picture of a vehicle body part.
- **A1**: the unroll, with the surface labels PASSENGER SIDE / DRIVER SIDE / REAR /
  ROOF / FRONT printed into the image (the textual label leak Test 6 proved) and
  die-cut wheel arches on both flanks.
- **A2**: a photoreal top-down truck rendered in the centre column (windshield, mirrors,
  grille); the two flanks are abstract artwork, one with rotated lettering.

## What changed, and what did not

The bands **removed the die-cut black hole signature entirely**: largest single dark
shape fell from 13–27% (A1) to ≤4.1% on every B zone; edgeHole from 0.43–0.94 to
≤0.045. That matches Test 2 ("removing the guide fixed the black, not the shape"):
the dark holes are a property of drawing the vehicle over a dark guide field. Change
the field, the holes go; the vehicle stays.

The bands **did not stop the model drawing the vehicle**. With the six surfaces named
DRIVER SIDE, PASSENGER SIDE, HOOD, ROOF, FRONT, REAR, arranged in any way, the model
drew truck body pieces. Non-artwork share 30–90% because a body piece does not fill a
rectangle.

## Conclusion

The layout is not the cue. Twelve prior experiments plus this one now agree: every
request that **names the six surfaces as vehicle parts** draws vehicle parts,
whatever the arrangement, the guide, or the teaching image; the only clean runs (FR1,
FR2) named no surface and no panel. The remaining variable is the **vocabulary** that
tells the model each rectangle *is* a body part — the panel names and "the complete
flattened panel layout of the vehicle" — not where the rectangles sit.

The owner has separately ruled (RULE 0.0) that anonymous FIELD A–F conditioning
produced abstract art with no vehicle-wrap identity. So the open question is now narrow
and stated exactly: **how to convey "artwork destined for the driver side" without
conveying "a picture of the driver side"**. That is a wording question, and Tests 5,
7b and Anchor v1–v4 show that the naive rewordings do not work either.

No production change follows from this run.
