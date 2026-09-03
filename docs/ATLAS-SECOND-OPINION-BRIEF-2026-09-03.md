# A.T.L.A.S. — BRIEF FOR A SECOND-OPINION DEVELOPER (2026-09-03)

Repo `Tdill1980/designproai-os`. Reference implementation `Tdill1980/restylepro-os`. Working branch `claude/dca-phase-1-execution-47019t` (four commits ahead of `main`; `main` head is `f2deb79c`, PR #299). Owner: Trish. Print floor contact: Brice.

Evidence levels used throughout, as the repo uses them: **DEPLOYED-VERIFIED** (read back off the running system), **CODE-LOCKED** (in the branch with a named test), **OPEN**.

## 1. What the product is

DesignProAI takes a customer's typed brief plus year/make/model and must produce, automatically, a print-ready vehicle-wrap production pack. **A.T.L.A.S.** is the owner's name for the core artifact: *the continuous printed wrap sheets, unwrapped flat, before installation and trimming* (RULE 0.32 in `CLAUDE.md`). It is printed media, not a picture of a vehicle. Six rectangular surfaces: Driver, Passenger, Hood, Roof, Front, Rear. Each is one solid rectangle of artwork at the vehicle's real dimensions plus 5" bleed. The installer cuts wheel openings and windows out of the finished panel, so the artwork must exist there. A wheel-shaped hole, a body line, or a vehicle silhouette in the artwork is a failed master.

The intended pipeline, all server-owned:

```
Enter vehicle → GENIE prep (dimensions resolved before any image call)
Call 1  → ONE Gemini image request → 4096×4096 flat master (the only creative authority)
        → deterministic gates → deterministic cut of six panels (sharp.extract, no AI)
        → six panels + master published to RevisionStudioIQ and PanelPro Studio
Calls 2–7 → seven 3D proofs, each conditioned on its own surface's panel, via the pinned
            RestylePro photographer stack (persona-photographer-render, mode atlas-proof)
Call 8  → 2D production proof
Call 9  → hash-verify + promote the six Call-1 panels (creates no artwork)
Call 10 → logo asset registration
Call 11 → six de-logoed QC duplicates for the human sizing check
Purchase → GENIE manifest.resolve → PanelPro human preflight QC → Topaz upscale
        → output.build (PNG/TIFF/EPS at 150 PPI full scale, 5" bleed, data band)
        → output.verify → final human QC → ZIP → WrapBox
```

One image call authors the design. Everything after it is code. That is the architectural commitment, and every open problem below is about the one call.

## 2. What is built and where it lives

| piece | file(s) | status |
|---|---|---|
| GENIE prep on Enter: dimensions resolved and persisted before generation; consumed by Generate (`prepHit`) | `runtime/genie-prep.cjs`, `designpro_genie_preps` | DEPLOYED-VERIFIED (2026-09-02 on `24a8b446`; prep READY in 78–92 ms, zero provider calls) |
| GENIE manifest hash v2 (hashes the six surfaces; v1 hashed null) | `runtime/genie-universal-resolver.cjs`, `docs/GENIE-MANIFEST-HASH-CUTOVER.md` | DEPLOYED-VERIFIED |
| Call-1 orchestration: request body, edge call, gates, cut-out fill, panel cut, lineage hashes, publication | `runtime/flat-first-atlas.cjs` | deployed at v24 |
| Call-1 prompt assembly: executes the real persona `buildDesignerPrompt`, swaps only the output tail | Supabase edge `design-panel-ai-generate`, `_shared/atlas-artboard-prompt.ts` | deployed; legacy six-container branch AND a v24 one-field branch both live, selected by request shape |
| Deterministic master gates: opacity, edge-hole ratio, concentrated flat-black cut-outs, template leakage, post-repair re-validation | `runtime/atlas-master-qc.cjs` | CODE-LOCKED, deployed |
| Output-class gate: one binary Gemini Flash question (flat sheet vs vehicle depiction), fails closed on `vehicle_depiction`, fails open on transport failure | `runtime/atlas-output-class.cjs` | deployed |
| Cut-out fill (deterministic boundary averaging of convicted holes) and promotion of the repaired sheet to canonical | `runtime/atlas-cutout-fill.cjs` | deployed; **owner has since ruled this is not repair** (see §4) |
| Six-panel deterministic cut with hash binding to the accepted master | `cutCallOnePanels` in `flat-first-atlas.cjs` | CODE-LOCKED |
| Seven 3D proofs from the pinned RestylePro photographer stack, artwork = that surface's panel, hash-verified both ways | `restylepro-os` `persona-photographer-render` (adapted), pinned `view-angles-os.ts`, `studio-os.ts`, `persona-photographer-prompt.ts` | DEPLOYED-VERIFIED (v23 run `84a3eadf`: six panels, seven views, Calls 8–11, `pack.activate` in 3 m 49 s) |
| Post-approval stages: Call 9 promotion, logos, Call 11 de-logo, PanelPro gate, Topaz, output build/verify, ZIP, WrapBox | `runtime/designpro-standalone-claimant.cjs`, `runtime/output-qc.cjs` | CODE-LOCKED; back half not yet exercised by a paid owner run |
| **Panel map** artifact `designpro.atlas-panel-map.v1`: one JSON per revision with vehicle identity, GENIE ids, master hash, per-surface trim/print/bleed/sq ft, position on master, native PPI and upscale factor | `runtime/panel-map.cjs` | branch only (`4dabdb69`) |
| **Panel data band** `designpro.panel-data-slug.v1`: Brice's Caldera-style `Key ....: Value` two-block band on the TOP edge, 1.5" (225 px) on production PNG/TIFF/EPS, 120 px on Call 11 QC panels; verified by `output.verify`; two new mandatory QC checkbox keys enforced by a text-patch migration on the live gate RPC | `runtime/panel-data-slug.cjs`, `output-qc.cjs`, `supabase/migrations/20260903000000_designpro_panel_data_slug.sql`, `docs/PANEL-DATA-SLUG.md` | branch only (`4dabdb69`, `f1719844`, `8596a72e`, `429b53c2`); height 1.5" confirmed by owner 2026-09-03 |
| Manifest identity fix: v24 overwrote `manifest.contract` with the territories contract, which broke proof conditioning (`atlasProjectionParts` identity check) | `runtime/atlas-field-territories.cjs` (`territoriesContract`), `tests/atlas-one-field-call1.test.mjs` | branch only, not deployed |

Test state on the branch: runtime 714/714, gateway 67/67, ops 57/57, app type-check clean.

## 3. The Call-1 history, as measured (this is the whole problem)

Every version below passed its own deterministic gates. The failures are creative/structural and were found by looking at masters.

| version | date | what the request was | what came back |
|---|---|---|---|
| v2 (Flamingo Pools `5b2eb96c`) | 08-22 | early flat-first, GA model | the gold-standard master: full bleed on all six, seven correct proofs. Prompt text not in the repo |
| v4–v8 | 08-23→26 | added the SIDE-TWIN sentence and a negative block | flanks came back as a vehicle silhouette on dark surround from v4 on; centre four stayed clean. Located and removed |
| v15/v16 | 08-31 | pure-rectangle Flamingo flat example + unlabeled neutral guide; installed-vehicle proof removed from the request after canary `33389124918` leaked wheel wells and template furniture | template leakage, wheel-well shapes |
| v17 | 09-01 | labeled Flamingo teaching proof + normalized `[0,1]` topology table | generation `470cb0e9` returned a photoreal vehicle-mockup montage that passed every structural gate → output-class gate added (v18) |
| v19 | 09-01 | parity diff against the last near-working master `2d918868` found commit `c5479313` had deleted 465 chars of creative direction; restored it; removed the `[0,1]` table, the blank guide, the refusal block from authoring | creative baseline recovered |
| **v23** | 09-01 | six named panels (Passenger left, Rear/Roof/Hood/Front centre, Driver right), labeled Flamingo teaching proof, per-run neutral guide, 2 model-input images, prompt 4,081 chars | **topology correct 4/4 runs**. Void-free AND anatomy-free first attempt **1/4** (`1f7b7bb4`). `5d727ea9` cyber design: excellent, but opaque wheel/body voids on both flanks (7.55% of the driver flank one uniform non-artwork field after "fill"). `84a3eadf` (F250, the GENIE-prep validation run): wheel arches and body lines painted as artwork, mirrored passenger |
| **v24 one-field** | 09-02 | no guide, no teaching proof, no six-panel list: "one continuous full-bleed composition in three horizontal thirds"; code cuts six territories from the field after the fact (`atlas-field-territories.cjs`, `field-thirds-v2`). Based on Field Recovery Draw 1 (run `33659500846`), the only measured draw with clean, continuous, anatomy-free flanks | product run `1a0e6b70`: **flanks clean** (no anatomy, no voids) but the sheet is three banners, not the flattened vehicle. Grey frame strips, rendered "UPPER THIRD / MIDDLE THIRD" labels, no composition on Hood/Roof/Front/Rear. All gates passed it. Proof handoff failed on the manifest-contract collision. **Owner reclassified: Call-1 creative acceptance FAIL, gates DEFECTIVE, proof handoff FAIL, DCA FAIL.** |

Full trace of the v23→v24 diff, the byte-exact v23 prompt, request shape and model inputs: `docs/ATLAS-ONE-FIELD-CALL1.md`, `docs/ATLAS-FIELD-RECOVERY-DRAW1.md`, `docs/ATLAS-WHEEL-WELL-ROOT-CAUSE.md`, `docs/ATLAS-CALL1-*.md`, raw evidence under `docs/ab/`.

Model: `gemini-3-pro-image` (GA id, pinned by name; the `-preview` id measured worse across eleven production runs). `1:1`, native 4K, `responseModalities ["TEXT","IMAGE"]`, no explicit temperature since v19.

## 4. Where it stands today

**Deployed** (droplet + edge): the v24 code. The product path calls the one-field branch. Its output is not acceptable. The manifest identity fix that would let a v24 master reach the proofs is on the branch, not deployed.

**On the branch, not deployed, no migration applied, no generation run since**: manifest identity fix, panel map, panel data band, the two QC checkbox keys, docs.

**Owner rulings that bound the next move** (verbatim where it matters):

- "v24 is not an acceptable A.T.L.A.S. Creative Master." Do not deploy it further, do not run another generation, do not document `field-thirds-v2` as accepted architecture.
- The arrangement must be the flattened vehicle: `PASSENGER | REAR / ROOF / HOOD / FRONT | DRIVER`.
- "The best last known was the most recent": the v24/Draw-1 **flank artwork quality** is the reference; the v23 family is the reference for the **six-surface arrangement**. Target = v24 flank quality inside v23 topology.
- "'Fill the holes' means the original Call-1 authoring must generate real design artwork through those locations. Do not clone adjacent pixels, inpaint, add a black-pixel repair, use vehicle masks or create replacement artwork after generation." So the deployed cut-out fill is a failsafe at best, not a fix, and turning a void into near-black pixels must not make an invalid master canonical.
- Until the conditioning root cause is identified by controlled experiment: no wheel-well negative prompting, no new repair heuristic, no relaxed threshold, no creative-persona edits, no re-roll-as-fix.
- One image call. No second producer of design anywhere downstream.

**What is proposed and waiting on the owner** (specified, not applied):

1. Restore the v23 request in the runtime (`git checkout d1c0e14b -- runtime/flat-first-atlas.cjs` + seven test files, two version strings). The deployed edge's legacy branch is byte-identical to the v23 assembly, so no edge redeploy is needed for the restoration itself.
2. Optionally replace one sentence in the output tail with the owner's own RULE 0.32 definition (continuous sheet as it comes off the printer, installer trims later). Untested hypothesis for one controlled draw.
3. Delete the edge's one-field branch so there is one product path.
4. Acceptance-gate additions so v24-class output cannot pass again: (a) deterministic neutral-grey **frame-band** gate (measured: convicts all six v24 zones, zero bands on v23 masters; solid-grey wrap fixture must pass); (b) widen the single inspector call to a structured verdict: rendered instruction text, vehicle anatomy, per-surface composition; (c) refuse Hood/Roof/Front/Rear reported pattern-only or empty. (b)+(c) widen RULE 0.30's "one binary question" and are the owner's call.
5. How to carry the one-field creative wording into the six-surface request — **no proposal yet**; this is the open design question.

## 5. The questions a second opinion should answer

1. **Conditioning.** Given the record (six named panels + teaching proof + guide → correct arrangement but voids/anatomy 3 of 4; one continuous field → clean artwork but no arrangement), what request shape gets both first-attempt from one `gemini-3-pro-image` call? Is there a mechanism we have not tried that is not a negative prompt, not a post-generation repair and not a second image call? Candidates we have not run: the v23 request with the one-field creative body and the RULE 0.32 sentence; the guide re-introduced as a faint tone-on-tone sheet rather than a mask; the teaching proof re-cropped to an unlabeled flat sheet in the exact v23 arrangement; explicit temperature. Each is one controlled draw. Which first, and why?
2. **Is one call the right constraint at all?** The owner's rule is one authoring call. If the developer believes six-surface first-attempt correctness is not reliably achievable from one image call with this model, say so with evidence, because that changes the product, and it is the owner's decision, not ours.
3. **Gates.** Are the proposed frame-band and structured-inspector gates sufficient to refuse the v24 class, and do they risk refusing legitimate designs (grey or silver wraps, minimalist centre surfaces)? Is running the output-class inspector on the normalized (already masked) master a mistake?
4. **Cut-out fill.** The owner has ruled it is not repair. Should it remain as a failsafe for small genuine edge defects, be demoted to forensic-only, or be removed so a holed master fails closed?
5. **Geometry inputs.** Two known gaps: the input contract carries only make/type/year/model (no cab/bed configuration; F-series Crew Cab Long Box vs Short Box differ by 17"), and 2022 F-series geometry is grounded estimation because the catalog ends at 2020/2016. Do these need closing before the creative problem, or after?
6. **Anything structural we are not seeing.** Fresh eyes on `runtime/flat-first-atlas.cjs` (large), the edge assembly, and the gate order.

## 6. How to look

- Read `CLAUDE.md` top to bottom; the rules are dated owner rulings and the status board is honest about evidence levels. Then `docs/ATLAS-ONE-FIELD-CALL1.md`, `docs/ATLAS-FIELD-RECOVERY-DRAW1.md`, `docs/ATLAS-WHEEL-WELL-ROOT-CAUSE.md`, `docs/ATLAS_ONE_ARTIFACT_GRAPH.md`, `docs/GENIE-PREP-LIFECYCLE.md`, `docs/PANEL-DATA-SLUG.md`, `docs/BEHAVIORAL-SPEC.md`, `docs/SEAM-FREEZE.md`.
- Masters to inspect (all in the `wrap-files` bucket, hashes in the tables above): `5b2eb96c` (gold, v2), `5d727ea9` and `84a3eadf` (v23), `1a0e6b70` (v24), Field Recovery Draw 1 raw master `e13b65f6…` (run `33659500846`).
- Tests: `node --test tests/*.test.mjs` in the repo root; `npm test --prefix gateway`; `node --test ops/tests/*.test.mjs`; `cd app && npx tsc --noEmit -p tsconfig.json`.
- The A/B harness `.github/workflows/designiq-ab-precision.yml` captures the complete assembled request for both prompt builders before Gemini and executes them in the live runtime image, so a conditioning argument can be settled on the request bytes, not on impressions.
- Deploy shape: `deploy-production.yml` ships web/gateway/runtime to the droplet; edge functions ship separately by `deploy-edge-functions.yml`. Check both halves before calling a SHA deployed. Migrations apply via `release.yml` on `main` only.

## 7. What not to do, learned the hard way

Rewrite creative framing to fix a pixel defect (RULE 0.1). Add negatives (the model over-indexes on the forbidden thing). Attach an installed-vehicle image as a teaching input (leaked anatomy). Trust a structural gate as a creative judgement (v17 montage, v24 banners both passed). Trust `CLAUDE.md` prose over the deployed body (the file drifts; the repo says so). Report anything as proven from the vault's flags rather than from the artifacts a fresh run produced.
