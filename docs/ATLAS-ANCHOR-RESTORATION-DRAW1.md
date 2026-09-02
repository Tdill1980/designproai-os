# A.T.L.A.S. anchor restoration — Draw 1 (run 33642303437, 2026-09-02)

Owner-approved, option A, exactly ONE Gemini image call. Harness only; nothing
under `runtime/`, `supabase/`, `app/`, `web/`, `gateway/` or `ops/` changed.
Full evidence: `docs/ab/anchor-restoration-33642303437-*`; images in the run
artifact `atlas-teaching-proof-ab-33642303437` (90-day retention).

## The question

> Does giving Gemini the correct conceptual definition of the object — while
> retaining the known-good A.T.L.A.S. example and GENIE geometry — make it fill
> the existing flattened topology correctly again?

## The request (capture-only run 33642018229 proved parity before the draw)

| part | content | status |
|---|---|---|
| 0 creative assembly | 2,622 chars `7e011c6c20b5fa29` | byte-identical to deployed v23 |
| 0 output tail | 1,965 → **1,574** chars `655632686d7e76c1` → **`352498f8b2c7714c`** | the ONLY change: the owner's object-first anchor |
| 1 teaching text | `6f92d8ae60d392a5` | unchanged |
| 2 Flamingo labeled proof | `684534d27f8e7d70…` | unchanged |
| 3 guide text | `a93e2c7a16fea22a` | unchanged |
| 4 neutral guide, production `CENTER_ORDER` rear → roof → hood → front | `7c10d6ae0a3249ef` | unchanged |

Model `gemini-3-pro-image`, `["TEXT","IMAGE"]`, `1:1`, `4K`, no temperature.
Five parts, two images, 4,761,699 bytes (deployed 4,762,109). One image request.

## Result — the answer is NO

Raw master `4ec49cc542434758…`, 4096×4096, 42.0 s.

**1. Visual A.T.L.A.S. acceptance: FAIL.** The image is a vehicle-body-piece
mockup, not a flattened printable skin: two truck side elevations with cab
silhouette, window openings, door seams and wheel arches cut through; a hood,
a roof and a tailgate drawn as shaped body pieces; all floating on a grey
separation field. The model also ignored the neutral guide's geometry: both
flanks are drawn horizontally across the top of the canvas instead of as the
two tall columns the guide places at left and right. The wrap design itself
(brand lockup, orange airflow ribbons on deep blue) is cohesive and
professional — the design brain is fine; the object it drew is wrong.

**2. Edge-to-edge: 0/6 on bleed rects and 0/6 on trim rects.** This time the
flood instrument and the eye agree: the non-artwork is genuinely the grey
field, not a smooth painted ground.

| surface | bleed nonArt | largest field | border art | contour |
|---|---|---|---|---|
| driver | 51.6% | 33.9% | 41.8% | 0.516 |
| passenger | 35.8% | 20.1% | 54.8% | 0.358 |
| hood | 36.0% | 31.0% | 66.8% | 0.360 |
| roof | 38.0% | 25.5% | 41.8% | 0.380 |
| front | 51.8% | 8.2% | 43.4% | 0.487 |
| rear | 24.7% | 10.4% | 45.1% | 0.244 |

**3. Canonical integrity: all true.** Six distinct files, every
`sourceMasterHash` equal to the master `032f31ee0bad0599…`, GENIE manifest
hash `879291d3a9120666…` bound on every panel, method
`deterministic_atlas_crop`, Driver ≠ Passenger (mirror MAE 0.0698). The
extractor did its job exactly, and faithfully cut six pieces of a mockup.

For the record: output class `vehicle_depiction` ("a mockup of vehicle body
parts with applied graphics, showing body contours and multiple views");
legacy deterministic gate `accepted=true, blocking=0, cutouts=0` — the
structural gates would have accepted this master.

## What this establishes

- The conceptual definition of the object, delivered as the output tail while
  the creative assembly, the labeled example and the neutral guide are held
  fixed, does not by itself change the output class. The model still reads
  the request as "draw the vehicle's body pieces with the graphics on them".
- The neutral guide did not govern placement in this draw at all (flanks drawn
  horizontal, centre pieces re-arranged), so the guide is not currently the
  layout authority the request treats it as.
- The creative assembly held byte-identical by owner instruction still
  contains the words "flat orthographic panels" and "flowing across the
  panels"; those were outside this draw's scope and are recorded here only as
  the remaining untested text in part 0.

STOP. No repeatability run, no production change, no deploy. Owner review.
