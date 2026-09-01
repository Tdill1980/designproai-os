# A.T.L.A.S. 3D PRESENTATION RESTORATION — evidence board

Owner contract, 2026-09-01: **restore the proven legacy DesignPanelAI 3D
presentation intelligence without breaking, replacing, weakening or bypassing
A.T.L.A.S.** Executed in the owner's five-step order, Driver first.

Evidence levels are the status board's own and are not interchangeable:
**DEPLOYED-VERIFIED** (read back off the running system) ·
**CODE-LOCKED** (in the branch, covered by a named test) · **OPEN**.

---

## The diagnosis this restores against — DID-134FC3CA

Two boundaries, not four bugs:

| boundary | finding |
|---|---|
| **3D presentation** | the Driver proof CHANGED the canonical artwork; the continuity failure was detected and the proof published anyway; Driver is not operationally prioritised |
| **Call-1 acceptance** | authoring is 36.9s, acceptance is 67.8s; the authoring output contains anatomy-shaped negative space |

**The Driver/Passenger inconsistency is not coming from A.T.L.A.S.** Both
flanks carry the correct distressed treatment in the canonical master. The
proof renderer changed it. That is what makes this restoration targeted.

### §3 byte trace — all six panels clean

Every surface: `method: deterministic_atlas_crop`, `deterministic: true`,
`sourceMasterHash` = accepted master `3cf9b60d…`, 5" bleed, correct GENIE trim.
No generative AI touched any panel. No 3D proof, vehicle mask or per-surface AI
redesign is a panel source.

### §4 canvas — no unexplained transform

Raw Gemini return 4096×4096, `masterNativelyFourK: true`, accepted master
4096×4096, projection 4096×4096. No stage crops, pads, resizes or converts the
master. The 16:9 verified earlier is the **proofs** (5504×3072) — a different
artifact. The master is 1:1 by contract and always was.

### §5 which stack is actually proven

- `grep -rn "persona-photographer-render" src/` in `restylepro-os` returns
  **nothing**, and its CLAUDE.md records the persona pipeline as BYPASSED.
  Every proven render went through `design-panel-ai-generate` /
  `generate-color-render`. RULE 0.29 called the photographer "the REAL
  RestylePro stack"; on this evidence it was never the one that ran.
- `design-panel-ai-generate` carries `getCameraAngle`, `STUDIO_ENVIRONMENT`,
  **`temperature: 1.0`**, per-view aspect/resolution.
- RestylePro `view-angles-os` `VIEW_ASPECT_RATIOS` is **all `16:9`** — the
  aspect already shipped matches the pinned kernel's own table.
- **Gap, reported not changed:** `persona-photographer-render` sets no
  temperature in either branch while the legacy stack pins 1.0.

---

## STEP 1 — the restored presentation path, DRIVER ONLY

**CODE-LOCKED.**

```
design-panel-ai-generate
├── mode "atlas-artboard"  → handleAtlasArtboard          Call 1, UNCHANGED
└── mode "atlas-proof"     → handleAtlasProofPresentation presentation, isolated
```

Both discriminators return **before** the creative destructuring, so an
authoring request never reaches a line of presentation code and a proof request
never reaches a line of creative assembly. No second independent creative edge
function was created.

The words come from `_shared/atlas-proof-presentation.ts`, recovered from the
**LIBRARY PANEL branch of `restylepro-os` `generate-color-render/index.ts`**
(~line 2013) — the exact job an A.T.L.A.S. proof does: take flat 2D panel
artwork and render it installed from one locked camera angle. It is **not**
adapted from `persona-photographer-prompt.ts`. The three places it is not
verbatim are named in the module's own header: the `Panel Design:` line becomes
the contract-required ARTWORK IS LOCKED paragraph; the wheels-and-tires sentence
is added (DID-134FC3CA returned wheels with no tires); and on a pickup only, the
TRUCK BED clause is appended, sliced from `WRAP_COVERAGE_RULES` exactly as
`persona-photographer-render` already slices it.

### Two defects caught by EXECUTING the builder, not by reading it

The module was bundled with the repo's own esbuild and run against all seven
shots and all five finishes. Reading the source would have caught neither:

