# Test 16 — the masked generative fill on the flat panel (run `34572204752`, 2026-09-11)

Owner directive (Trish, 2026-09-11): *"Do not reverse the August 29 ruling.
We are committed to the Flat-Panel-First ATLAS architecture ... Treat the
wheel-well gaps as an automated post-process step: use an Edge Function to
apply a secondary generative fill/inpaint mask over the cutouts using the
flank's latent style, extending the graphic bleed so installer panels never
have missing territory. Let's fix the fill step on the flat master, not fall
back to 3D proof transcriptions."*

This is that step, measured once on the owner's own example: the 911
Cyberspace master (generation `5d727ea9`, accepted master `2165a36c…`),
whose Driver and Passenger panels each carry one black wheel disc.
Harness: `scripts/atlas-panel-fill-ab.mjs`, workflow test `16-panel-fill`.
Nothing in production changed.

## 1. What was run

| step | what |
|---|---|
| subject | the PRE-fill panel, rebuilt from the edge's stored raw Call-1 candidate `atlas-call1/c9cf6d59-….png` exactly as production cuts it (normalize → `zone.extraction` → rotation). The normalized sheet hashes to the revision's own `preRepairMasterHash` `71c35796…` (MATCH), so the subject is byte-identical to what the fill step would receive |
| mask | the gate's own predicate (`convictedHoleMask`, the criteria the cut-out finding uses), dilated 24 px. Driver: 1 component, 8.06% of the panel. Passenger: 1 component, 7.97% |
| request | ONE edit turn to `gemini-3-pro-image`: subject PNG + mask PNG + the whole master downscaled to 1024 as visual-DNA reference + the text in `docs/ab/panel-fill-34572204752-prompt-fill.txt` (no vehicle noun; WHITE = the only area to paint). `imageSize: 4K`, no aspect ratio, as the finishing handler sends it |
| composite | in code: the model's pixels are kept ONLY inside the mask (10 px feather); everything outside is the subject byte for byte. Drift = mean abs RGB difference between the model's raw return and the subject, outside the mask |
| gate | `deterministicMasterChecks` on the composite (single-zone manifest) plus the colour-blind non-artwork measure, beside the deterministic fill of the same panel |

Two draws per flank, four image calls, 39–44 s each.

## 2. Result

| surface | candidate | deterministic gate | colour-blind non-artwork | drift outside mask | what it looks like |
|---|---|---|---|---|---|
| driver | pre-fill original | REFUSE · 3 cut-out findings · largest 8.0% | 11.47% | | black disc |
| driver | deterministic fill (what production shipped) | pass | 11.18% | | the same disc, one value lighter |
| driver | masked AI fill 1 | pass · 0 cut-out | **3.39%** | 10.7 | grid, circuit lines and starfield continue through the disc; a faint darker "lens" tint remains over the fill region |
| driver | masked AI fill 2 | pass · 0 cut-out | **3.39%** | 10.6 | same, with the circuit trace completed differently |
| passenger | pre-fill original | REFUSE · 3 · largest 7.7% | 8.05% | | black disc |
| passenger | deterministic fill | pass | 7.96% | | near-black disc |
| passenger | masked AI fill 1 | pass · 0 cut-out | **0.00%** | 14.1 | grid and traces continue through; faint lens tint |
| passenger | masked AI fill 2 | pass · 0 cut-out | 1.23% | **64.3** | the model returned the WHOLE six-panel A.T.L.A.S. at 4096×4096 (it reproduced the reference); the composite pasted a shrunk sheet into the disc. **The deterministic gate passed it.** |

Previews: `docs/ab/panel-fill-34572204752-{driver,passenger}-*.jpg`; the
disc region side by side (original / fill 1 / fill 2):
`docs/ab/panel-fill-34572204752-{driver,passenger}-zoom-original-fill1-fill2.jpg`.
Full results: `docs/ab/panel-fill-34572204752-results.json`.

## 3. Reading

1. **The owner's step works, 3 of 4.** With the region masked and the master
   as visual DNA, the model continues the flank's own artwork through the
   opening: same grid, same circuit traces, same starfield. The colour-blind
   non-artwork share drops from 11.5% / 8.1% to 3.4% / 0.0%. The
   deterministic fill, which is what production shipped on this generation,
   left the disc at 11.2% / 8.0%: it never repaired anything, it only moved
   the pixels one value outside the near-black predicate (RULE 0.32).
2. **A ghost of the disc survives as a darker tint.** On all three good fills
   the filled region reads slightly darker than its surround, with a soft
   ring at the boundary. That is a print defect at a much smaller scale than
   a black disc, but it is visible. Two candidate causes, both testable in
   one more run: the model sees a black disc in the subject and keeps some
   of it (send the deterministic-fill result as the subject instead, so the
   input carries no black), and the 10 px feather is too tight for a 690 px
   opening (feather 40–60 px). A deterministic boundary-ring luminance match
   inside the mask is a third option and needs no image call.
3. **The gate cannot see a wrong fill. The fill step needs two deterministic
   refusals of its own.** Passenger fill 2 returned a different image at a
   different shape and the composite still passed every existing gate, because
   the gates ask "is there a hole" and there was not. Both signals were
   already measured by the harness and both are code-only: a return whose
   pixel dimensions or aspect differ from the subject is refused before any
   composite (the finishing handler already rejects a dimension mismatch),
   and drift outside the mask above a threshold (the three good fills sit at
   10–14; the bad one at 64) is refused as "the model redrew the sheet".
   Neither is a re-roll: a refused fill retains the deterministic crop and is
   flagged for PanelPro exactly as today.
4. **Where this sits in the architecture.** The step is the finishing
   handler's shape (`handleAtlasPanel`: subject → A.T.L.A.S. reference →
   siblings, exact exchanges with thought signatures kept server-side,
   private storage, resume) plus ONE new part, the mask, and a compositor
   that trusts the model only inside it. The 09-09 finishing refusals were
   whole-sheet, maskless regenerations; the mask is the difference.

## 4. What this does not prove

One generation, two flanks, four calls. It does not measure the six-surface
cascade, the centre surfaces, a light-coloured wrap, a cut-out that crosses
lettering, or the ghost-tint fix. No production path changed and no gate was
relaxed. The 2026-08-29 ruling is untouched: every pixel here descends from
the Call-1 master, never from a 3D proof.
