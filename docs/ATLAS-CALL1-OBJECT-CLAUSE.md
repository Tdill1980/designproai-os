# Test 5 — reframing the object clause does not produce continuous rectangles

Run [33587255692](https://github.com/Tdill1980/designproai-os/actions/runs/33587255692),
2026-09-02, deployed image `designproai-runtime:fb58f702…`, `gemini-3-pro-image`,
**12 image calls** + 12 production output-class inspections, 6 draws per arm,
interleaved. Capture-only parity first
([33587185816](https://github.com/Tdill1980/designproai-os/actions/runs/33587185816), zero provider calls).

**A** = the exact deployed request — 4,762,109 bytes, 5 parts, 4,587-char prompt,
2 images, matched against the deployed edge's own numbers before any draw.
**B** = 4,762,177 bytes, byte-identical except one clause:

```
A   …on one sheet — the complete flattened panel layout of the vehicle.
B   …on one sheet — the complete layout of the continuous rectangular printed
    wrap sheets, unwrapped flat before installation and trimming.
```

Parts 1–4 sha-identical, both arms carrying the teaching proof and the guide.

## PRIMARY ENDPOINT (RULE 0.32) — null

**0 of 72 zones compliant.** Not one draw of either arm produced six continuous
rectangular artwork regions edge to edge.

| | worst non-artwork per draw | mean | worst contour | output class | latency |
|---|---|---|---|---|---|
| **A** | 66.2 · 73.6 · 75.9 · 76.5 · 52.0 · 58.7 % | **67.1%** | 0.671 | `flat_atlas` 3 / `vehicle_depiction` 3 | 41.4 s |
| **B** | 70.1 · 46.3 · 56.4 · 77.6 · 61.6 · 59.1 % | **61.9%** | 0.607 | `flat_atlas` 1 / `vehicle_depiction` 5 | 37.1 s |

The ranges overlap almost completely (A 52.0–76.5, B 46.3–77.6). B's lower mean
is inside the spread of A. On output class B is nominally worse, and that is
inside the same coin-flip: **arm A at n=6 is exactly 3 `flat_atlas` to 3
`vehicle_depiction`.**

Driver/Passenger cohesion, `passengerMirrorMae`: A 0.0014–0.1203, B 0.0024–0.1509
— one bad draw each, no separation.

**Label contamination: every draw of both arms.** `PASSENGER SIDE`, `HOOD`,
`ROOF`, `REAR`, `FRONT` burned into the artwork, and in A4 the same label
`PASSENGER SIDE` is printed down BOTH flanks.

**Per the decision rule: B is not materially better. Do not deploy it.** The next
isolated variable is the teaching proof's printed labels.

## What the images add that the numbers do not

Several draws — A4 among them — return panels that ARE rectangles, and still
score 76.5% non-artwork. The rectangles are drawn **smaller than their zones**,
floating inside a black field that fills the rest of the zone rectangle.

So the defect is not only "contoured instead of rectangular". It is also
**scale**: the artwork does not reach the boundaries of the region it was given.
A drawn rectangle that stops short of its zone edge is exactly as much a
missing-artwork field as a wheel-well disc, and RULE 0.32's contract convicts
both.

That is a distinct failure mode from the one tests 1–4 were chasing, and it was
invisible to every colour-thresholded instrument in the stack.

## Standing after five isolated variables

| variable | result |
|---|---|
| teaching proof's black field | refuted — the variant produced the flank holes rather than removing them |
| the blank neutral guide | removed the black, not the shape |
| normalized `[0,1]` topology text | inconclusive, then unattributable at n=3 |
| teaching proof's centre order | null |
| the object-definition clause | **null** |

Across all of it: **0 compliant zones in every draw measured colour-blind.**

## Untested, and now the two live candidates

1. **The teaching proof's printed labels** — the only vehicle-anatomy vocabulary
   inside the image input, burned into the output in every measured draw despite
   the prompt forbidding it in as many words. Next by the owner's rule.
2. **Scale/extent conditioning** — nothing in the request tells the model that
   the artwork must reach the boundary of the region it is given, in a form it
   is evidently acting on. Newly identified by this run; untested.

No production change. Teaching proof, hash pin, creative blocks, model,
temperature, canvas, GENIE geometry, extraction, repair and QC thresholds all
untouched.
