# Test 4 — the teaching proof's centre order is not sufficient, and n=3 cannot see output class

Run [33582134849](https://github.com/Tdill1980/designproai-os/actions/runs/33582134849),
2026-09-02, deployed image `designproai-runtime:fb58f702…`, `gemini-3-pro-image`,
6 image calls + 6 production output-class inspections, 3 draws per arm,
interleaved. Capture-only parity first
([33582071809](https://github.com/Tdill1980/designproai-os/actions/runs/33582071809), zero provider calls).

**A** = the owner teaching proof (`HOOD → ROOF → REAR → FRONT`), byte-pinned at
4,579,105. **B** = the same proof with only the HOOD and REAR blocks swapped
(`REAR → ROOF → HOOD → FRONT`), 4,459,041. Guide absent in both, no topology
text, prompt/model/config/image-order/fixture identical.

Transform, asserted per pixel off the encoded output: 218,638 pixels changed,
15,166 vacated to field, **0 outside the centre column**, **0 in ROOF**, **0 in
FRONT**, each relocated block pixel-identical to its source block.

## Result — A ≈ B

| | compliance | worst non-artwork | worst contour | output class | mirror MAE | latency |
|---|---|---|---|---|---|---|
| **A1** | 0/6 | 76.5% | 0.708 | `vehicle_depiction` | 0.0668 | 40.7s |
| **A2** | 0/6 | 61.0% | 0.537 | `vehicle_depiction` | 0.0033 | 39.8s |
| **A3** | 0/6 | 53.2% | 0.491 | `vehicle_depiction` | 0.0038 | 37.4s |
| **B1** | 0/6 | 62.8% | 0.626 | `vehicle_depiction` | 0.0037 | 40.8s |
| **B2** | 0/6 | 71.3% | 0.713 | `vehicle_depiction` | 0.1211 | 37.7s |
| **B3** | 0/6 | 52.1% | 0.521 | `flat_atlas` | 0.0666 | 52.1s |

Worst non-artwork mean A 63.6% / B 62.1%. Worst contour mean A 0.578 / B 0.620.
Compliance 0/6 in every draw of both arms.

**Per the decision rule: ordering is not sufficient. Do not move the production
pin.**

## The finding that matters more — output class cannot be measured at n=3

**Test 3's arm A and Test 4's arm A are the SAME request**, byte for byte:
4,579,105 bytes, 3 parts, prompt `dcb73e9e…`, teaching text `6f92d8ae…`,
teaching image `684534d2…`.

```
Test 3 arm A  (33580839109)   flat_atlas · flat_atlas · flat_atlas
Test 4 arm A  (33582134849)   vehicle_depiction · vehicle_depiction · vehicle_depiction
```

Six draws of one identical request, an hour apart: **3 `flat_atlas`, 3
`vehicle_depiction`** — and each run of three looked internally consistent
enough to read as a clean signal.

That retires a conclusion. Test 3 reported "output class separated completely, A
`flat_atlas` 3/3 vs B `vehicle_depiction` 3/3". Against this control that
separation is not attributable to the topology text; it is inside the noise. The
same caution applies to Test 4's own 1/3-vs-0/3.

**Any future output-class endpoint needs materially more than three draws per
arm, or it is measuring a coin.** Compliance, non-artwork share and contour score
do not have this problem: they are stable within arms and have been 0/6 in every
one of the twelve draws measured with the colour-blind instrument.

## What is actually broken

Not ordering, not the guide alone, not the teaching proof's field colour. Across
every measured draw, Call 1 returns **contoured die-cut vehicle pieces floating
on a uniform field** — 26–85% of each zone is not artwork, contour scores 0.09 to
0.85, and the surface labels are copied into the output. The wheel holes were one
manifestation of that, which is why every black-hole-shaped remedy has failed.

## Next

Attack the teaching signal responsible for the contoured interpretation. The
proof's own six panels are discrete objects separated by a field — exactly the
gestalt the output reproduces — and its printed labels are exactly what keeps
appearing in the artwork. Neither has been isolated yet.

No production change. Teaching proof, hash pin, creative prompt, model,
temperature, 1:1 canvas, GENIE geometry, extraction, repair and QC untouched.
