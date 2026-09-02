# A.T.L.A.S. anchor restoration v4 — v3 plus one negative, Draw 1 (2026-09-02)

Run `33650898106` on `adfb1058`, contract `designpro.atlas-anchor-restoration.v4`.
Harness only. ONE Gemini image request (42.1 s). No production change, no deploy.
Capture-only parity first (run `33650682176`): zero provider calls.

## The single variable

v3 (run 33649706183) plus exactly one three-word negative inside the
embodiment sentence, right after the rectangle clause: **"No tire cutouts."**
Nothing else changed: prompt 4,548 chars `a653eba8f22f426e`; teaching text
`4f45d370380c7dcc`; guide text `3eebedb6096f9409`; images, model, config,
`CENTER_ORDER`, GENIE, extraction unchanged. The contract refused any second
negative.

## Raw master — look first

`draw1-anchor-raw.png` sha256 `89fe0d6ed524eeda…`, 8,629 KB, 4096×4096.
Downscale: `docs/ab/anchor-restoration-v4-33650898106-raw-master-1600.jpg`.

## 1. Visual acceptance — FAIL, and a regression from v3

The draw went backwards to the v1/v2 class:

- both flanks are full die-cut truck side profiles: cab silhouette, a window
  opening, door seams, a fuel door, and **two large tire cutouts per flank**,
  larger and more emphatic than v3's notches;
- the centre column is a hood-shaped piece, a shaped roof/cab piece with a
  windshield curve, a shaped front, a shaped tailgate;
- **burned-in labels for the first time in this series**: "HOOD", "ROOF",
  "Front", "Rear", "Driver Side", "Passenger Side" printed on the grey
  surround and inside regions;
- grey separation field; Passenger a near mirror of Driver
  (`passengerMirrorMae 0.0056`).

Output class (record): `vehicle_depiction` — "various vehicle body contours
and panel shapes laid out flat, representing a mockup of a vehicle wrap".
Legacy gate: `accepted=true`, zero blocking, zero cut-outs (the gate would
have accepted this master).

## 2. Edge-to-edge — telemetry

| surface | bleed nonArt | largest field | border art | contour | bleed OK | trim nonArt | trim OK |
|---|---|---|---|---|---|---|---|
| driver | 44.7% | 20.4% | 25.3% | 0.445 | no | 40.0% | no |
| passenger | 44.4% | 20.7% | 25.5% | 0.437 | no | 37.7% | no |
| hood | 57.8% | 40.6% | 33.7% | 0.578 | no | 52.8% | no |
| roof | 51.5% | 13.5% | 31.8% | 0.427 | no | 48.5% | no |
| front | 39.9% | 8.2% | 63.6% | 0.390 | no | 45.4% | no |
| rear | 42.7% | 22.5% | 44.5% | 0.412 | no | 41.7% | no |

0/6 and 0/6. Largest non-artwork fields 8–41% (v3: 10–28%).

## 3. Canonical integrity — all true

Master `bb15fe07e5bd0f90…`, GENIE manifest hash `879291d3a9120666…`. Six
distinct files, every `sourceMasterHash` equals the master, method
`deterministic_atlas_crop`, GENIE hash bound, Driver ≠ Passenger by hash.

| surface | file px | native px/in | sha256 |
|---|---|---|---|
| driver | 2848×1153 | 17.47 | `05069ad474b43927` |
| passenger | 2848×1153 | 17.47 | `078ce2e309f302fd` |
| hood | 1262×1022 | 15.48 | `fe19b236ab0a2717` |
| roof | 1262×970 | 14.97 | `33d00effcc3c152b` |
| front | 1262×399 | 9.07 | `c530ba252ce86515` |
| rear | 1262×939 | 14.67 | `8598e557c70d74bd` |

## Reading

One draw cannot separate an effect from the within-condition variance this
fixture is known to have (the same request has returned both output classes
an hour apart). With that stated, the direction of this draw is the one the
file's standing rule predicts: naming the forbidden thing produced more of
it. v3 without the negative gave rectangles with small notches; v4 with the
negative gave full body pieces with large tire cutouts, plus labels. The
negative is the only change. Recommendation: revert to v3 wording (drop the
one negative) and do not spend further draws on negatives. STOP for owner
review.

Evidence: `docs/ab/anchor-restoration-v4-33650898106-*`; full-resolution
images in the run artifact (90 days).