1. **`Finish: SATIN — SATIN — soft feathered sheen…`.** The legacy DPP table
   carried no labels ("High-gloss laminate — …") so the legacy line prefixed
   one; this table is DPAG's, whose entries already open `GLOSS — `. That is
   the exact stutter `atlasFinishSpec()` exists to stop on the Call-1 side.
   Matching on the finish NAME is not enough — `brushed` selects
   "BRUSHED METAL — ", which a name-based strip leaves as
   `BRUSHED — BRUSHED METAL — `. The label the table itself wrote is detected
   and left to stand.
2. **~900 characters of duplicated coverage rules.** The first draft embedded
   the whole `WRAP_COVERAGE_RULES` block above the legacy one-line coverage
   sentence. Fifteen of its sixteen lines restate that sentence; only the TRUCK
   BED clause is new. Prompt length degrades Gemini output, and this is exactly
   how the 13K reconstruction RULE 0.29 convicted grew — one clause at a time.

Assembled prompt sizes after both fixes: **3,990–5,113 chars** across the seven
shots (`STUDIO_ENVIRONMENT` alone is ~1.3K and the owner ordered it restored, so
the band is a consequence of the recovered stack, not drift). Both defects and
the size band are locked by executing tests, not source greps.

Carries: `getCameraAngle()` · view-specific framing · `STUDIO_ENVIRONMENT` ·
finish/material · 16:9 / 4K · `temperature: 1.0` · complete factory geometry
including wheels **and tires**.

Does not carry, and a test convicts each: designer identity · elevation ·
`COMMERCIAL_TRANSLATION` · `COMMERCIAL_DEPTH` · design translation · VisionBoard
· logo architecture · design-name request · the brief.

Two deliberate differences from the photographer path, both owner-specified:
**temperature 1.0 is stated** rather than inherited from a model default, and
there is **no Flash fallback** — a proof rendered on a different model than the
one this product is judged on is not evidence, and this restoration is being
measured. Retries stay on the GA id and the panel rides every attempt.

Routing: `ATLAS_PRESENTATION_RESTORED_SHOTS = new Set(["side"])`. The other six
shots are untouched on `persona-photographer-render`, so a regression is
contained to one view and reverted by emptying that set.

### Byte-identity proof — the owner's safety amendment

`scripts/atlas-call1-regions.mjs` slices each named Call-1 region by brace
matching and hashes it. Before and after every edit in this change:

| sha256(16) | region |
|---|---|
| `95698ac404b5fd4b` | `const ATLAS_ARTBOARD_AUTHORING_MODEL` |
| `5932f748504f5a52` | `const ATLAS_ARTBOARD_PROMPT_VERSION` |
| `522ab87bcf962a7a` | `const ATLAS_ARTBOARD_SOURCE_COMMIT` |
| `1ea38308155d58aa` | `const ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES` |
| `619048b12eda5b39` | `function atlasFinishSpec` |
| `6f620a66247fd0a6` | `function buildDesignIQPrompt` |
| `393242f3d54605b9` | `async function handleAtlasArtboard` |

Prompt assembly, multimodal input assembly, topology input, teaching-proof
handling, model/config and acceptance logic are inside those regions and are
therefore **byte-identical**. Shared creative dependencies, unchanged:
`studio-os.ts 7b02814bb1e9e867` · `view-angles-os.ts 8890be50c124a2c5` ·
`persona-photographer-prompt.ts b7d3da05e6d0aac0` ·
`model-config.ts 5a90cd8e750b596d`. `persona-photographer-render/index.ts`
untouched.

Locked by `tests/atlas-proof-presentation-branch.test.mjs`.

---

## STEP 2 — a continuity failure becomes actionable

**CODE-LOCKED.**

```
atlasContinuityContract: fail
  → candidate cannot publish
  → exactly ONE proof-only re-render
  → still fail → stop that proof
```

Only an explicit `fail` blocks. `uncertain` is the reviewer hedging and stays
advisory — the owner's ruling names `fail`, and convicting on hedging is the
same class of error as blocking on a lighting critique. Studio lighting,
framing, camera and every other photographic contract remain **advisory**.

