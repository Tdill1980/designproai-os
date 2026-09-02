# Field recovery v2 — Draw 1 (`field-thirds-v2`)

Harness only. ONE Gemini image call, ZERO Flash calls. No repair, no gate, no second draw. Every number below is telemetry.

## In the owner's order — look, then read

1. **RAW MASTER** — `draw1-field-v2-raw.png`, exactly what Gemini returned, hashed and written before any transformation: sha256 `e13b65f685f9dfb65ee14298a68c25c89daa3763a5de8e08caf9fa5d62182704` (10787119 B, delivered 4096×4096, nativelyFourK true).
2. **DRIVER** — `panels/panel-driver.png` 3371×1365 px · sha256 `42424f58ae1fd6d638537decdcf83cfd568e094f67c4dd2d7b8dcccc98abc7ea`
3. **PASSENGER** — `panels/panel-passenger.png` 3371×1365 px · sha256 `7c34af27f9a72d829922fcd35a09af17e53cc64693305ecb5d8617def1d4c9e3`
4. **HOOD** — `panels/panel-hood.png` 1031×835 px · sha256 `59b2c447e7762a9ecbadbb0d09768d68386ca1e116dafe933e27d8e61cc6167e`
5. **ROOF** — `panels/panel-roof.png` 1066×820 px · sha256 `78625b3ed6850d5640a00736c35111c2f3ec2b4d7898dbf15910bfbaeea2971c`
6. **FRONT** — `panels/panel-front.png` 1758×557 px · sha256 `8fa9dd9a547f60998f0fe62caf5e440807129381248bc197807018c2c4bc2b3c`
7. **REAR** — `panels/panel-rear.png` 1088×809 px · sha256 `a6858848caff80d91ff34cd5fa5d64fa82f6e0e84c969b5a24266bdfaaa5b380`

## Raw vs normalized

Normalized master `draw1-field-v2-master-masked.png` sha256 `c94b28b70ad3e9b812b1b2a44dbc01d8409fa328b87b2f00f225abf642095a2b`. Hashes differ: **true**. Normalization = resize to 4096x4096 (fit: fill, lanczos3) + ensureAlpha + zone mask (dest-in) + PNG re-encode; artwork pixels inside the territories are not repainted. The six files are cut from the normalized master (the existing production path); the raw bytes are preserved untouched beside it.

## Coordinates, hashes, native PPI

| surface | territory (x, y, w, h) | trim (x, y, w, h) | print in | file px | native px/in | sha256 | sourceMasterHash = normalized master |
|---|---|---|---|---|---|---|---|
| driver | (362, 0, 3371, 1365) | (465, 103, 3165, 1159) | 163×66 | 3371×1365 | 20.68 | `42424f58ae1fd6d6` | true |
| passenger | (362, 1365, 3371, 1365) | (465, 1468, 3165, 1159) | 163×66 | 3371×1365 | 20.68 | `7c34af27f9a72d82` | true |
| hood | (1186, 2730, 1031, 835) | (1249, 2793, 905, 709) | 81.5×66 | 1031×835 | 12.65 | `59b2c447e7762a9e` | true |
| roof | (120, 2730, 1066, 820) | (183, 2793, 940, 694) | 84.3×64.8 | 1066×820 | 12.65 | `78625b3ed6850d56` | true |
| front | (2217, 2730, 1758, 557) | (2280, 2793, 1632, 431) | 139×44 | 1758×557 | 12.65 | `8fa9dd9a547f6099` | true |
| rear | (2217, 3287, 1088, 809) | (2280, 3350, 962, 683) | 86×64 | 1088×809 | 12.64 | `a6858848caff80d9` | true |

Six distinct files: true · Driver ≠ Passenger bytes: true · **Passenger mirror MAE 0.06703380310457516** (pixel math from the production checks; low = Passenger is a mirror of Driver) · method `deterministic_atlas_crop`, deterministic true · GENIE manifest `879291d3a9120666dda28205807fdee7e6cce8e7caabf116aa7b4b078327008b` (measured) · extracted 76.3% of canvas

## Edge-to-edge (colour-blind, telemetry)

Whole field: nonArtwork 9.8%, border artwork 0.0%, edge-reachable field 7.5%. A smooth painted ground reads as non-artwork to this instrument (v1 finding); the owner's eye decides.

| surface | bleed nonArt | bleed border | bleed OK | trim nonArt | trim border | trim OK |
|---|---|---|---|---|---|---|
| driver | 23.3% | 19.0% | no | 14.1% | 70.5% | no |
| passenger | 21.1% | 21.3% | no | 13.5% | 64.2% | no |
| hood | 43.6% | 53.3% | no | 53.8% | 79.7% | no |
| roof | 41.8% | 49.9% | no | 49.5% | 42.4% | no |
| front | 58.4% | 47.6% | no | 66.8% | 47.4% | no |
| rear | 41.1% | 56.9% | no | 43.5% | 76.1% | no |

## Continuity across territory borders

| boundary | axis | at | boundaryMae | divider |
|---|---|---|---|---|
| driver → passenger | y | 1365 | 0.24709 | no (84.4%) |
| passenger → hood | y | 2730 | 0.06087 | YES, 16px |
| passenger → roof | y | 2730 | 0.09709 | YES, 16px |
| passenger → front | y | 2730 | 0.07303 | YES, 16px |
| hood → front | x | 2217 | 0.02411 | no (0.0%) |
| hood → rear | x | 2217 | 0.12287 | no (22.9%) |
| roof → hood | x | 1186 | 0.03447 | no (1.9%) |
| front → rear | y | 3287 | 0.03031 | no (17.6%) |

## Production resolution

Native effective PPI per file is recorded above. No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness; production-resolution transformation is a separate layer and a separate owner decision.

## For the record (last)

Legacy checks (pixel math, record only): accepted=true, blocking=0 · output class: skipped · per-file inspections: not spent · latency 45.4s · image calls 1 · Flash inspections 0

Receipts: 
- whole-field border artwork 0.0%, edge-reachable field 7.5% (an object on a surround, OR a smooth painted ground — the owner's eye decides)
- a divider 16px deep at passenger/hood — the thirds may have been drawn as containers
- a divider 16px deep at passenger/roof — the thirds may have been drawn as containers
- a divider 16px deep at passenger/front — the thirds may have been drawn as containers

STOP. No second draw until the owner reviews Draw 1.
