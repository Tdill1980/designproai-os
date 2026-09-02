# A.T.L.A.S. ONE-FIELD CALL 1 — v24 (owner ruling 2026-09-02, unfrozen 20:30Z)

Owner, after the live v23 generation `84a3eadf…` came back with wheel arches
and body lines painted into both flanks and an inverted rear: **"UNFREEZE GET
ME A WORKING OS."**

This is the production port of Field Recovery v2 (`scripts/atlas-field-*`,
harness draw 33659500846), the only Call-1 configuration that has produced
clean, continuous, anatomy-free flanks on this product.

## The contract

Gemini authors **ONE uninterrupted full-bleed vehicle-wrap composition** on the
square 4K canvas. The model receives **one text part plus verified customer
references, and nothing else**:

| removed from the model request | why |
|---|---|
| the six-region neutral guide image | a blank container sheet reads as content to interpret |
| the labeled Flamingo teaching sheet | a six-pane sheet teaches six panes |
| the normalized `[0,1]` topology text | production math, never model input |
| six named production objects, panel/artboard/template framing | object schema the model draws as objects |
| wheel / window / body-piece negatives | a negative makes the model over-index on the forbidden thing |

The creative assembly is the same `buildDesignIQPrompt` commercial/restyle
brain, byte for byte, except seven exact presentation phrases that named
panel/rectangle objects — swapped for their field wording (`atlasField` branch
in `design-panel-ai-generate/index.ts`). The tail is `atlasFieldContract()`:
one continuous field, composed in three equal horizontal thirds, hero passage
in the upper third, second hero passage in the middle third, supporting
register in the lower third, lettering left to right, nose edges from the OS.

**Byte identity, proven:** for the Draw-1 fixture the edge assembly emits the
exact prompt the harness drew with — 4,052 chars, SHA-256
`37e4137e8ae8c8bb4284080fe15c159479447f754cd7b6fa09c734b9b3e9dae5` — and the
legacy six-container branch still emits the deployed v23 pin
`dcb73e9eae229cd8…` (4,587 chars). Locked by `tests/atlas-one-field-call1.test.mjs`.

## GENIE owns the territories; the model never sees them

`runtime/atlas-field-territories.cjs` (`field-thirds-v2`,
`designpro.atlas-field-territories.v2`) takes the production
`buildAtlasManifest` layout — inches, square feet, bleed, proof dependencies,
guide fills all lifted, never re-derived — and replaces only the geometry:

| surface | placement | territory (x, y, w, h) on 4096² | native px/in (F250 fixture) |
|---|---|---|---|
| driver | third 1, centred | (362, 0, 3371, 1365) | 20.68 |
| passenger | third 2, centred | (362, 1365, 3371, 1365) | 20.68 |
| roof · hood · front | third 3, row 1, abreast | (120/1186/2217, 2730, …) | 12.65 |
| rear | third 3, row 2, under the shortest | (2217, 3287, 1088, 809) | 12.64 |

Rotation 0 everywhere, so the flank files come out landscape as installed.
Passenger is its own territory — never mirrored Driver bytes. 76.3% of the
canvas is extracted; the painted remainder is discarded by the zone mask (a
resolution cost, reported on the revision as `metadata.fieldLayout`).

Everything downstream is unchanged and reads the same zone shape:
`normalizeAtlasMaster` (mask), `deterministicMasterChecks`, `fillMasterCutouts`,
`cutCallOnePanels` (`zone.extraction`), `buildViewAuthorities`, the human
installer map (`renderAtlasGuide`), Call 8, Call 9, Call 11, PanelPro.

## What the runtime sends and verifies

`atlasEdgeRequestBody` now carries `fieldContract:
"designpro.atlas-field-prompt.v2"` and `noseEdge` (from the installer map) and
no teaching/guide keys. `callAtlasArtboardEdge` refuses a response that does
not echo the contract (`flat_atlas_edge_field_contract_mismatch`) or that
carries more model-input images than the verified customer references
(`flat_atlas_edge_structural_image_detected`).

Versions: runtime `designpro-flat-first-atlas-20260902.v24-one-field`, edge
`atlas-artboard-designiq.20260902.v24-one-field`. Older masters are refused for
new authoring only; every historical generation stays readable.

## Gates unchanged

RULE 0.30's output-class gate, the deterministic structural checks, the cut-out
fill and post-repair re-validation, the accepted-master promotion and the
one-image-request contract all run exactly as before. They decide whether a
candidate may become canonical; they do not touch the conditioning.

## Known from Draw 1, to judge on the first product generation

Draw 1 answered the primary question (no vehicle anatomy, creative register
intact) and left one defect in the scaffolding: the thirds were drawn as three
framed passages with narrow white margins, all of which landed inside the 5"
bleed insets — trim rectangles were clean. The owner has ruled the thirds
language is temporary harness scaffolding, not the permanent DesignPanelAI
composition architecture. It ships because it is the only measured
configuration that works; it is the next creative variable, not a settled one.
