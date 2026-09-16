# A.T.L.A.S. LAYERED CALL 1 — SEAM CONTRACT

**Status: CONTRACT ONLY. No code has been written against this.**
Owner-authorized 2026-09-16 ("basically from atlas call 1 it needs layers?" ·
"always feeding ATLAS the layer and designing so its cohesive").

RULE 0.5 freezes the generation↔manufacturing seam and says a change to it is
an owner-level decision. This is that change, written down before it is built,
because the thing being changed is what Call 1 RETURNS.

---

## 1. THE ONE DESIGN DECISION THAT KEEPS THE SEAM INTACT

**The `panel` artifact does not change.** It stays exactly what it is today:
one composited, branded, flattened raster per surface, at GENIE trim + 5" bleed,
carrying `surfaceKey` and `sourceMasterHash`.

Layers are **ADDITIVE ARTIFACTS ALONGSIDE IT**, never a replacement.

That is what lets this ship without touching anything RULE 0.5 actually names:

| frozen item | changes? |
|---|---|
| `SURFACE_KEYS` / `surface_key` | **no** — still exactly six |
| content-addressed `storagePath` in private `wrap-files` | **no** — same shape, new paths under it |
| sha256 `contentHash` | **no** |
| `revisionId` embedded in the path | **no** |
| receipt kind + `receipt_hash` | **no** |
| `source.verify` exactly-six-distinct panels | **no** — it counts `panel`, and there are still exactly six |
| `source.verify` exactly-two-proofs | **no** |

Call 9 promotion, Call 11 de-logo, Topaz, `output.build`, the ZIP and WrapBox
all continue to read `panel` and are untouched. A consumer that knows nothing
about layers sees precisely what it sees today.

---

## 2. NEW ARTIFACT KINDS

Two, both additive:

| kind | what | per surface |
|---|---|---|
| `panel-base` | **Layer 0** — the full composition, edge to edge, with no lettering and no marks. Opaque. | exactly 1 |
| `panel-mark` | **Layer 1..n** — one transparent RGBA plate per discrete mark (wordmark, contact block, logo lockup), positioned to the panel's own pixel grid. | 0..n |

Both carry `surfaceKey`, `sourceMasterHash` and the `panel` hash they decompose
(`composedPanelHash`), so a layer can always be proven to belong to the panel it
came from. Neither may ever enter Topaz, `output.build`, the ZIP or WrapBox as
production artwork — same prohibition Call 11's `qc-panel` already carries.

**Composition reproduction is NOT the gate. (Corrected 2026-09-16.)**
An earlier draft of this contract called `base ⊕ marks = panel` a guarantee that
holds "by construction". It does hold -- and it proves nothing, because
`clean + (branded − clean) = branded` is algebra. It reproduces the panel even
when both layers are garbage. Do not rely on it.

**The real gate is REGISTRATION, and it is the largest risk in this design.**
The thought signature preserves reasoning and intent; it does NOT guarantee
pixel alignment. `panel-base` is a fresh render of the whole canvas, so a
two-pixel global shift or a small tonal difference is entirely possible even
with the signature replayed correctly. Subtraction does not degrade gracefully
under that -- it fails catastrophically and silently:

```
drifted base  →  branded − base ≠ 0 EVERYWHERE, not only where the marks were
              →  the "mark plate" is a ghost of the entire wrap at low alpha
```

which looks plausible at thumbnail size and is wrong at full size. That is the
same shape of defect as the `verified` receipt over a reversed passenger, and it
must be measured rather than assumed.

So before any subtraction, the base is checked against the master **outside the
regions that differ**:

| check | meaning |
|---|---|
| `alignmentOffsetPx` | best global shift between base and master, measured on artwork away from the marks. Must be **0**. |
| `residualOutsideMarks` | mean per-channel difference over the panel once mark-shaped difference components are excluded. Must be under a tolerance measured on real sheets, not guessed. |
| `markAreaFraction` | share of the panel the difference occupies. A clean plate that differs over most of the panel did not remove type — it re-designed. |

A base failing any of these is refused as `flat_atlas_layer_base_drifted`, the
node retries within its bounded budget, and the surface keeps its flattened
`panel` with no layers rather than publishing layers that are quietly wrong.
**Layers are optional; a wrong layer is not an acceptable substitute for no
layer.** This is the same disposition the finishing path already takes: a defect
that exists only in an optional derivative must never destroy the design.

