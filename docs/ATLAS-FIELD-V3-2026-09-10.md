# One-field Call 1, tail v3 — review, rewrite and draws (2026-09-10)

Owner instruction (Trish, 2026-09-10): review the ten code locations in
`docs/NEXT-SESSION-ATLAS-REGRESSIONS-2026-09-10.md` §3 as evidence; rewrite
`atlasFieldContract` as `designpro.atlas-field-prompt.v3`; draw it four times on
the stored New Aura brief before any deploy; stop there for her review.

Nothing here is a live acceptance receipt. Every claim carries its file:line,
run id or storage path. Line numbers are on branch
`claude/atlas-regressions-fix-ikytc4` at the commit named in §4.

---

## 1. Review of the ten locations (step 1)

Lines are read on this branch AFTER the v3 rewrite where the location changed;
the "before" state is quoted from main `6764233`.

| # | location | finding |
|---|---|---|
| 1 | `supabase/functions/design-panel-ai-generate/index.ts:585` `atlasFieldContract` (main) | **Confirmed leak.** Lines 596–611 mapped `panels[].normalized` to six `x0 y0 x1 y1` rows at four decimals, sorted by position, and line 621 spread them into the prompt. Line 627 carried "every letter, word, mark and focal subject sits wholly inside a single area and well clear of its four edges". RULE 0.33 says the model is shown no normalized `[0,1]` text; this function was that text as prose. Rewritten (§2); now `index.ts:575`. |
| 2 | `index.ts:740–1011`, `:1135–1152` `buildDesignIQPrompt` | **Branches are clean; one creative-assembly sentence is worth knowing about.** Commercial: `atlasField` at `:958` and `atlasFlatMaster` at `:963` each `return`; restyle: `:1099` / `:1104`. Every else-branch is untouched — the deployed v23 pin still hashes `dcb73e9e…` (4,587 chars) and Draw 1's head reassembles byte for byte, both locked. The only pre-tail sentence that positions the photo is `PHOTO_REALISM_LOCK` at `:297`: "occupying its own area of the wrap". It fires for any brief containing "photo" (`briefWantsPhoto`, `:279`) and is the v19 creative assembly, so it was NOT changed (RULE 0.1). If the v3 draws still box the facial photo into a corner, this line is the next single variable, and it is an owner call. |
| 3 | `index.ts:454` `atlasFlatMasterContract` (now `:462`) | **Unchanged, by instruction.** It names six rectangles and their placement (`:499–501`) and "the complete flattened panel layout of the vehicle" (`:504`). Together with the labeled teaching sheet (`:2545`) and the guide (`:2570`) this is the configuration every canary since 08-31 drew a vehicle on. No negatives added, nothing edited. |
| 4 | `index.ts:2414` `handleAtlasArtboard` (now `:2377`) | **Correct.** Unknown contract refused before any work (`:2397`); field branch pushes prompt then customer references only (`:2535–2536`), no `downloadPart`, no teaching text, no guide; six-surface order is prompt → teaching text → teaching proof → references → guide text → guide (`:2483`, `:2545`, `:2562`, `:2570`). `noseEdge` is still validated (`:2405`) and, since v3, no longer passed into the prompt builder. |
| 5 | `runtime/flat-first-atlas.cjs:1610–1670` `atlasEdgeRequestBody` (now `:1611`) | **Every field the New Aura request carried reaches the edge.** `companyName` (`:1627`), `finish` (`:1626`), `prompt` = brief + optional colors/style/style-DNA lines (`:1616–1621`), `phone`/`website`/`textLayerPrompt`/`mascot`/`industryType`/`bulletPoints` (`:1628–1633`), vehicle four (`:1634–1637`), `visionboard_intent`, `panels[].normalized`. Read back from the live row (`designpro_generation_requests`, generation `664d054d-…`): brief, `companyName: New Aura Day Spa`, `designName`, `finish: Gloss`, `mode: commercial`, vehicle `{2021, llamborghini, Urus, suv}`, `industry`/`colors`/`style` null. `designName` has no edge field and never has. Nothing is dropped. |
| 6 | `flat-first-atlas.cjs:2726–2760`, `:2985–3010` | **Routing as documented, review only.** Six-surface manifest built at `:2727`; field manifest from the same six-surface manifest via `fieldManifestFrom` (`:2736`); `failoverEnabled` gated on `DESIGNPRO_ATLAS_FIELD_FAILOVER !== "off"` (`:2745`); `failOverToField` re-enters `generateOrReuseFlatAtlas` with `authoringTopology: "field"` and `maxAuthoringAttempts: 1` (`:2747`); attemptKey `master:field:N` (`:3002`). Deployed-verified by PR #351; not touched. |
| 7 | `runtime/atlas-field-territories.cjs` | **The driver territory starts at the canvas edge, so any margin the model leaves lands inside the driver panel.** For the Urus-shaped manifest the territories are driver y 0→1365 (trim 95→1270), passenger y 1365→2730 (trim 1460→2635), centre row y 2730→3593, rear y 3305→4096; x 57→4038 on both flanks (trim 152→3943). `fieldTrimRectangle` (`:56`) insets 5″ of bleed, ~95 px on a 62″-tall flank. F1's margin at y≈0.04 (≈164 px) sits past the trim inset, so it prints. This is a property of full-bleed cutting, not a defect of the cutter: the only cure is a raw canvas whose edge IS artwork, which is what v3 asks for. No change made. |
| 8 | `runtime/atlas-output-class.cjs:71` `outputClassPrompt` | **Does not name the two v2 defects.** It names vehicle shapes, plain surrounds and printed panel captions (`:79`); painted numerals/axis ticks and a uniform margin/mount around the whole print are not in either class definition, which is why 8/8 v2 draws answered `flat_atlas`. Step 4 work, not started (owner stop before step 4). |
| 9 | `runtime/atlas-master-qc.cjs` | **No colour-agnostic border measure exists.** `zonePixelMetrics` (`:310`) measures opacity, luma std-dev (`MIN_ZONE_LUMA_STDDEV = 6`, `:22`), near-black holes (`FLAT_BLACK_CHANNEL_MAX = 24`), edge-hole ratio and the template-frame signature; a pale gutter or grey mount is none of those. The harness added in this branch records a whole-canvas border-ring measurement (luma std-dev and near-median share over the outer 2%) on every v3 draw so a gate can be built on measured fixtures. Step 4 work, not started. |
| 10 | the five lock suites | Moved to the v3 ruling, never weakened: `tests/atlas-one-field-call1.test.mjs`, `tests/atlas-clean-authoring-contract.test.mjs`, `tests/atlas-artboard-edge-call1.test.mjs`, `tests/atlas-authored-topology.test.mjs`, `tests/atlas-authoring-recovery.test.mjs`. 118/118 across the twelve A.T.L.A.S. suites; the whole `tests/*.test.mjs` run is 993 pass / 7 fail, and the 7 are `tests/atlas-proof-presentation-branch.test.mjs` failing on a missing `app/node_modules/.bin/esbuild` in the container — identical without these changes. |

