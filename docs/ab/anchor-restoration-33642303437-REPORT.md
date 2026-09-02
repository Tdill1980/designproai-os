# Anchor restoration — Draw 1 (production topology, option A)

Harness only. ONE Gemini image call. Only the output tail of part 0 changed; parts 1–4, model, config and the extractor are production's. Every number here is telemetry; nothing is a gate.

Raw master `draw1-anchor-raw.png` sha256 `4ec49cc542434758686490b0ee5671718f6cc84856940fcde2546a4334dcf959` (8483370 B, delivered 4096×4096) — look at this FIRST.

## 1. Visual A.T.L.A.S. acceptance — OWNER JUDGEMENT

Flattened top-view topology · two intentional flank compositions · four intentional centre compositions · one cohesive professional wrap. Decided on the raw master and `contact-sheet.png`, not below.

## 2. Edge-to-edge acceptance — telemetry, then the eye

All six regions filled completely · no smaller artwork floating inside a region · no wheel/glass/body-anatomy voids.

| surface | bleed nonArt | largest field | border art | contour | bleed OK | trim nonArt | trim OK |
|---|---|---|---|---|---|---|---|
| driver | 51.6% | 33.9% | 41.8% | 0.516 | no | 51.1% | no |
| passenger | 35.8% | 20.1% | 54.8% | 0.358 | no | 38.0% | no |
| hood | 36.0% | 31.0% | 66.8% | 0.360 | no | 41.3% | no |
| roof | 38.0% | 25.5% | 41.8% | 0.380 | no | 31.9% | no |
| front | 51.8% | 8.2% | 43.4% | 0.487 | no | 54.5% | no |
| rear | 24.7% | 10.4% | 45.1% | 0.244 | no | 15.9% | no |

Bleed rects 0/6 · trim rects 0/6. colour-blind edge flood; a smooth or dark painted ground can read as non-artwork (Draw 1 of the field harness). Telemetry does not overrule visual evidence.

## 3. Canonical integrity

Master sha256 `032f31ee0bad05995d6e8dbec2c00e7f5bd4e5e145df26df6279187f219dc181` · GENIE manifest hash `879291d3a9120666dda28205807fdee7e6cce8e7caabf116aa7b4b078327008b` (measured) · centre rear → roof → hood → front

| surface | zone (x, y, w, h) rot | trim (x, y, w, h) | print in | file px | native px/in | sha256 | sourceMasterHash = master |
|---|---|---|---|---|---|---|---|
| driver | (2751, 624, 1153, 2848) -90° | (2838, 711, 979, 2674) | 163×66 | 2848×1153 | 17.47 | `5abdacab5a8c1969` | true |
| passenger | (192, 624, 1153, 2848) 90° | (279, 711, 979, 2674) | 163×66 | 2848×1153 | 17.47 | `8703ac26391ee11c` | true |
| hood | (1417, 2310, 1262, 1022) 0° | (1494, 2387, 1108, 868) | 81.5×66 | 1262×1022 | 15.48 | `834f7226a759a344` | true |
| roof | (1417, 1304, 1262, 970) 0° | (1492, 1379, 1112, 820) | 84.3×64.8 | 1262×970 | 14.97 | `9ece78086df755e5` | true |
| front | (1417, 3368, 1262, 399) 0° | (1462, 3413, 1172, 309) | 139×44 | 1262×399 | 9.07 | `f2ef721450a1c751` | true |
| rear | (1417, 329, 1262, 939) 0° | (1490, 402, 1116, 793) | 86×64 | 1262×939 | 14.67 | `69957f6442aaab6a` | true |

Six distinct: true · Driver ≠ Passenger: true (passengerMirrorMae 0.06979490059912855) · lineage (method `deterministic_atlas_crop`, deterministic, GENIE hash bound): true

## For the record

Legacy gate: accepted=true, blocking=0, cutouts=0 · output class: `vehicle_depiction` — The image displays a mockup of vehicle body parts with applied graphics, showing body contours and multiple views. · latency 42.0s

Native effective PPI per surface is recorded above. No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness.

STOP. No repeatability run, no production change, no deploy until the owner reviews Draw 1.