---

## 3. THE GRAPH, NOT NEW ORCHESTRATION

`runtime/atlas-call1-graph.cjs` already owns dependent execution: nodes are
`{ key, dependsOn }`, validated by `validateGraph` (cycle detection, 1–40
nodes), claimed `FOR UPDATE SKIP LOCKED` by either runtime worker, leased 600 s,
heartbeated at 30 s, retried per node, and recorded in
`designpro_atlas_call1_events`. **This is a node-definition change and nothing
else.** No new runner, no new claim, no new lease, no `Promise.all` anywhere.

```
surface.<key>                      the authoring pass — UNCHANGED
      └─ dependsOn ──▶ surface.<key>.base      replays the authoring exchange
                              └── subtract ──▶ panel-mark plates (code, no call)
```

Whatever is not an edge already runs in parallel, so every surface's base node
is claimable the instant that surface completes, by both workers, up to
`DEFAULT_CONCURRENCY`. `GRAPH_CONTRACT` advances to
`designpro.atlas-call1-graph.v2-layers`.

**Honest latency statement, in the form RULE 0.35 requires.** The critical path
gains **one image call, once** — not one per surface, because the base nodes are
siblings. It lands beside the panel cut, the logo analysis and the Driver proof
that already fan out on master acceptance, so the customer-visible path
(`Call 1 → Driver proof`, RULE 0.27) does **not** lengthen. What lengthens is
the time to a complete LAYERED set, which nothing waits on.

---

## 4. HOW THE LAYERS ARE DERIVED — ONE CHILD NODE, NOT TWO

**Only the clean plate is asked of the model. The mark plates are subtracted.**

1. `surface.<key>` authors the composition exactly as today. The master is
   byte-identical to what ships now: same persona, same prompt version, same
   pinned model, same one image request. **No new refusal risk is introduced
   into authoring**, which is the whole point of deriving rather than
   re-authoring.
2. `surface.<key>.base` replays that exchange and asks for the same composition
   with the lettering and marks removed and the artwork continued behind them.
3. `panel-mark` plates are then computed in **code**: `branded − base`. Where the
   two differ, that pixel was the mark; how far they differ is its alpha. This
   is the method RestylePro's own roadmap names — *"derive the clean variant FROM
   the branded one so overlays become pixel subtraction (branded − clean)"* —
   and it is already implemented and measured in `runtime/atlas-cutout-fill.cjs`
   (`erasePanelRegions`, `LIFT_ALPHA_FLOOR`/`LIFT_ALPHA_CEILING`).

**Why not ask the model for a transparent plate.** Image models do not reliably
emit true alpha; "render on a fully transparent RGBA plate" returns type on a
field far more often than type on transparency. Subtraction gives real alpha
deterministically, costs no call, and cannot drift from the panel it came from.
It also removes the second head entirely, which removes the question of whether
two heads can be fired concurrently — they cannot, see §5.

---

## 5. GEMINI MECHANICS — FOUR THINGS THAT MUST BE RIGHT

Each of these has already cost this project or RestylePro real time.

1. **`thoughtSignature` lives on the PART, not the candidate.** The deployed
   reader proves it (`design-panel-ai-generate/index.ts`): it iterates
   `candidates[0].content.parts` and captures `part.thoughtSignature`. Reading
   `candidate.thoughtSignature` yields `undefined` on every call.
2. **The signature is replayed as a STRUCTURED FIELD on the part it arrived on**,
   inside the conversation history — never as prompt text. RULE 0.35 states it
   in those words. A signature pasted into a text part is prose: the model
   cold-starts, the spatial layout memory is gone, and **nothing errors**. It is
   the most dangerous of the four because it fails silently as drift.
3. **`responseModalities: ["TEXT", "IMAGE"]`.** `["IMAGE"]` alone suppresses text
   output and induces `finishReason: NO_IMAGE`. Documented live defect.
4. **The authoring model is the GA id `gemini-3-pro-image`** (RULE 0.16),
   measured over eleven production runs against `-preview`, which dropped the
   centre-four border median from 135–177 to 18–23. RestylePro is pinned to
   `-preview`; this repository is not, and porting its id would be a regression.

