# RestylePro is the reference implementation. Recover before you invent.

Applies to **every session working in this repository**, not just one. If a
capability worked in `Tdill1980/restylepro-os`, the first move is to find that
implementation and reuse it — not to design a new one.

The failure this rule exists to stop is not sloppiness. It is a session reading
a standalone stage, seeing no local precedent, and writing a fresh
implementation of manufacturing behaviour that was already solved and proven in
the source system. The new code is plausible, it passes its own tests, and it
quietly ships different panels.

**The goal is working RestylePro production behaviour inside the new
DesignProAI operating-system contracts. Not new manufacturing behaviour
invented again.**

## The procedure, before any code is written

1. **Name the stage.** Which `stage_key` in
   `runtime/designpro-standalone-claimant.cjs` is being touched.
2. **Find its RestylePro counterpart.** Use the map below as the starting
   point, then confirm it by reading the source file — the map is a lead, not a
   citation. State the exact file and function you are treating as the
   reference.
3. **Compare them side by side.** Not from memory of what the code does. Open
   both.
4. **Port the smallest proven behaviour that closes the delta.** If the
   standalone version differs, say what the delta is and why it exists before
   changing anything.
5. **If there is no counterpart, say so explicitly.** "No RestylePro
   implementation exists for this" is a finding worth stating. It is the only
   thing that licenses new design, and it should be rare in the post-approval
   half.

## Frozen — port, do not redesign

These are manufacturing semantics. They were derived from live print failures,
and re-deriving them costs weeks and ships wrong files in the meantime.

- per-side source binding
- `proofRegion` provenance
- `brandedMaster` / `cleanMaster` relationships
- deterministic side identity
- GENIE geometry
- logo separation
- PanelPro handoff

## Adapt — this is what the standalone boundary legitimately changes

Only the plumbing around the behaviour, never the behaviour:

- persistence (`designpro_*` objects, not `color_visualizations` /
  `production_flow_assets`)
- auth
- CAS / hash storage
- durable stage execution (leases, fencing, resume)
- droplet and runtime plumbing

## Reference map — post-approval stages

`runtime/designpro-standalone-claimant.cjs` on the left; the proven RestylePro
implementation on the right. Line numbers are from the current tree and drift —
grep the `stage_key`, do not trust the number.

| Stage (line) | RestylePro reference |
|---|---|
| `source.verify` (815) | `color_visualizations.admin_notes.designiq_generation_id` back-link + `production_flow_assets` keying — see `src/components/designpanelpro/DesignAssetsPanel.tsx` for the canonical-id resolution |
| `revision.freeze` (392) | `src/lib/designId.ts` (`formatDid`, `didFromRenderRow`) — the DID derives from the canonical DesignIQ id, never from whatever id a page holds |
| `manifest.resolve` (399) | `supabase/functions/panelizer-step-validate/index.ts` — GENIE per-side dimensions; the proof and the panels must resolve from the *same* call/params |
| `proof.build` (413) | `supabase/functions/generate-2d-proof/index.ts` + `proof-sheet.ts` (`renderFlatTile`, `composeProofSheet`, `buildProofTextLock`); display selection in `src/lib/generateDisplaySafe2DProof.ts`. Never `api/compose-2d-proof` as the producer. |
| `panels.build` (513) | `src/lib/enticePanelsFromProof.ts` + `src/lib/flatMasterSheet.ts` (`buildFlatMasterSheet`); extractor `supabase/functions/panel-pro-extract/index.ts` mode `single` / `qccheck`; deterministic finish `panel-artboard-generator` steps `gridslice` / `mirrorpanel`; tile crop `panelize-artboard` |
| `logos.extract` (576) | `supabase/functions/extract-logo-elements/index.ts` + `extractTransparentSlice` — real-pixel lift off the branded artboard. Never the generative `separate` pass. |
| `pack.verify` (605) | `src/components/production/ProductionPackQCCard.tsx` (evidence lines, six attestations) |
| `pack.activate` (616) | `supabase/functions/activate-print-worker/index.ts`, gated by `src/hooks/useQuickProductionPack.ts` — post-payment only |
| `enhance.upscale` (862) | `supabase/functions/upscale-panel-to-print/index.ts`; worker `worker/index.js` `topazUpscale` / `upscaleToTarget` / `upscaleFor` |
| `output.build` (945) | `worker/index.js` `processPanel`, `fitAndBleed`, `floorBodyColor`, `encodeDeterministicRasterEps` / `vectorizeToEps` |
| `output.verify` (951) | `worker/index.js` `qcCleanField`, `hashArtifactEvidence`, `stampPrintWorker` |
| `stamp.build` (972) | `src/components/production/ProductionPackQCCard.tsx` — the QC certificate is pure canvas, no AI, and gates on all six human ticks |
| `zip.build` (1004) | `worker/index.js` `packageOrderPack` (+ `/package-pack` self-heal path) |
| `wrapbox.deliver` (1066) | `supabase/functions/deploy-to-wrapbox/index.ts` → `send-design-pack-email`; terminal status is `ready`, and `delivered` is not a valid status |

Two RestylePro worker files carry the DesignPro-specific entice and extract
chains and are worth reading before any `panels.build` change:
`worker/designpro-entice-workflow.cjs` (3,061 lines) and
`worker/designpro-proof-extract-v3.cjs` (1,774 lines).

## Do not restore old infrastructure wholesale

Restoring the working logic is the instruction. Restoring RestylePro's
infrastructure is not. The prohibited tables stay prohibited, the browser stays
out of runtime orchestration, and dead RestylePro pipelines
(`generate-artboard-from-proof`, the AI master-artboard generators, the
render-fed A.C.E. flatten, `liftoverlays`, `panelizer-step-fill` outside its
photo-recreate role) do not come across at all. Port the function, not the
scaffolding around it.

## RestylePro is a baseline, not scripture

Where the source is demonstrably wrong, the correct behaviour wins and the
divergence is recorded — the passenger-mirror finding in
`docs/CALLS-1-7-PORT-SCOPE.md` is the worked example. That is a documented
exception, established by reading both implementations. It is not a general
licence to substitute a new design for one you did not read.
