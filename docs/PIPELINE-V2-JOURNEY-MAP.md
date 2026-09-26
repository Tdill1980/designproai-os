# Pipeline v2 and customer journey map (2026-09-25)

Flag: `DESIGNPRO_PIPELINE_V2` (runtime, default off). The declared graph is in
`runtime/pipeline-v2.cjs`, locked by `tests/pipeline-v2.test.mjs`.
Line numbers are for `origin/main` @ 89a5de8c. Production numbers come from
read-only SQL on `wozyamlnygaddievzuwn`, run 2026-09-25 around 18:25 PT.

## 1. The owner's pipeline: what exists

| Step | Status | Where |
| --- | --- | --- |
| Call 1: TriZone Production Panel Proof | **exists** | edge `production-panel-proof` (two-turn, 3:2, 4K). Deployed v267, 2026-09-24 20:52 PT |
| Call-1 proof shown to the customer immediately | **exists** | `app/src/pages/DesignPanelProPremium.tsx:2479` `AtlasPanelProofSheetLoader` (polls while pending) |
| Custom design edge functions between Call 1 and Call 2 | **missing (not wired)** | declared as optional node `design.suite`; inventory below. Owner must pick which functions and what each consumes |
| Call 2: seven 3D views fed by the Call-1 proof, in parallel | **exists** | `runtime/generation-worker.cjs:1233` `onProofSheetReady` → `runtime/designpanel-server-provider.cjs:1208` `prefetchAtlasProofsFromPanelProof` (all 7 → `persona-photographer-render`) |
| Each view streamed to the customer as it lands | **exists** | `app/src/hooks/useDesignPanelProLogic.ts:726` `onViews` progressive observer |
| ATLAS topology proof from the Call-1 proof, in parallel, 5" bleed | **exists** | `runtime/atlas-panel-proof-topology.cjs:584-610` (zone = trim + `bleedIn`); file output `runtime/panelpro-file-output-service.cjs:219` `bleedInches:5` |
| Atlas + proof + 3D views go to PanelPro for human QC | **exists** | `app/src/pages/AdminGeminiCompareStudio.tsx:2226` preflight checks; claimant `await_panelpro_preflight_qc` / `await_final_human_qc` `runtime/designpro-standalone-claimant.cjs:2877` |

Measured on production over the last 30 days (195 requests):

- Outcome: 98 `outputs_ready`, 91 `failed` (46.7%).
- Median request → view slots created (Call 1 finished): **90 s**.
- Median request → first 3D view: **132 s**.
- Median request → last view: **144 s**.
- Median first → last view: **7 s**. The views already run in parallel.
- Median request → ready: **148 s**.

## 2. Vehicle dimensions: apply them at Call 1 or at Call 2?

**Recommendation: keep them at Call 1, which is what happens today. Do not move them to Call 2.**

