# A.T.L.A.S. anchor restoration v2 — object-schema cleanup, Draw 1 (2026-09-02)

Run `33647927930` on `5e867fff`, contract `designpro.atlas-anchor-restoration.v2`.
Harness only. ONE Gemini image request (42.8 s). No production change, no deploy.
Capture-only parity first (run `33647693646`): zero provider calls.

## What changed from v1 (run 33642303437)

Owner finding after v1: the object-first anchor sat at the END of Part 0, after a
creative assembly whose third line had already defined the object as "flat
orthographic panels" with texture "flowing across the panels". The earlier
instruction won and Gemini drew body-piece mockups on its own layout.

v2 Part 0 = persona (deployed L1) · the owner's object definition · the deployed
creative assembly with exactly six exact-match object-schema swaps · placement
tail. Reverse proof true: undoing the swaps and removing the block reproduces the
deployed creative byte for byte (2,622 chars, `7e011c6c20b5fa29`). Prompt 4,293
chars, `8014a3665f40bd24`. Parts 1–4, model, config, `CENTER_ORDER`, GENIE guide
(`7c10d6ae0a3249ef`), extraction and every downstream contract unchanged.

| swap | from | to |
|---|---|---|
| 1 | flat orthographic panels of pure printed vinyl artwork | the flattened A.T.L.A.S. design topology of pure printed vinyl artwork |
| 2 | background color and texture flowing across the panels | … flowing continuously across the flattened A.T.L.A.S. design topology |
| 3 | rather than flat shapes on bare panel | rather than flat shapes on bare vinyl |
| 4 | The vinyl finish is gloss across every panel — consistent finish on every surface. | … across the whole flattened A.T.L.A.S. design topology — one consistent finish throughout. |
| 5 | The artwork fills every rectangle edge to edge | The artwork fills every topology region edge to edge |
| 6 | angular faceted panels with sharp swept edges | angular faceted plates with sharp swept edges |

## Raw master — look first

`draw1-anchor-raw.png` sha256 `12d56375ff91d437…`, 7,023 KB, delivered 4096×4096.
Downscale: `docs/ab/anchor-restoration-v2-33647927930-raw-master-1600.jpg`.

## 1. Visual A.T.L.A.S. acceptance — owner judgement; harness reading below

**What changed, and it is real:** for the first time in this investigation the
model followed the production topology. Two tall flank columns, left and right,
in the exact zone positions; four centre regions stacked in the centre column;
one cohesive Precision Climate Solutions design across all six; no floating
layout of Gemini's own. The neutral guide governed placement in this draw.

**What is still wrong — the object class:**

- both flanks are die-cut vehicle side profiles: wheel arches cut out top and
  bottom, door seams, door handles, a cab/bed step line, on a black surround.
  They are body pieces, not rectangular printed media;
- the centre regions carry body anatomy: a windshield-curve block in the REAR
  zone, a tailgate with handle and bed-rail seams in the HOOD zone, a grille in
  the FRONT zone — and the model's own centre assignment does not match
  REAR → ROOF → HOOD → FRONT;
- Passenger reads as a near mirror of Driver (`passengerMirrorMae 0.0046`),
  the lettering re-set forward but the composition mirrored;
- every region sits inside a black separation field rather than filling its
  rectangle.

Output class (record): `flat_atlas` — "multiple flat 2D print artwork panels
with vehicle-specific cutouts laid out on a sheet". The legacy deterministic
gate reported `accepted=false` with zero blocking failures and zero cut-outs.

## 2. Edge-to-edge — telemetry (agrees with the eye this time)

| surface | bleed nonArt | largest field | border art | contour | bleed OK | trim nonArt | trim OK |
|---|---|---|---|---|---|---|---|
| driver | 37.5% | 4.8% | 68.2% | 0.375 | no | 35.9% | no |
| passenger | 37.2% | 4.8% | 66.9% | 0.372 | no | 37.3% | no |
| hood | 44.5% | 10.4% | 100.0% | 0.445 | no | 44.4% | no |
| roof | 49.2% | 8.4% | 100.0% | 0.492 | no | 47.6% | no |
| front | 35.0% | 5.3% | 87.2% | 0.350 | no | 33.1% | no |
| rear | 27.3% | 8.6% | 100.0% | 0.273 | no | 25.5% | no |

0/6 bleed rects, 0/6 trim rects. v1 was 0/6 with contours 0.24–0.52 and
largest fields 8–34%; v2 largest fields are 5–10%, the black surround and the
cut-out arches.

## 3. Canonical integrity — all true

Master `0c5a8a0d582d7c04…`, GENIE manifest hash `879291d3a9120666…` (measured),
centre rear → roof → hood → front. Six distinct files; every `sourceMasterHash`
equals the master; method `deterministic_atlas_crop`, deterministic, GENIE hash
bound; Driver ≠ Passenger by hash.

| surface | zone (x, y, w, h) rot | print in | file px | native px/in | sha256 |
|---|---|---|---|---|---|
| driver | (2751, 624, 1153, 2848) −90° | 163×66 | 2848×1153 | 17.47 | `b2d53d100100542f` |
| passenger | (192, 624, 1153, 2848) 90° | 163×66 | 2848×1153 | 17.47 | `01798c94354f9660` |
| hood | (1417, 2310, 1262, 1022) 0° | 81.5×66 | 1262×1022 | 15.48 | `be14fb0f660c7d0d` |
| roof | (1417, 1304, 1262, 970) 0° | 84.3×64.8 | 1262×970 | 14.97 | `f61e03305685798b` |
| front | (1417, 3368, 1262, 399) 0° | 139×44 | 1262×399 | 9.07 | `b960719b4cbd0cb9` |
| rear | (1417, 329, 1262, 939) 0° | 86×64 | 1262×939 | 14.67 | `63e591439093e436` |

Native effective PPI only. No 150 / 300 / 1500 claim.

## Reading

The object-schema cleanup moved the layout from "Gemini's own arrangement of
body pieces" (v1) to "the production topology, in the right places, one
design" (v2). That is the guide and the placement paragraph finally governing.
The remaining defect is the object class of each region: the model still
renders a vehicle body piece inside each rectangle instead of printed media
filling it. No model-facing text in Part 0 now says "panel"; the remaining
model-facing inputs that describe or show body pieces are the labeled Flamingo
teaching proof (part 2, whose six blocks are labeled vehicle surfaces on a
separation field), its teaching text (part 1: "six flat A.T.L.A.S. surfaces …
separation space between artwork regions"), and the guide text (part 3: "flat
printable rectangles only; never return a vehicle image"). Recorded, not acted
on. STOP for owner review.

Evidence: `docs/ab/anchor-restoration-v2-33647927930-*`; full-resolution
images in the run artifact (90 days).
