# Field recovery — Draw 1 (`field-bands-v1`)

Harness only. ONE Gemini image call. Every metric below is telemetry; nothing here is a production gate.

## 1. Creative parity — OWNER JUDGEMENT on `contact-sheet.png`

Does this still look like a professionally composed DesignProAI vehicle-wrap design? Geometry that passes while the design collapses into horizontal-band wallpaper is FAIL.

## 2. Canonical serialization

Master sha256 `379040ce270882a7cac6be8c17bea1a27178b2fc80eec55643dcab7cc85dfbdb` · GENIE manifest hash `879291d3a9120666dda28205807fdee7e6cce8e7caabf116aa7b4b078327008b` (measured) · delivered 4096×4096

| surface | territory (x, y, w, h) | trim (x, y, w, h) | print in | file px | native px/in | sha256 |
|---|---|---|---|---|---|---|
| driver | (0, 0, 3642, 1475) | (112, 112, 3418, 1251) | 163×66 | 3642×1475 | 22.34 | `e14e26aaf3251c57` |
| passenger | (0, 1475, 3642, 1475) | (112, 1587, 3418, 1251) | 163×66 | 3642×1475 | 22.34 | `afbc32c89a16f747` |
| hood | (743, 2950, 718, 582) | (787, 2994, 630, 494) | 81.5×66 | 718×582 | 8.81 | `49724362cf6c4d83` |
| roof | (0, 2950, 743, 571) | (44, 2994, 655, 483) | 84.3×64.8 | 743×571 | 8.81 | `cd441652a82c52a0` |
| front | (1461, 2950, 1225, 388) | (1505, 2994, 1137, 300) | 139×44 | 1225×388 | 8.81 | `17ef43e0da1bc018` |
| rear | (0, 3532, 758, 564) | (44, 3576, 670, 476) | 86×64 | 758×564 | 8.81 | `217e8bda2c45a32d` |

All six `sourceMasterHash` = master: true · method `deterministic_atlas_crop` · extracted 74.4% of canvas, painted-not-extracted 25.6%

## 3. Pane/file integrity — colour-blind full-bleed (telemetry)

Whole field: nonArtwork 21.7%, border artwork 82.1%, edge-reachable field 7.9% → 0/1

| surface | bleed rect nonArt | bleed border | bleed OK | trim rect nonArt | trim border | trim OK |
|---|---|---|---|---|---|---|
| driver | 29.6% | 88.0% | no | 29.4% | 74.9% | no |
| passenger | 27.5% | 53.4% | no | 22.2% | 63.9% | no |
| hood | 87.2% | 27.4% | no | 89.7% | 14.8% | no |
| roof | 79.1% | 40.5% | no | 79.0% | 19.0% | no |
| front | 75.3% | 32.9% | no | 78.5% | 27.5% | no |
| rear | 67.8% | 72.3% | no | 68.2% | 42.6% | no |

Bleed rects 0/6 · trim rects 0/6

## Continuity across territory boundaries

| boundary | axis | at | boundaryMae | divider |
|---|---|---|---|---|
| driver → passenger | y | 1475 | 0.01764 | no (0.2%) |
| passenger → hood | y | 2950 | 0.00255 | no (0.0%) |
| passenger → roof | y | 2950 | 0.00553 | no (0.0%) |
| passenger → front | y | 2950 | 0.01032 | no (0.0%) |
| hood → front | x | 1461 | 0.00669 | no (0.0%) |
| hood → rear | y | 3532 | 0.03197 | YES, 5px |
| roof → hood | x | 743 | 0.02715 | no (0.0%) |

## 4. Design intent — OWNER JUDGEMENT

Driver and Passenger each an intentionally useful composition of the same design? Hood / roof / front / rear more than technically valid crops?

## 5. Production resolution

Native effective PPI per surface is recorded above. No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness; production-resolution transformation is a separate layer and a separate owner decision.

## 6. No new blocking gate

Every number above is telemetry.

## For the record (last)

Legacy gate: accepted=true, blocking=0, passengerMirrorMae=0.09102719907407407 · output class: `flat_atlas` — The image displays three rectangular panels of pure graphic artwork laid out side by side, with no vehicle depicted. · latency 41.4s

Mechanical stop conditions tripped: 
- the model drew an object on a surround: whole-field border artwork 82.1%, edge-reachable field 7.9%
Concept proven mechanically (owner judgement still required): false
