# A.T.L.A.S. authored-topology correction — 2026-09-06

Trish rejected generation `a503b91b-65f3-4f30-ab31-5615f7db3cca` visually and
requested this fix. Baseline: `73c7a2aa402731fb9fe835922a3c3eda6b252c71`.

## Measured defect

PR #305 (`3765325c`) selected the three-register prompt and introduced
`atlas-field-compose.cjs`. Its BAND_INDEX maps hood, roof, front and rear to
the same lower source band. Sharp cover-resizes that band into four different
rectangles. A single image request therefore did not mean the six-surface
A.T.L.A.S. had been authored together. This explains the repeated center art.
The field prompt also asks for the second hero passage to be composed afresh.

## Correction

Reverse only #305's authoring/composition changes, retaining all subsequent
production and WrapBox fixes. The existing edge six-surface branch receives
the pinned original Flamingo teaching image and the GENIE-derived neutral
six-surface guide. It authors the whole topology; the runtime normalizes that
sheet and extracts the matching regions, with no band reuse or repair.

Runtime version: `designpro-flat-first-atlas-20260906.v28-authored-topology`.
Edge remains `atlas-artboard-designiq.20260906.v25-rectangular-media`; no edge
source or prompt wording changes. The restored specification fixture remains
4,443 characters, SHA-256
`bae1d8c4541d4923d422b68c5368f7019e8c55e319947fca8ac58f396a5a8eed`.

The runtime additionally refuses a six-surface response carrying a field
contract, wrong/missing teaching identity, wrong prompt version or wrong
image-input count. This closes the previously asymmetric response check.

GENIE geometry, rotations, 5-inch bleed, master checks, Call 8, production QC,
Topaz, ZIP, WrapBox and historical generation reads are unchanged. PR #301 is
not incorporated. The previous field-composed generation is not rewritten.

## Verification and remaining acceptance

`tests/atlas-authored-topology.test.mjs` executes the actual authoring function
with a local provider stub: six distinct source patterns survive normalization,
canonical storage and the real panel cutter pixel-for-pixel. Every panel has
its canonical source hash, original dimensions and 5 inches on each edge.
Transport tests reject stale/field/missing-reference responses before download.
These tests establish routing and pixel preservation, not creative quality.

Earlier six-surface candidates failed anatomy/full-bleed checks. Restoring the
path does not erase that history or prove a future draw will pass. No gate is
relaxed. A fresh real master and all six panels must be inspected before any
creative-success claim. A populated ZIP or WrapBox record is not visual approval.
