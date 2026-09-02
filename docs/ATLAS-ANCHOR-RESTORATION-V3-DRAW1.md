# A.T.L.A.S. anchor restoration v3 — printed-sheet object, zero body lines, Draw 1 (2026-09-02)

Run `33649706183` on `cbbc8943`, contract `designpro.atlas-anchor-restoration.v3`.
Harness only. ONE Gemini image request (35.0 s). No production change, no deploy.
Capture-only parity first (run `33649472819`): zero provider calls.

## What changed from v2 (run 33647927930)

Owner: "flattened as in zero body lines". v2's embodiment sentence described the
wrap as a skin "pressed flat and unfolded" (a UV unwrap), and the model unwrapped
a truck body, lines included. v3 replaces only that sentence with the RULE 0.32
object: the six rectangular printed vinyl sheets as they come off the printer
before installation; flattened means zero body lines; each region one continuous
rectangle of printed artwork running unbroken to all four edges; trimming to the
vehicle by the installer after printing. The three "skin" references in the
placement tail became "topology". Parts 1 and 3 received the same exact-match
object-schema cleanup ("surfaces" → "regions"; both negatives made positive),
each reverse-provable to the pinned deployed text. Parts 2 and 4, the six
creative swaps, model, config, `CENTER_ORDER`, GENIE, extraction: unchanged.

Prompt 4,531 chars `571cde0adce5f33d` · teaching text 465 chars `4f45d370380c7dcc`
· guide text 262 chars `3eebedb6096f9409` · guide image `7c10d6ae0a3249ef`.

## Raw master — look first

`draw1-anchor-raw.png` sha256 `2d006f494d72b3b2…`, 6,185 KB, 4096×4096.
Downscale: `docs/ab/anchor-restoration-v3-33649706183-raw-master-1600.jpg`.

## 1. Visual A.T.L.A.S. acceptance — owner judgement; harness reading below

**Moved again, in the right direction.** The production topology is followed
(two tall flank columns, four stacked centre regions, one design). The body
detail that v2 carried is gone: no door seams, no handles, no tailgate, no
grille, no windshield curve. Three of the four centre regions (ROOF, HOOD,
FRONT zones) are plain rectangles filled with artwork.

**Still wrong:**

- both flanks carry two wheel-arch notches each, cut out of an otherwise
  rectangular sheet — the last body line;
- the top centre region is drawn as a hood-shaped piece (curved outline,
  lettering upside down), so the model still assigns "hood" to the top of
  the column and shapes it, against REAR → ROOF → HOOD → FRONT;
- each region is drawn inset inside its zone rather than to the zone edge,
  so every deterministic crop carries a black border and the flanks' crops
  carry the notches;
- Passenger is a near mirror of Driver (`passengerMirrorMae 0.0045`).

Output class (record): `flat_atlas` — "multiple flat, irregularly shaped
panels of print artwork laid out on a sheet, with no vehicle". Legacy gate:
`accepted=false`, one blocking failure (`rear edgeHoleRatio 0.809`: the
hood-shaped piece floats on its surround), zero cut-outs.

## 2. Edge-to-edge — telemetry

| surface | bleed nonArt | largest field | border art | contour | bleed OK | trim nonArt | trim OK |
|---|---|---|---|---|---|---|---|
| driver | 45.6% | 10.4% | 56.3% | 0.456 | no | 46.8% | no |
| passenger | 50.5% | 10.3% | 58.2% | 0.505 | no | 51.6% | no |
| hood | 75.0% | 25.9% | 100.0% | 0.750 | no | 70.2% | no |
| roof | 42.1% | 10.9% | 100.0% | 0.421 | no | 38.4% | no |
| front | 61.1% | 28.0% | 100.0% | 0.611 | no | 65.1% | no |
| rear | 72.2% | 15.7% | 18.9% | 0.722 | no | 64.8% | no |

0/6 and 0/6. The numbers are worse than v2 because the drawn regions sit
inset inside the zones (a black margin the flood reads as non-artwork) and
because the flood's smooth-ground caveat applies to the plain blue centre
rectangles. The eye says the centre rectangles are filled; the instrument
cannot tell a smooth painted blue from a void. Telemetry does not overrule
visual evidence.

## 3. Canonical integrity — all true

Master `5b9195acd1a9f973…`, GENIE manifest hash `879291d3a9120666…`, centre
rear → roof → hood → front. Six distinct files; every `sourceMasterHash`
equals the master; method `deterministic_atlas_crop`; GENIE hash bound;
Driver ≠ Passenger by hash.

| surface | file px | native px/in | sha256 |
|---|---|---|---|
| driver | 2848×1153 | 17.47 | `a46b71059c75fe8f` |
| passenger | 2848×1153 | 17.47 | `e10fea3f8f43b446` |
| hood | 1262×1022 | 15.48 | `28e891f062435514` |
| roof | 1262×970 | 14.97 | `5f3dbac6dc7f8158` |
| front | 1262×399 | 9.07 | `372bd37f40458e31` |
| rear | 1262×939 | 14.67 | `31ec214fb8ffc619` |

Native effective PPI only. No 150 / 300 / 1500 claim.

## Reading

Three draws, three single-variable steps, three monotone moves: v1 body
pieces on Gemini's own layout → v2 the production topology with body pieces
inside → v3 the production topology with rectangles inside, and wheel-arch
notches as the last surviving body line. Every remaining defect is on the
flanks and the top centre region, which are the regions the prompt still
names as vehicle parts ("driver side", "passenger side", "hood"). No
model-facing text now says panel, surface, skin or body. The remaining
model-facing inputs that could still teach the notch are the region names
(RULE 0.0 requires them; owner's call), the labeled Flamingo proof's six
labels, and the flank proportions themselves. Recorded, not acted on. STOP
for owner review.

Evidence: `docs/ab/anchor-restoration-v3-33649706183-*`; full-resolution
images in the run artifact (90 days).
