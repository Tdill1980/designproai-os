# Field recovery v2 (`field-thirds-v2`) — Draw 1, run [33659500846](https://github.com/Tdill1980/designproai-os/actions/runs/33659500846)

Owner contract (2026-09-02, "GO — ONE DRAW ONLY"): raw Gemini return preserved and hashed BEFORE
`normalizeAtlasMaster`; existing deterministic extraction only; no compiler, no repair, no gate, no
Flash inspections, no second draw. Commit `f5399e23`, deployed runtime image `designproai-runtime:fb58f702…`,
live GENIE row (state `measured`, manifest `879291d3…`). **One image call, zero Flash calls, 45.4 s.**
Raw evidence: `docs/ab/field-recovery-v2-33659500846-*`; the 4096² PNGs are on the run artifact.

## In the owner's order

1. **RAW MASTER** — exactly what Gemini returned: 4096×4096, 10,787,119 B,
   sha256 `e13b65f685f9dfb65ee14298a68c25c89daa3763a5de8e08caf9fa5d62182704`
   (`docs/ab/field-recovery-v2-33659500846-raw-master-1600.jpg` is a preview only).
2. **DRIVER** 3371×1365 · `42424f58ae1fd6d638537decdcf83cfd568e094f67c4dd2d7b8dcccc98abc7ea`
3. **PASSENGER** 3371×1365 · `7c34af27f9a72d829922fcd35a09af17e53cc64693305ecb5d8617def1d4c9e3`
4. **HOOD** 1031×835 · `59b2c447e7762a9ecbadbb0d09768d68386ca1e116dafe933e27d8e61cc6167e`
5. **ROOF** 1066×820 · `78625b3ed6850d5640a00736c35111c2f3ec2b4d7898dbf15910bfbaeea2971c`
6. **FRONT** 1758×557 · `8fa9dd9a547f60998f0fe62caf5e440807129381248bc197807018c2c4bc2b3c`
7. **REAR** 1088×809 · `a6858848caff80d91ff34cd5fa5d64fa82f6e0e84c969b5a24266bdfaaa5b380`

## Raw vs normalized

Normalized master sha256 `c94b28b70ad3e9b812b1b2a44dbc01d8409fa328b87b2f00f225abf642095a2b`. **Hashes differ: true**
(resize 4096→4096 fit:fill, ensureAlpha, zone mask dest-in, PNG re-encode). Artwork pixels inside the
territories are not repainted; the six files are cut from the normalized master, the raw bytes sit beside it.

## Coordinates, hashes, native PPI, Passenger mirror MAE

| surface | territory (x, y, w, h) | trim (x, y, w, h) | print in | native px/in | sha256 |
|---|---|---|---|---|---|
| driver | (362, 0, 3371, 1365) | (465, 103, 3165, 1159) | 163×66 | 20.68 | `42424f58ae1fd6d6` |
| passenger | (362, 1365, 3371, 1365) | (465, 1468, 3165, 1159) | 163×66 | 20.68 | `7c34af27f9a72d82` |
| hood | (1186, 2730, 1031, 835) | (1249, 2793, 905, 709) | 81.5×66 | 12.65 | `59b2c447e7762a9e` |
| roof | (120, 2730, 1066, 820) | (183, 2793, 940, 694) | 84.3×64.8 | 12.65 | `78625b3ed6850d56` |
| front | (2217, 2730, 1758, 557) | (2280, 2793, 1632, 431) | 139×44 | 12.65 | `8fa9dd9a547f6099` |
| rear | (2217, 3287, 1088, 809) | (2280, 3350, 962, 683) | 86×64 | 12.64 | `a6858848caff80d9` |

Six distinct files, every `sourceMasterHash` = the normalized master, `method deterministic_atlas_crop`.
**Passenger mirror MAE 0.0670** (v1 field: 0.091; six-region anchor draws: 0.004–0.006). Driver and
Passenger are different compositions of the same design: name left / mark right versus mark right / name
left with the sweep reversed, as briefed.

## What the raw master is (owner's eye, then measurement)

- **No vehicle anatomy.** No wheel arch, window, seam, silhouette, body piece or burned-in label anywhere.
  First draw in the whole investigation with none.
- **DesignPanelAI register is intact.** Deep-blue textured ground, sunrise-orange airflow ribbons, an
  original shield/fan/thermometer mark, chrome "PRECISION" over orange "CLIMATE SOLUTIONS", legible at
  distance. This is the pre-migration quality, not wallpaper.
- **But it is not one continuous field.** Gemini drew the three thirds as three framed panels on a white
  sheet: a white canvas margin (rows 0–50 and 4044–4095, columns 0–52 and 4043–4095) and two white gutters
  (rows 1343–1394 and 2702–2753). Near-white is 8.38 % of the raw canvas. The continuity instrument records
  a 16 px divider at y=2730 and 84 % divider coverage at y=1365; the whole-field border reads 0 % artwork
  because the border IS the white margin. The thirds language made the model draw containers — the exact
  reading the owner flagged as the scaffolding's risk.
- **The white never reaches a trim rect.** Every band lies inside the 5″ bleed inset of the territory it
  touches. Near-white inside the trim rects: hood 0.00 %, roof 0.00 %, front 0.00 %, rear 0.00 %, driver
  1.89 % and passenger 1.83 % — and those two are the chrome lettering, since no white row or column
  intersects either flank's trim rect (y 103–1262 / 1468–2627, x 465–3629). White inside the bleed boxes:
  driver 6.9 %, passenger 5.8 %, hood 2.9 %, roof 2.9 %, front 4.3 %, rear 6.4 % — a defective bleed on the
  affected edges, not a defective print area.
- **Centre four are continuation, as predicted.** Hood carries the small restated mark (whole, inside the
  file); roof, front and rear are ribbon-and-ground texture with the gauge-ring motif. Usable continuous
  artwork; not composed statements.

## Answers to the two questions

**Primary — with all production topology removed, does Gemini return continuous printable artwork without
vehicle anatomy?** Anatomy: yes, gone. Continuous: not yet — the composition brief's thirds were drawn as
three bordered panels with white gutters and a white frame. The remaining defect is in the temporary
thirds scaffolding, not in the creative contract and not in vehicle semantics.

**Secondary — can the OS serialize the one design into six useful surfaces without destroying creative
quality?** The six files cut cleanly by geometry, hash-bound, Driver and Passenger distinct, the flanks
carrying the hero passage whole and the centre four carrying continuous supporting artwork; the trim areas
are 100 % artwork on all six. The bleed zones on the gutter-facing edges are white on this draw. Quality of
the extracted flanks is the raw master's quality, unchanged.

## What this does and does not license

Harness only. No production change, no deploy, no gate, no repair, no second draw. The thirds language is
temporary scaffolding, not approved DesignPanelAI composition architecture. Next single variable is the
owner's call; the measurement points at the composition scaffolding (containers drawn where thirds were
named), not at the creative assembly or the serializer.
