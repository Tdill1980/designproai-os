# Next session — two regressions to review and fix in code (2026-09-10)

Owner instruction (Trish, 2026-09-10 ~03:10Z): *"Write a full .md and prompt
for next session. Point out design regression and atlas regression. Must
review and fix code."*

This file is the handoff. It states what is deployed, what was measured
tonight, the two regressions, the exact code to review, the fix order, the
acceptance test, and the prompt to paste into the next session. Nothing in
it is a live acceptance receipt; every claim carries its run, row or file.

---

## 0. Where the system is right now

| | |
|---|---|
| deployed runtime | main `676423375a7181c617fd35698ae037b828e344dd` (PR #351), deploy run `34424607562`, 2026-09-10 01:18Z, both replicas accepted, `atlas_panel_finish` off |
| deployed edge | `design-panel-ai-generate` as of PR #350's edge deploy; `ATLAS_ARTBOARD_PROMPT_VERSION = atlas-artboard-designiq.20260901.v23-orthographic-restored`, `ATLAS_FIELD_PROMPT_CONTRACT = designpro.atlas-field-prompt.v2` |
| runtime pins | `PROMPT_VERSION = designpro-flat-first-atlas-20260901.v23-orthographic-restored` (`runtime/flat-first-atlas.cjs:91`), field contract v2 (`:94`) |
| Call-1 routing | six-surface first (one candidate + one unchanged fallback); when both are refused, ONE fail-over to the one-field request (`FIELD_FAILOVER_ATTEMPTS = 1`, `runtime/flat-first-atlas.cjs:141`, `failOverToField` at `:2744`), recorded as `metadata.authoringTopology` / `metadata.authoringFailover`. `DESIGNPRO_ATLAS_FIELD_FAILOVER=off` restores fail-closed |
| working branch | `claude/gallant-galileo-cnuhhu` — harness and docs only, nothing product-facing; not merged |
| last real customer generation | New Aura Day Spa, GenerationID `664d054d-b10e-4bdf-b7e2-d188f32ce53a` (DID-664D054D), revision `cfb323a0-3011-482e-a180-060e21f5b95a`, completed end to end on `30fb883` — and rejected by the owner on sight |

Nothing that was learned tonight has been fixed in product code. The two
regressions below are open.

---

## 1. REGRESSION A — design quality (the persona's output is not the product)

### Owner's words

*"Where's the atlas design? This is clearly ai slop! Missing key elements …
my edge functions designer persona is not being used clearly its slop."*
(2026-09-10, on the first four one-field draws.)

*"Design is not even properly done … no longer designing as a pro wrap
installer."* (2026-09-10, on DID-664D054D.)

### What is established

1. **The persona IS executed on every Call 1.** The exact prompt for the New
   Aura brief was assembled from the transpiled edge source (4,496 chars,
   `docs/ATLAS-ONE-FIELD-DRAWS-2026-09-10.md` §"Correction"). It carries the
   senior wrap-designer identity, THE CONCEPT + translation clause,
   `Business: New Aura Day Spa` + logo requirement, the contact lock, the
   photographic-realism judgment and PHOTOGRAPHIC IMAGERY. Both A.T.L.A.S.
   branches call the same `buildDesignIQPrompt`
   (`supabase/functions/design-panel-ai-generate/index.ts:697`, invoked at
   `:2471` with `atlasFlatMaster: true`).
2. **The first four "slop" draws were an invented brief**, not the customer's
   (my error). With the stored New Aura brief the one-field draws render the
   brief 4/4: logo, name, the facial photo, blues/sage/white (run
   `34430841234`).
3. **So the design regression is not "persona missing". It is the A.T.L.A.S.
   tail of the persona prompt** — the part that replaces the 3D studio/camera
   presentation with flat-master output text — and it is measured on both
   branches:

| branch | tail | measured effect on design |
|---|---|---|
| six-surface (`atlasFlatMasterContract`, `index.ts:454`) + labeled teaching sheet + neutral guide | six named rectangles, "plain rectangular printed-media regions" | draws the VEHICLE into the flanks (wheel arches, side profiles, ROOF/REAR captions) — every canary since 08-31, DID-664D054D included; the classifier and gates accepted 664D054D |
| one-field (`atlasFieldContract`, `index.ts:585`) | six `left top right bottom` fraction rows + "every letter, word, mark and focal subject sits wholly inside a single area" | no vehicle 8/8; but the fraction rows are PAINTED as numerals in 5/8 (captions, axis ticks), the "square is one picture" framing is read as a poster/mockup with margins in 2/8, and the "single area" sentence forbids the very thing the brief asked for (a photo across most of the vehicle) |

4. **The gates do not catch either failure.** `runtime/atlas-master-qc.cjs`
   convicts near-black fields (`FLAT_BLACK_CHANNEL_MAX = 24`,
   `MAX_ZONE_EDGE_HOLE_RATIO = 0.35`); painted numerals, pale gutters, blue
   poster margins and grey mounts are none of those. The output-class
   question (`runtime/atlas-output-class.cjs:71`) answered `flat_atlas` on
   all 8 field draws including the captioned ones, and answered
   `flat_atlas` on 664D054D's Urus silhouettes before it was tightened.

### What is NOT established

- Whether the v24 field tail (harness fixture `37e4137e…`, draw
  `33659500846`) is free of the margin/poster reading — it was drawn once.
- Whether the six-surface branch can be conditioned not to draw anatomy.
  Every variant in `docs/ATLAS-CALL1-*.md` (labels erased, teaching proof
  absent, guide ablated, anchor restorations v1–v4) drew a vehicle.

---

## 2. REGRESSION B — the A.T.L.A.S. artifact (what reaches PanelPro is not a printable sheet)

### Owner's words

*"At least on the last design we had an atlas even if it had wheels cut
out."* — i.e. the six-surface sheet is recognisable as A.T.L.A.S.; the
one-field square is not.

### What is established

1. **Six-surface path:** the sheet has the right topology and the wrong
   pixels. DID-664D054D's flanks are Urus side profiles on a grey surround;
   the cut panels would print a car outline. A cut-out wheel is a panel that
   cannot print (RULE 0.15, RULE 0.32). "At least an atlas" is not a
   deliverable.
2. **One-field path:** the pixels are right and the sheet is not
   recognisable. The six panels are cut by code
   (`runtime/atlas-field-territories.cjs`, `field-thirds-v2`) and exist in
   PanelPro, but the master the owner sees is one square. Tonight's
   real-brief draws: F3's passenger panel is a clean printable full-bleed
   photo panel; its driver panel carries axis ticks; F1/F2 carry a margin
   inside the driver territory.
3. **The gates and classifier pass both failure modes** (§1.4).
4. **Fail-over as deployed will produce the one-field defects in production**
   when six-surface is refused twice: coordinate numerals inside panels, or a
   poster margin inside the driver panel, accepted and fanned out.

---

## 3. Code to review (exact places)

| # | file : symbol | why |
|---|---|---|
| 1 | `supabase/functions/design-panel-ai-generate/index.ts:585` `atlasFieldContract` | writes six fraction rows and the "single area" sentence into the model request. RULE 0.33: the model is shown **no normalized `[0,1]` text**. This is the measured leak. |
| 2 | `index.ts:740–1011` and `:1135–1152` (`buildDesignIQPrompt`, `atlasField` / `atlasFlatMaster` branches) | the A.T.L.A.S. tails; the commercial and restyle branches each have an `if (atlasField) { … return }` and `if (atlasFlatMaster) { … return }`. Every else-branch must stay byte-identical (the harness control pin depends on it). |
| 3 | `index.ts:454` `atlasFlatMasterContract` | six-surface tail. Known to condition vehicle drawing together with the teaching sheet + guide. Do not "fix" with negatives (RULE 0.15/0.32: negatives make Gemini over-index). |
| 4 | `index.ts:2414` `handleAtlasArtboard` | branch on `fieldContract`; verify the field branch still sends prompt + customer references ONLY, and that the six-surface branch's parts order is unchanged. |
| 5 | `runtime/flat-first-atlas.cjs:1610–1670` `atlasEdgeRequestBody` | what the runtime forwards: `companyName`, `phone`, `website`, `industry`, `brandColors`, `finish`, `styleDescriptors`, references. Confirm every customer field in `request_input` reaches the edge (the New Aura request has `companyName` and `finish`; nothing else). |
| 6 | `runtime/flat-first-atlas.cjs:2726–2760`, `:2985–3010` | six-surface manifest, field manifest, fail-over routing, attemptKeys. Review only; the routing was locked by `tests/atlas-authoring-recovery.test.mjs` and verified deployed. |
| 7 | `runtime/atlas-field-territories.cjs` | the territory cut. Check that territory edges do not sit on the thin margins the model tends to leave (F1: margin at y≈0.04 is INSIDE the driver territory, which starts at 0.0176). |
| 8 | `runtime/atlas-output-class.cjs:71` `outputClassPrompt` | post-generation only. It should name painted numerals/axis ticks and a uniform margin/mount around the artwork as `vehicle_depiction`-class refusals (or a new blocking class), so a captioned field cannot become canonical. |
| 9 | `runtime/atlas-master-qc.cjs` | consider a colour-agnostic **border-uniformity** measure on the raw canvas edge ring (a uniform margin of any colour around the whole sheet is a mount, not artwork). CLAUDE.md deliberately rejected a colour-agnostic field detector for flat-colour wraps; a WHOLE-CANVAS uniform ring is a narrower signature. Measure on fixtures before adding. |
| 10 | `tests/atlas-one-field-call1.test.mjs`, `tests/atlas-artboard-edge-call1.test.mjs`, `tests/atlas-clean-authoring-contract.test.mjs`, `tests/atlas-output-class-gate.test.mjs` | the locks that will move with any tail change; update to the new ruling, never weaken. |

---

## 4. Fix order

Do not start with the six-surface branch. The record has fifteen six-surface
variants and all drew a vehicle; the one-field request is the only
configuration measured anatomy-free (9/9 across 09-02 and tonight), and its
defects are all in one function.

1. **`atlasFieldContract` → `designpro.atlas-field-prompt.v3`.** Remove the
   six fraction rows and the "areas" paragraphs. Remove "every letter, word,
   mark and focal subject sits wholly inside a single area". Keep: one
   continuous full-bleed field, edge to edge on all four sides, straight-on
   and flat, "never an on-vehicle photograph", lettering left-to-right, the
   company name whole and legible, the forward-energy sweep per flank if it
   is kept as prose without coordinates. State positively that the artwork
   runs off all four edges with **no margin, border, frame, mount or
   caption**. Advance the runtime pin (`flat-first-atlas.cjs:94`) with it;
   `callAtlasArtboardEdge` verifies the echoed contract.
2. **Draw it four times on the New Aura brief BEFORE any deploy**
   (`designiq-ab-precision.yml`, `arms: F`, `field_draws: 4`,
   `runtime_source: checkout`, the stored brief and `company_name`, an
   operator-minted lease — §6). Acceptance: 4/4 no numerals, no margin, no
   vehicle, classifier `flat_atlas`, the cut driver/passenger panels
   printable to the eye. If it fails, the next variable is the v24 tail
   verbatim, not a new invention.
3. **Tighten the post-generation gate** (§3 #8, #9) so the two measured
   defects cannot become canonical whichever branch produced them.
4. **Then decide with the owner**: keep six-surface primary with the fixed
   fail-over, or make one-field primary and show the six code-cut panels as
   the A.T.L.A.S. sheet in PanelPro. That is an owner ruling (RULE 0.33 vs
   the 2026-09-06 restoration); prepare the evidence, do not decide it.
5. Ship as one PR: edge change + runtime pin + tests + CLAUDE.md header,
   through the normal order (merge → push gate green → `release.yml` if a
   migration → `deploy-edge-functions.yml` → `deploy-production.yml` with
   `exact_sha`). Verify the deployed edge body hash against the branch; the
   two halves ship separately and have been stale before.

### Do not

- Do not add wheel-well or anatomy negatives to any prompt (RULE 0.32).
- Do not rewrite the creative framing above the tail (RULE 0.1, v19 parity).
- Do not relax a deterministic threshold to get a run through.
- Do not draw through the product path to experiment; use the harness.
- Do not touch `persona-photographer-render`, `view-angles-os.ts`,
  `studio-os.ts` (RULE 0.29).

---

## 5. Evidence index

| what | where |
|---|---|
| tonight's measurements and reading | `docs/ATLAS-ONE-FIELD-DRAWS-2026-09-10.md` |
| run 1 (invented brief), F1–F4 | run `34425798511`, artifact `10132676336`, storage `wrap-files/designiq-ab/2026-09-10T01-34-*`, harness generation `571ccf9c-9d77-4248-87c4-0e6bb1f9b7f4` (row `0379ea56…`, cancelled) |
| run 2 (stored New Aura brief), F1–F4 + cut panels | run `34430841234`, storage `wrap-files/designiq-ab/2026-09-10T02-52-*`, harness generation `e28cd30d-56e8-4a53-8624-e08679c2e5f6` (row `042da9a3…`, cancelled) |
| the rejected six-surface customer run | GenerationID `664d054d-b10e-4bdf-b7e2-d188f32ce53a`, revision `cfb323a0…`, master `cb765b0f…` |
| exact field prompt for the New Aura brief | assemble with `scripts/build-control-prompt.mjs` then `buildDesignIQPrompt({... atlasFlatMaster: true, atlasField: true, atlasPanels, atlasNoseEdge})` — see the assembly in `docs/ATLAS-ONE-FIELD-DRAWS-2026-09-10.md` |
| six-surface ablation record | `docs/ATLAS-CALL1-LABEL-ERASURE.md`, `ATLAS-CALL1-TEACHING-PROOF-ABSENT.md`, `ATLAS-CALL1-GUIDE-ABLATION.md`, `ATLAS-TEACHING-PROOF-FIELD-AB.md`, `docs/ab/` |
| fail-over implementation | PR #351, `tests/atlas-authoring-recovery.test.mjs` |

---

## 6. Harness, as it stands on `claude/gallant-galileo-cnuhhu`

`designiq-ab-precision.yml` can now draw both Call-1 branches on demand.

- Inputs: `arms` (`B` = six-surface, `F` = one-field), `field_draws` (1–6),
  `brief`, `company_name`, `design_name`, `industry`, `colors` (empty =
  omitted), vehicle fields, `runtime_source: checkout` to run THIS ref's
  runtime modules inside the deployed image.
- The deployed edge authorizes every Call 1 against a **leased**
  `designpro_generation_requests` row. The harness cannot insert one (the
  table trigger calls a function whose EXECUTE is revoked from
  `service_role`). Mint one as the database owner before dispatch, pass it
  as `lease_request_id` / `lease_generation_id` / `lease_claim_token`, and
  cancel it after. The SQL is in the header comment of
  `scripts/designiq-ab-precision.mjs` ("THE PROVIDER LEASE"); `attempt` is
  pinned at 12 so an expired lease is failed by the worker without running.
- Arm B now stages the labeled teaching proof; it has not yet been drawn
  through the harness since that fix.
- The control-drift pin is current (`d4ac0f9e…`); it moves with any edit to
  the sliced pure-prompt region and must be re-pinned with a reason.

---

## 7. Prompt for the next session

Paste this as the first message:

```
Read CLAUDE.md, then docs/NEXT-SESSION-ATLAS-REGRESSIONS-2026-09-10.md and
docs/ATLAS-ONE-FIELD-DRAWS-2026-09-10.md before touching anything.

Two regressions are open and both are in code, not in the customer's brief:

DESIGN REGRESSION — the DesignPanelAI designer persona is executed on every
Call 1, but the A.T.L.A.S. tail appended to it is what is producing the
output I reject. Six-surface tail (index.ts atlasFlatMasterContract + teaching
sheet + guide) draws the vehicle into the flanks. One-field tail (index.ts
atlasFieldContract) paints its own coordinate rows into the artwork, reads
"the square is one picture" as a poster with margins, and forbids a focal
subject from spanning areas, which is the opposite of my brief.

ATLAS REGRESSION — what reaches PanelPro is not a printable sheet on either
branch: six-surface prints car outlines; one-field prints numerals or a
margin inside the driver panel. The deterministic gates and the output-class
question accept both.

Do, in this order, and stop for me between steps 2 and 4:
1. Review the ten code locations in section 3 of the handoff. Report what you
   find as evidence with file:line, not opinions.
2. Rewrite atlasFieldContract as designpro.atlas-field-prompt.v3 per section 4
   step 1 (no coordinate rows, no "areas", no "single area" sentence, positive
   full-bleed no-margin/no-caption wording). Advance the runtime pin. Update
   the locks. Do not touch the creative assembly above the tail and do not add
   anatomy negatives anywhere.
3. Draw it 4 times on the stored New Aura brief through the harness
   (section 6: mint the lease, arms F, field_draws 4, runtime_source
   checkout). Send me the four raw masters and the cut driver/passenger
   panels. Acceptance is in section 4 step 2.
4. Tighten the post-generation gate so painted numerals, axis ticks and a
   uniform margin/mount can never become canonical (section 3 items 8–9),
   with fixtures.
5. Only after I approve the draws: one PR (edge + runtime pin + tests +
   CLAUDE.md header), merge, wait for the push gate, deploy edge, deploy
   runtime with exact_sha, verify the deployed edge body hash, and then tell
   me the exact commit that is live.

Rules that bind you: RULE 0.1 (do not rewrite creative framing to fix a pixel
defect), RULE 0.15/0.32 (no anatomy negatives, no relaxed thresholds), RULE
0.29 (do not touch the photographer stack), RULE 0.33 (the model is shown no
normalized [0,1] text). Every claim you make about a draw carries its run id
and storage path. Do not tell me something is fixed until a real customer
generation shows it in PanelPro.
```
