# Field recovery — Draw 1 (`field-bands-v1`), run `33603368628`

Owner-approved Phase 1, ONE draw. Harness only; nothing in production changed.
Capture-only gate `33603198445` proved parity first with zero provider calls.

## What was sent — and what was not

| | |
|---|---|
| deployed prompt reproduced | sha `dcb73e9eae229cd8`, 4,587 chars (pinned) |
| creative assembly | 2,622 → 2,677 chars, byte-identical except ONE reversible scene clause (`flat orthographic panels` → `continuous full-bleed field`; "never an on-vehicle photograph" kept) |
| output tail | 1,384 chars, three horizontal MOVEMENTS, tail-only forbidden-word guard passed |
| request | **1 part, 0 images, 4,301 bytes** — no guide, no teaching sheet, no labels |
| model / config | `gemini-3-pro-image`, `1:1`, `4K`, `["TEXT","IMAGE"]`, no temperature |
| latency | 41.4 s · delivered 4096×4096 · raw sha `063d673b9b0c34e3` |

Live GENIE geometry for the fixture (state `measured`, manifest hash
`879291d3a9120666…`): driver/passenger **163×66 in print (153×56 trim)**, hood
81.5×66, roof 84.3×64.8, front 139×44, rear 86×64. This is the operator-validated
row for "2022 Ford F250 Crew Cab", not the catalog's 251×60 — the same short
geometry RULE 0.28 already flags. The harness used production's geometry as
production would; the flank bands were therefore width-capped at 3,642 px
(72% height rule) and the centre band scale is 8.81 px/in.

## 1. Creative parity — owner judgement

Session reading of the field, for the owner to confirm or overrule: the whole
4096² canvas is painted edge to edge — deep blue ground, sunrise-orange ribbons,
HVAC iconography, an original gear/airflow logo and "PRECISION CLIMATE SOLUTIONS"
complete and legible in movement one and again in movement two. No vehicle, no
wheels, no glass, no gutters, no surrounds, no labels, no template furniture. It
reads as a DesignPanelAI-register commercial wrap. The three-movement structure
IS visible as three horizontal tiers — the compositional experiment shaped the
composition, which is the owner's stated concern to weigh.

## 2. Canonical serialization

Master sha256 `379040ce270882a7cac6be8c17bea1a27178b2fc80eec55643dcab7cc85dfbdb`.
Six files, `method: deterministic_atlas_crop`, all `sourceMasterHash` = master.

| surface | territory (x, y, w, h) | trim | print in | file px | native px/in | sha256 |
|---|---|---|---|---|---|---|
| driver | (0, 0, 3642, 1475) | (112, 112, 3418, 1251) | 163×66 | 3642×1475 | 22.34 | `e14e26aaf3251c57` |
| passenger | (0, 1475, 3642, 1475) | (112, 1587, 3418, 1251) | 163×66 | 3642×1475 | 22.34 | `afbc32c89a16f747` |
| hood | (743, 2950, 718, 582) | (787, 2994, 630, 494) | 81.5×66 | 718×582 | 8.81 | `49724362cf6c4d83` |
| roof | (0, 2950, 743, 571) | (44, 2994, 655, 483) | 84.3×64.8 | 743×571 | 8.81 | `cd441652a82c52a0` |
| front | (1461, 2950, 1225, 388) | (1505, 2994, 1137, 300) | 139×44 | 1225×388 | 8.81 | `17ef43e0da1bc018` |
| rear | (0, 3532, 758, 564) | (44, 3576, 670, 476) | 86×64 | 758×564 | 8.81 | `217e8bda2c45a32d` |

Extracted 74.4% of canvas; painted-not-extracted 25.6% (right strip + bottom-right).

## 3. Pane/file integrity

**Two instruments disagree, and the disagreement is the finding.**

The colour-blind flood instrument reports **0/6** (whole field: 21.7%
"non-artwork", border artwork 82.1%) and tripped the harness's mechanical stop
condition. The legacy near-black gate reports the opposite: `edgeHoleRatio` **0**
on all six, `flatBlackRatio` **0** on all six, accepted with 0 blocking
findings. In every prior test both instruments convicted the same surrounds
(Test 8: edgeHole 0.3–0.6, flat black 20–80%); here there is no near-black field
anywhere and no transparent region — what the flood instrument counts as
"non-artwork" is the **smooth deep-blue painted ground**, which stays within its
10-level tolerance of a running mean. That is the caveat recorded in the plan
(§P item 3): a colour-blind flood cannot tell a smooth painted base from an
empty surround. It measured smooth base here, not missing artwork. Owner's eye
on `contact-sheet.png` decides; no gate is proposed.

Per-territory (flood instrument, telemetry): driver 29.6% / border 88.0% ·
passenger 27.5% / 53.4% · hood 87.2% / 27.4% · roof 79.1% / 40.5% · front 75.3%
/ 32.9% · rear 67.8% / 72.3%. The centre four sit in movement three's calm
texture, so the flood reads most of them as base.

## Continuity

No drawn divider at any band boundary (0.0–0.2% coverage); boundary MAE
0.003–0.032. One 5-px "divider" at hood→rear (y=3532) is a circuit-line motif
crossing the cut, not a frame. The ground continues across every border.

**Territory ↔ movement misalignment (the plan's risk 2, observed):** the model
read the movements as thirds (transitions near y≈1365 and y≈2731) while the
territories sit at 1475 and 2950. Effect: the driver file carries ~110 px of
movement two's top ribbon at its bottom; the passenger file loses ~110 px of its
top ribbon and carries ~220 px of movement three's calm ground at its bottom.
The company name is complete inside both flank files. The exact-percentage knob
exists and is NOT pulled — no text change without owner approval.

## 4. Design intent — owner judgement

Driver and Passenger: each carries the full composition with the name and logo,
distinct bytes (`passengerMirrorMae` 0.091), opposite ribbon sweep as asked.
Hood / roof / front / rear: crops of movement three's supporting texture — dark
ground, faint circuit motifs, one ribbon crossing the front. **They are
continuation, not intentionally composed surfaces**, and the rear/tailgate
carries no branding by construction. This is the honest weak point of the
three-movement experiment, anticipated in the plan.

## 5. Production resolution

Native effective px/in recorded above (22.34 flanks, 8.81 centre on this
geometry). No 150 / 300 / 1500 claim.

## 6. No new blocking gate

Every number here is telemetry.

## For the record (last)

Output class `flat_atlas` — inspector: "three rectangular panels of pure graphic
artwork laid out side by side, with no vehicle depicted." Legacy gate accepted.
Design-text part empty.

## STOP

Owner ruling: no repeatability block until the owner visually approves Draw 1.
Accounting: **70 confirmed / 71 maximum image calls · 62 flash inspections · 0
production DCAs.**

Raw evidence: `docs/ab/field-recovery-33603368628-*`.
