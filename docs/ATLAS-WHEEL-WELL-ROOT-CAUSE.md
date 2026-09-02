# The black wheel wells are still in the accepted master, and nothing in production can see them

Owner requirement: **never see black wheel wells.**

Measured read-only on the stored canonical master for GenerationID
`5d727ea9-eb71-466b-8a04-dca2d8d411e7` (2019 Porsche 911 Turbo, galaxy/Tron
brief), run [33583056258](https://github.com/Tdill1980/designproai-os/actions/runs/33583056258).
Zero provider calls. Bytes hash-verified against the revision row
(`2165a36c7f52738b…`, 28,281,145 bytes).

## What the receipts say, and what the bytes say

| | driver | passenger |
|---|---|---|
| pre-repair hole (gate) | 8.02% of zone, 1 component | 7.73%, 1 component |
| `cutoutFillApplied` claim | 303,861 px, 1 component, **`unresolvedPixels: 0`** | 300,443 px, 1 component, **`unresolvedPixels: 0`** |
| near-black surviving, gate's predicate | **22 px** | **25 px** |
| **uniform non-artwork field surviving, colour-blind** | **7.55% of zone** | **7.80% of zone** |

The disc was never removed. It is still there, the same size, and it is still
visually black. What changed is its colour by a hair.

## The mechanism

`FLAT_BLACK_CHANNEL_MAX = 24`. The filled disc measures about **rgb(25, 19, 23)**.

`fillMasterCutouts` closes a hole by repeatedly averaging its boundary pixels
inward. Across a ~620 px disc in deep-space artwork that cannot reconstruct
detail — it converges to a flat, very dark region. That region lands **one value
on one channel** above the near-black predicate.

Every check downstream keys on `holeAt`, which is *near-black or transparent*.
So after the fill:

- the cut-out detector sees 22 px instead of 303,861 and reports the surface clean;
- `edgeHoleRatio` reads ~0;
- post-repair re-validation passes;
- the repaired sheet is promoted to canonical;
- the six panels are cut from it and the proofs are conditioned on it.

The fill did not fail loudly. It recoloured the defect out of the only predicate
that was watching.

## Why this went unnoticed for so long

`opaqueRatio` was 1.00000, `masterQcPassed` was `true`, `unresolvedPixels` was 0,
and the output-class gate returned `flat_atlas` at confidence 1.0 with the words
*"multiple rectangular panels of flat 2D print artwork… with no vehicle body
depicted."* Every instrument in the stack agreed the sheet was clean. All of them
are colour-thresholded, and the defect is no longer the threshold colour.

**My own measurement reproduced the same blind spot on its first pass** — judged
by the gate's predicate it printed "repair EFFECTIVE" on both flanks. The verdict
is now colour-blind: it asks whether the region is artwork, not whether it is
black.

## The chain, end to end

1. Call 1 paints a wheel-well disc into both flanks. *(authoring defect — still unsolved, and the four isolated variables tested so far are not its cause)*
2. The gate convicts it as a cut-out, which is non-blocking by RULE 0.15's design.
3. `fillMasterCutouts` averages inward across ~620 px and produces a flat near-black field.
4. That field sits just outside `FLAT_BLACK_CHANNEL_MAX`, so nothing flags it.
5. It becomes the accepted canonical master, the six production panels, and the seven proofs.

Step 3 is where "never see black wheel wells" is broken, and steps 2 and 4 are
why nobody was told.

## Proposed, not implemented — owner approval required

**A. Post-repair validation must be colour-blind.** Verify the repair with "is
this region artwork", not "is this region black". A fill that leaves a uniform
field of any colour has not repaired anything and must not be promoted.

**B. Boundary-averaging is the wrong algorithm for a large interior disc.** It is
built for a wheel arch biting the edge of a panel, where the fill grows in from
three sides over tens of pixels. At 620 px across it cannot produce artwork, and
should not claim to. Above a size threshold the honest options are a re-roll
inside the existing bounded attempt budget, or a refusal — not a fill.

Neither is a creative-prompt change, a teaching-proof change, a topology change,
an extraction change or a threshold relaxation. Both are in the repair and
acceptance path.

**C. The authoring defect remains open.** A and B stop a black disc reaching a
customer. They do not stop Call 1 drawing one.
