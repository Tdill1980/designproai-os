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

## STEP 1 — SUPERSEDED BY THE CANONICAL 3D PROOF CONTRACT (owner, 2026-09-01)

Owner: **"recover the legacy rendering capability, not the legacy prompt
complexity."** The first attempt restored the legacy *words* and hosted them in
`design-panel-ai-generate`. Both halves of that were wrong, and a live run
proved it:

- the recovered prompt still enumerated design attributes ("colors, patterns,
  graphics, composition, lettering, **weathering** and surface treatment"),
  which is a second interpretation channel competing with the panel;
- `design-panel-ai-generate` could not physically carry a 5.20 MB panel.
  `DID-1F7B7BB4` Driver: four attempts, `Memory limit exceeded`, HTTP 546, each
  dead in 2–3 s **before reaching Gemini**. No Driver proof was ever rendered.

### The contract now

```text
OS AUTHORITIES          Vehicle · Surface · Camera · Studio · Lighting
ARTWORK AUTHORITY       the canonical A.T.L.A.S. surface panel
MODEL INSTRUCTION       three fixed sentences, identical for every proof
```

> Apply the supplied canonical wrap panel exactly to its corresponding surface
> on the specified vehicle.
>
> The supplied panel is finished, locked artwork. Preserve it exactly.
>
> Render the wrapped vehicle as a photorealistic automotive photograph using
> the supplied camera, studio, and lighting anchors.

Nothing from Call 1's creative brain follows it downstream: no customer brief,
designer persona, A.C.E. language, translation, amplification, logo/colour/
composition direction, distress direction, VisionBoard, or design-name request.
`studio-os` and `view-angles-os` stay byte-pinned and are CONSUMED, never
restated — they are deterministic presentation anchors, not creative prose.

**Multimodal parts order:** `[0]` the canonical panel as `inlineData`,
sha256-verified on arrival and riding every attempt; `[1]` the text above.
One image, one text part, one image request.

### Measured, not estimated

| shot | OLD deployed | OLD recovered-legacy | NEW anchors |
|---|---|---|---|
| side | 3,371 | 4,624 | **3,222** |
| passenger-side | 3,617 | 5,113 | **3,468** |
| hood_detail | 3,245 | 4,374 | **3,096** |
| front | 3,067 | 4,017 | **2,918** |
| rear | 3,053 | 3,990 | **2,904** |
| roof | 3,057 | 3,998 | **2,908** |
| close-up | 3,576 | 5,102 | **3,495** |
| **mean** | **3,284** | **4,460** | **3,144** |

**Length is not the win, and saying otherwise would oversell it.** Both the old
and new prompts are dominated by the two anchors the owner keeps —
`STUDIO_ENVIRONMENT` (1,927) plus the view angle (~500–900). The instruction
itself is 299 characters.

The win is WHAT was removed. The deployed prompt carried a labelled prose slot,
`THE WRAP DESIGN (already installed on the vehicle):`, and then:

> COLOR FIDELITY — CRITICAL: Colors must be RICH, VIBRANT, and FULLY SATURATED
> — **exactly as described above.**

That sentence makes the PROSE the colour authority rather than the panel, which
is the exact mechanism by which a proof can drift from its artwork. It is gone,
along with the design slot that invited prose into it.

### Where it lives now

- `_shared/atlas-proof-presentation.ts` — the contract, executed by tests.
- `persona-photographer-render` builds it for all seven shots. It already
  carries 5 MB panels in production; that is what the OOM'd branch could not do.
- `design-panel-ai-generate` is **byte-identical to `fa3fc4a8`** — the state
  before this work began. It is pure Call-1 authoring again.
- The wire contract `designpro.atlas-photographer-proof.v1` is UNCHANGED, and
  deliberately: the database fence
  `designpro_private.flat_first_atlas_view_set_valid` (migration
  `20260828100000`) hardcodes that string, so bumping it would make the fence
  refuse every proof and no seven-view set could validate. The prompt identity
  rides additively as `promptContract` / `proofPromptContract`.

### Two judgment calls, stated so they can be overruled in one word

- **Dropped** the wheels-and-tires sentence — it is prose. If tires come back
  missing, that is the cause and it is one line.
- **Kept** `FINISH` and the pickup `COVERAGE` clause as STRUCTURED OS inputs,
  not prose. CLAUDE.md v19 requires the customer finish to ride through so the
  master and its proofs describe the same material; RULE 0.0 requires the bed
  exclusion, which the owner asked for by name in PR #278.

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