- Call 1 already draws its containers from the GENIE inches (`_shared/atlas-proof-container-template.ts:73-93`: `widthIn`, `bleedInches`, "authoritative GENIE inches for labels").
- The Atlas branches off the Call-1 proof *in parallel with* Call 2. If the dimensions arrived at Call 2, the Atlas would have to wait for Call 2, which serializes the pipeline. The panels would also have to be re-fitted after Call 1, which is a second panel producer that CLAUDE.md §"ZONE 1 IS CUT FROM THE TEMPLATE" forbids.
- Call 2 is 3D photography and consumes no inches.
- The absolute size (PPI, bleed) belongs at output, and it is already applied there (`output.build`, 150 PPI + 5" bleed).

## 3. Customer journey after Call 2

| Step | Status | Where |
| --- | --- | --- |
| RevisionStudioIQ right column: proof + panels | **exists** | `app/src/pages/RevisionStudioIQ.tsx:6392` `ProductionProofSource`, `:6394` `ProductionFlowLayersCard` |
| "Order Production Files" button under them | **exists** | `RevisionStudioIQ.tsx:6428-6432`. Disabled until `productionProofsReady` (`:4433`) |
| Purchase (Stripe) | **exists** | `orderProductionPack` `RevisionStudioIQ.tsx:2346` → `POST /api/checkout/sessions` `gateway/src/server.mjs:3607`; webhook `:2696` |
| Success → Genie panelizer progress page | **exists** | `gateway/src/server.mjs:3618-3628` rewrites a print-pack success to `/designpro/jobs/:id/progress` (route `app/src/App.tsx:481`) |
| Atlas panels upscaled | **exists, gated** | claimant `enhance.upscale` `:2902` (Topaz; prefers `corrected-panel`). Runs only with `DESIGNPRO_TOPAZ_ENABLED=true` + `TOPAZ_API_KEY` on the droplet, and I cannot see the droplet env |
| Designers review panels | **exists** | PanelPro Studio `AdminGeminiCompareStudio.tsx` + board `app/src/pages/designpro/PanelProStudioBoard.tsx` |
| Designers download text overlays | **missing** | no text-overlay download in PanelPro QC. The text layer is `designpro-text-layer-generate` in RevisionStudio (`LayerStrip`). Needs a decision on which artifact is "the text overlay" |
| Designer QC checkmark | **exists** | `AdminGeminiCompareStudio.tsx:2334/2355` checkboxes, `preflightReady` `:2226` |
| Stamp proofs | **exists** | claimant `stamp.build` `:3268`; `app/src/lib/genie-panel-stamper.ts` |
| Zip of print-ready PDF/PNG | **exists** | `output.build` `:3199`, `zip.build` `:3402` (needs a stamp orderNumber `:3405`), download `app/src/pages/designpro/GenieProgress.tsx:616` |
| Full version history in RevisionStudio **and** PanelPro | **partial today → wired in #722/#723 behind a flag** | today `app/src/lib/design-version-history.ts` + `DesignPromptRecord` (versions + brief/revision prompts). #723 adds per-view re-render notes, every asset per version and the design↔order link, on all three surfaces |

## 4. The studio edge template (the "Claude-built template")

- **Files:** `supabase/functions/_shared/atlas-proof-container-template.ts` + `atlas-proof-container-render.ts` (resvg-wasm, drawn inside `production-panel-proof`), and `_shared/atlas-panel-proof-prompt.ts` (`SHEET_LAYOUT`, `VERSIONS`, contract `designpro.atlas-panel-production-proof.v1`). Imported at `production-panel-proof/index.ts:62-63`.
- **How Gemini sees it:** as a **user-turn image plus prose**, not as `systemInstruction`. `systemInstruction` is set only on the `separatedArtwork` path (`index.ts:1111`), which is forbidden. `_shared/gemini-image-interactions.mjs:90` sends `system_instruction`, but only for template previews.
- **Deploy status:** `production-panel-proof` v267 was deployed 2026-09-24 20:52 PT. That is after the last commit touching it or its template (46f9011b, 2026-09-24 19:16 PT), so the template should be live. I did not verify this byte-for-byte.
- **In use:** yes, it is Call 1. Moving it to `systemInstruction` is a prompt change: it needs a pin bump (below) and a side-by-side per RULE 0.37. It is not done here.

## 5. The frozen prompt

`runtime/pipeline-v2-prompt-pin.json` pins sha256 hashes of the Call-1 prompt sources. Changing either file without bumping the pin fails `tests/pipeline-v2.test.mjs`. Until now the contract string stayed `…v1` across roughly 30 prompt revisions (audit).

## 6. Resolution: what the pixels can and cannot do

This comes from `resolutionGate` (pure; reports only). It is not yet wired into eligibility; the natural wiring point is the `enhance.upscale` receipt.

- Driver cell 979×335 px (audit) on a 236×69 in side: **4.15 PPI** native. Topaz stops at 6× → **24.89 PPI**.
- One 4K sheet caps a 176.8 in flank at 28.6 PPI (CLAUDE.md). For an assumed 60 in-tall panel, Topaz's 96 MP ceiling lands at **~94.7 PPI**.
- 150 PPI is not reachable from one Call-1 sheet plus Topaz alone. The levers are larger native pixels per panel or vector layers.

## 7. Edge function inventory (read-only `list_edge_functions`, 2026-09-25)

- 48 functions are deployed and 44 are in the repo. All 44 in the repo are deployed.
- **4 are deployed with no source in the repo:** `designpro-clean-views`, `extract-logo-elements`, `layerlift-engine`, `atlas-dca-admin`.
- Candidates for the between-calls design suite:
  - `designpro-text-layer-generate`
  - `designpro-separate`
  - `extract-logo-elements` (deployed only)
  - `layerlift-engine` (deployed only)
  - `vectorize-it`
  - `cut-graphics-proof`
  - `cut-contour-build`
  - `generate-2d-proof`
  - `persona-designer-generate`

## 8. Later phase (hooks only, all disabled)

| Hook | Data model | Feasible? | Access needed |
| --- | --- | --- | --- |
| `enhance.upscale` (Topaz) | exists (claimant stage + receipt) | yes. The ceilings are in §6 | `TOPAZ_API_KEY`, `DESIGNPRO_TOPAZ_ENABLED=true` on the droplet |
| Correct bleed | exists (5" in topology + output) | yes | none |
| `vectorize.layers` | node declared | yes for text/logo/cut marks (`runtime/layerize.cjs` vtracer, edge `vectorize-it`). Photographic artwork stays raster | owner decision on which layers |
| `template.vector` (Dropbox by year/make/model) | `designpro_designs.template_ref` jsonb (#722) | yes | Dropbox app (OAuth, `files.content.read`) + shared-folder access + a folder naming convention |