The budget is counted in the validator (constructed once per proof slot), and
the second verdict is `terminal: true`; `generation-engine` breaks the slot loop
on a terminal verdict rather than spending the transport budget re-rolling a
question the inspector has answered the same way twice. A re-render is
proof-only: same hash-bound canonical panel, same camera contract, plus the
inspector's findings as a correction that explicitly forbids redesigning
artwork. **Call-1 artwork is never changed to compensate for a proof failure.**

Locked by `tests/atlas-proof-qc.test.mjs` — blocking, the one re-render, the
terminal stop, the correction wording, and the uncertain-stays-advisory case.

### Lineage now accepts two producers, as matched sets

`assertAtlasViewLineage` accepts `persona-photographer-render` /
`edge-photographer` / `designpro.atlas-photographer-proof.v1` **or**
`design-panel-ai-generate` / `edge-designpanel-presentation` /
`designpro.atlas-proof-presentation.v1` — each only as a complete set. Widening
it to "any of these strings" would let a half-migrated provider stamp one
producer's stage beside another's contract and still clear lineage, which is the
drift the assert exists to catch. Five cross-mixed pairs are fixtured and
refused.

This is a second producer of **presentation**, never of artwork: both take the
same hash-bound canonical Call-1 panel as their sole artwork authority.

---

## STEP 3 — account for the whole Call-1 tail

**OPEN.**

```
authoringMs      36,887      deterministicMs   5,861
repairMs          6,076      normalizeMs       3,938
panelExtraction   2,243      uploadWait        1,251
projection          639      viewAuthority       338
                 = 57,233 of 67,811   →  10,578 UNATTRIBUTED
```

Gemini is already inside target at 36.9s; the ~31s tail is the latency bug.
Instrumentation only, no behaviour change. Target: acceptance and panel release
by 45–50s, which with a ~38s render puts Driver at roughly 83–88s.

---

## STEP 4 — Driver priority as real execution policy

**OPEN.** Acceptance criterion is the recorded inequality
`driver_dispatch_started < any_sibling_dispatch_started`, with the Driver call
already accepted by the provider before any sibling starts. "It dispatched 5 ms
earlier" is not a pass.

`projectionMs` was 639ms, so the projection is not the barrier; the candidate is
`panelPersisted`. Step 3's spans settle it.

**CLAUDE.md RULE 0.23 is stale** — it claims `hydrateDriver()` gates the set;
that function is never called. Correct the rule to the code.

---

## STEP 5 — trace the 21% flank cut-outs

**OPEN — report only, no repair heuristic.**

Origin is already established: `opaqueRatio: 1` on every zone means there is no
transparency anywhere, so the voids are **opaque black pixels Gemini painted
into the Call-1 output**. They are not punched by repair, mask, proof rendering
or any derivative — `normalizeAtlasMaster` masks only gutters outside the zones
and cannot create in-zone black.

| surface | edgeHole | flatBlack | largest shape | components |
|---|---|---|---|---|
| passenger | 0.311 | 21.8% | **11.2%** | 784 |
| driver | 0.306 | 21.3% | **10.7%** | 1182 |
| front | 0.061 | 11.7% | 3.3% | 278 |
| hood | 0.023 | 1.1% | 0.3% | 308 |
| rear | 0 | 0.6% | 0.1% | 349 |
| roof | 0 | 0% | 0% | 0 |

Each flank carries ~3 large shapes totalling 21% — arches plus glass — while
roof is perfectly clean. Flank-specific, in the authoring output. Both flanks
sit at `edgeHoleRatio` 0.31 against the 0.35 blocking threshold: they nearly
failed outright. Remaining work is to identify the authoring stage responsible
and report it. **No Call-1 conditioning change without owner approval.**

---

## Gates

1. ~~steps 1+2 together, Driver only~~ — **code complete, suites green**
2. **NEXT:** Driver validated against its canonical panel on a live run — same
   distressed treatment, correct vehicle, wheels **and tires**, no redesign
3. step 3 instrumentation → read one run → step 4 with numbers
4. **Passenger only after Driver passes**; then the remaining five; then full
   fan-out
5. step 5 reported

Suites at the time of writing: 387 / 622 / 64 / 8 / 57, web 8, app 81 — all
green. A green suite is not a rendered proof; gate 2 is a live run.
