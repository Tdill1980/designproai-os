# Phase 1B — one field, six GENIE windows, offline

Proves the smallest fix for the one unresolved Call-1 problem: **the boundaries
Gemini draws do not land where GENIE's boundaries are.**

The model is not asked for better boundaries (Test 13 proved exact proportions
in words move nothing) and not asked six times. It is not asked for boundaries
at all. It paints ONE oversized continuous field; GENIE takes six windows out of
it by arithmetic.

    node compile.mjs        # field -> windows -> A.T.L.A.S. -> panels, prints every operation
    node verify.mjs         # 11 acceptance gates, writes out/receipt.json
    node determinism.mjs    # one clean-process compile, hashes as JSON
    node contact-sheet.mjs  # out/contact-sheet.png

No provider call, no database, no deployment, nothing wired into the product
path. `runtime/` is unchanged — the compiler *uses* `buildAtlasManifest`,
`buildFieldTerritories`, `cutCallOnePanels` and `opentype-outline` as they are.

## Why cropping is safe here

The field is authored as overscan and carries **no company name, phone number,
website or logo** — so there is nothing in it a crop can clip. Protected content
is composited afterwards, by code, at exact size. Cropping artwork drawn to be
cropped is not the operation that clipped Test 13's logos.

## What is never done

No non-uniform stretch, no `fit:"fill"`, no remap, inpaint, clone, wheel-well
fill or generated fill. The field is not resized, the windows are not resized,
type is not scaled, and panels are not resized: between the authored field and
the finished panel **not one pixel is resampled**. The only scale in the whole
compiler is the approved logo fitted to its box with `fit:"inside"` — uniform by
definition, and asserted afterwards.

## Scope

Preview resolution only (flanks 20.68 PPI, centre 12.65). No 150-PPI rendering,
no obstruction database, no new lineage semantics, no production integration.
`masterContentHash` and `sourceMasterHash` keep their existing meaning: the
constructed flattened A.T.L.A.S. bytes.

## The fixture's artwork is not the point

The frozen field is deterministic vector ribbons so two runs are byte-identical.
It is visually plainer than the real one-call Gemini field, and hood/roof/front
read as near-empty in the contact sheet. That is a property of the fixture, not
of the mechanism — the real field supplies the creative quality, and this proof
supplies the geometry.