---

## 2. The v3 tail (step 2)

`designpro.atlas-field-prompt.v3`, `index.ts:575`. Edge pin `index.ts:74`,
runtime pin `runtime/flat-first-atlas.cjs:97`. The edge refuses any other
contract string (`atlas_artboard_field_contract_unknown`), so a runtime/edge
skew fails closed in both directions instead of authoring on either tail.

Removed from v2: the six fraction rows, "The square is one picture. These
areas of it, written as fractions …", "Every one of those areas …", "They are
not separate pictures …", "every letter, word, mark and focal subject sits
wholly inside a single area", and the two `Forward energy sweeps` phrases
(they cannot be placed without positional language, and every positional
statement this tail has carried was painted: v24's thirds as framed passages,
v2's rows as numerals).

Kept: the first two lines byte for byte (so Draw 1's tail boundary and head
still lock), lettering left to right, the company name whole and legible,
"never an on-vehicle photograph" (in the head, untouched).

Added, stated as what the image IS:

```text
The image is the printed artwork itself, at full size, seen straight on, and nothing else. The design runs off all four edges: the outermost pixels on every side are artwork in mid-motion, and the print continues beyond the image in every direction. There is no margin, border, frame, mount or backdrop around it; the artwork reaches every corner.

Every part of the image, corner to corner, is finished, intentional, commercially valuable artwork — real subject matter, real depth, real movement, worth what the customer paid — with no empty backdrop, filler or quiet leftover anywhere. The focal subject may span as much of the image as the concept calls for, and the ground, palette, texture, lighting and motion run continuously through the whole picture.

Lettering reads left to right throughout; the company name appears whole and legible, and the only lettering in the image is the company name and the wording the brief calls for.
```

"Caption", "label", "numeral" are deliberately NOT named: they are on the
whole-prompt forbidden list (`scripts/atlas-field-contract-v2.mjs`
`FORBIDDEN_IN_FIELD_PROMPT`) because text handed to the model becomes
artwork. The numerals came from the rows; the rows are gone. The lettering
sentence covers the rest positively.

The assembled prompt for the New Aura request (exact stored fields) is
4,143 chars, sha256 `9bbf6e873f18bf0e…`, one text part, zero image parts,
and passes `assertFieldPromptClean`. Full text: `docs/ab/` after the draw run
(`prompt-field-v3.txt`).

Known trade-off, to judge on the draws: with no positional language the
company name may land once, across the driver/passenger boundary (y = 1365),
and be sliced by the cut. v24 avoided that by asking for the name inside two
thirds; v2 F4 over-corrected into four names and two invented lock-ups.

---

## 3. How the draws are made (step 3)

The product fail-over sends the field request to the DEPLOYED edge, which
answers only the contract it was deployed with. Drawing v3 "before any
deploy" therefore uses the route the field-recovery draws used (tests 9 and
11, run `33659500846`): `atlas-teaching-proof-ab.yml` test
**`12-field-v3-draws`** builds `atlas-call1-build` from THIS checkout
(`scripts/build-atlas-call1-prompt.mjs` lifts the edge's own assembly by
anchor, verbatim), ships it with `runtime/` to the droplet, and
`scripts/atlas-field-v3-draws.mjs` executes it on the exact request body
`atlasEdgeRequestBody` emits for a `field-thirds-v2` manifest, then sends
the one text part to Gemini with the edge's model and generationConfig
(`gemini-3-pro-image`, `1:1`, `4K`, no temperature). Each draw is then
`normalizeAtlasMaster` → `deterministicMasterChecks` →
`classifyAtlasCandidate` → `cutCallOnePanels` on the same field territories
production uses.

No deploy, no env write, no lease row, no request row, no revision. Writes:
the evidence under `wrap-files/designiq-ab/<stamp>-field-v3/` and the
workflow artifact.

Dispatch inputs used: brief and vehicle exactly as stored on generation
`664d054d-b10e-4bdf-b7e2-d188f32ce53a` (including the double space and
"llamborghini"), `company_name: New Aura Day Spa`, `design_name: New Aura Day
Spa`, `industry` and `colors` empty (omitted), `draws: 4`.

Results: §5, filled in from the run.

---

## 4. Commits

| commit | what |
|---|---|
| `cf89a79` | v3 tail, pins, locks, harness test 12 |

---

## 5. Draw results

_Filled in after run completion — see the run id and storage prefix below._