**A child head cannot be fired concurrently with its parent.** It has no
signature to replay until the parent returns, and without one it is a cold start
— which is exactly the failure (1)–(2) describe. Parallelism is available
*across surfaces*, not *within* a surface's chain.

**`thinkingLevel` stays HIGH on the base node** if the parameter is supported at
all — to be verified against the live API, not assumed. Removing type while
continuing artwork exactly and preserving everything else is the hardest spatial
task in the chain, not the cheapest.

**Temperature is not set.** RULE 0.19's parity recovery removed the explicit
`temperature` from Call 1 deliberately, because DID-2D918868 sent none. The base
node inherits that.

---

## 5A. THE PANEL CUT, AND WHO IS ALLOWED TO COMPOSITE

**The cut is unchanged and it is applied to every layer with the same
geometry.** `cutCallOnePanels` extracts by `manifest.zones` with `sharp.extract`
— pure geometry, no AI. Cutting `panel-base` and each `panel-mark` with that
same call means the cut lines, the trim box and the 5" bleed land identically
on every layer by construction, not by tolerance: it is the same rectangle
applied to aligned rasters. A mark straddling a zone boundary is split exactly
the way the composited artwork is split, because it is the same extract.

So GENIE geometry, the template, the bleed and the panel plan are untouched.
Layers change what is cut, never how.

**But the PRINT FILE is composited on the server, and only on the server.**

The `panel` artifact is authored server-side exactly as it is today and remains
the production artwork. A browser must never assemble the thing that prints.
RULE 0.21 is explicit — *"Neither UI is a producer... never an upload, never an
AI regeneration, never a browser-made crop"* — and RULE 0.18 records that
RestylePro's browser-era panel producers are precisely what this system removed.
A client-side compositor producing a print file would reintroduce them under a
new name, and a pack would then depend on which browser built it.

Client-side compositing is therefore **preview only**: the studio stacks
`panel-base` under `panel-mark`[] so Carley can toggle, drag and re-drop at
interactive speed. When she commits a change, the corrected panel is composited
and stored **by the runtime**, through the existing correction lineage
(`record_designpro_corrected_panel`), with both artifacts retained and her
reason required. The screen is where the decision is made; the server is where
the artifact is made.

## 6. WHAT THE LAYERS RETIRE

Each of these is a problem currently solved by repair, and repair on a flattened
panel has a measured ceiling (2026-09-16, `00d19df8`):

| today | with layers |
|---|---|
| move/remove text → clone fill, box seam, stray glyph fragments | hide a layer; the base was always there |
| keep the fonts → subtract from a repaired panel | the mark plate **is** the letterforms |
| passenger mirror → mirror branded pixels, paste opaque slabs | mirror `panel-base`, drop marks back forward (RestylePro's exact method) |
| Call 11 de-logo QC set | render `panel-base`. Free. |
| Logo Pack | `panel-mark`[]. Free. |
| wheel arch | **still the clone fill** — a genuine hole in the artwork is not a layering problem |

---

## 7. WHAT IS NOT DECIDED HERE

- Whether A.C.E. authors the branded master first and the base is derived (§4),
  or authors the base first and marks are typeset deterministically
  (RestylePro's `api/typeset-layer`). §4 is proposed because it preserves the
  custom lettering treatment that is part of the owner's design standard; the
  alternative costs zero extra calls and loses it. **Owner's call.**
- The studio's layer UI (toggle, drag, re-drop). It consumes this contract; it
  does not define it.

---

## 8. ACCEPTANCE

Not a green suite. One fresh A.T.L.A.S., inspected:

- [ ] the six `panel` artifacts are byte-identical to what the same request produces today
- [ ] one `panel-base` per surface, full bleed, no lettering, no marks
- [ ] `panel-mark` plates carry real alpha and the artwork's own letterforms
- [ ] base ⊕ marks reproduces `panel` on every surface
- [ ] `source.verify` still counts exactly six distinct panels and exactly two proofs
- [ ] the Driver proof lands no later than it does today
- [ ] owner's eye on a base plate: it reads as finished artwork on its own, not as a panel with holes in it
