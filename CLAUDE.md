# CLAUDE.md — designproai-os

## 🎯 RULE 0.1 — TWO SEPARATE GOLD STANDARDS. DO NOT MIX THEM. (Trish 2026-08-17)

Design quality and output-pipeline correctness are judged against **different
references**. Conflating them is how a good hero render got read as "the
pipeline works", and how a working July-24 pipeline got read as "the designs
are fine".

| Layer | Gold standard | Judge |
|---|---|---|
| **Design quality / generation behaviour** | the recent **distressed Martini Porsche** job | is the design language, studio consistency and creative quality acceptable |
| **Output / production pipeline** | the **July 24** working state, `docs/LAST-WORKING-STATE-2026-07-24.md` | does the chain still produce the artifacts it produced then |

**Do not use the Porsche to infer whether the output pipeline works. Do not use
July 24 to judge current design-generation quality.**

The July-24 flow is a **regression target**, not a redesign brief:

> design approved → automatic 2D Production Proof → six correct production
> sides → RevisionStudio paired 3D render + 2D production panel per side →
> Production Layers → production pack / output path.

**If July 24 proves the architecture already worked, do not redesign it.**
Identify the smallest wiring/contract difference between then and now, and
replace only components proven defective.

### Judge the seven-view run at the artifact level, not "looks good"

A visual impression cannot tell you whether a weak design means the port is
incomplete or the inputs were empty. Record, for all seven views:

`prompt hash · prompt length · model · studio contract version ·
view-angle contract version · structured inputs actually populated ·
whether branding/phone/logo fields were present · retries · image hash`

Then the diagnosis is mechanical rather than aesthetic:

- **Quality below the Porsche baseline** → parity-diff against that exact
  stack before changing any creative logic. A short prompt or unpopulated
  structured inputs means the port or the caller is incomplete; it never
  means A.C.E. needs new creative direction.
- **Individual quality passes but cross-view identity drifts** → port
  `generate-color-render` only. Nothing else.

**Do not touch Calls 8+ during that determination.**

Once the seven-view layer is proven, switch models back to July-24 regression
for output. The question there is not "how should the pipeline work" — it is
**"what exact wiring or state difference stops today's system behaving like
July 24?"** Keeping the front-half and back-half investigations separate is
what stops the output path being treated as greenfield again.

**Where the Porsche's quality came from.** It was produced by the live
RestylePro stack — `design-panel-ai-generate` with `_shared/studio-os.ts` and
`_shared/view-angles-os.ts`. That is exactly the stack ported into
`runtime/designiq-prompt.cjs`, `runtime/studio-os.cjs` and
`runtime/view-angles.cjs`. So the design-quality baseline and the port target
are the same thing; a design that does not reach Porsche quality means the
port is incomplete, not that a new creative approach is needed.

## 🛞 RULE 0.15 — A WRAP PANEL IS A SOLID RECTANGLE. THE INSTALLER CUTS THE HOLES. (Trish 2026-08-23)

**Every A.T.L.A.S. zone, every Call 9 panel, every print file is one solid
rectangle of continuous artwork, opaque corner to corner.** The design runs
straight through the places a windshield, side window, door glass, wheel arch,
tyre, pickup-bed opening, light, handle or trim will later sit.

**The installer cuts the wheel opening and the window out of the finished
panel.** That is why the artwork has to exist there — there is nothing to cut
otherwise, and a hole in the master prints as a hole in the vinyl.

A zone that comes back as a *picture of a vehicle* — a silhouette with wheel
circles and glass shapes punched through it — is a failed master, not a stylistic
choice, **even when the hole is filled with flat colour.**

Live evidence, 2026-08-23 (Becky's Bakery, Chevy Transit Connect): the master
returned a van silhouette with black wheels and black glass, and *every*
deterministic check reported pass — because `opaqueRatio` only asks whether a
pixel is opaque, and black is opaque. Two things now stop it:

- **`runtime/flat-first-atlas.cjs`** states the rule positively (SOLID PANELS),
  because negatives make Gemini over-index on the forbidden thing. `PROMPT_VERSION`
  is `designpro-flat-first-atlas-20260824.v6`; older masters are refused, not
  migrated, and the version string is the mechanism that refuses them.

  **⛔ THE PAIRED EXAMPLE AND THE ORIGINAL PROMPT ARE RESTORED. DO NOT REMOVE
  THEM AGAIN. (Trish 2026-08-24)** A session concluded that showing Call 1 the
  finished 3D proof was what produced the wheel-arch cut-outs, detached it, and
  rewrote the prompt to say *"nothing in this canvas depicts a vehicle: no body,
  no panel gap, no door seam, no window, no wheel…"*. **That was wrong and it
  broke the design.**

  **An A.T.L.A.S. master IS a flattened top view OF A VEHICLE WRAP.** It
  legitimately carries the vehicle's panel geometry — door seams, rocker and
  hood contours, the lines an installer cuts to. The bundled Houdini example
  shows exactly that, and so did every good master this system has produced.
  Forbidding that geometry removed the very thing that makes the sheet a wrap
  layout rather than abstract art.

  The defect was never the geometry — it was **openings rendered as absent
  instead of painted through**, and that is now closed deterministically after
  authoring (see the cut-out fill below), so the teaching pair carries no risk
  worth trading design quality for. The owner's actual correction was narrow:
  the sheet must read as an **exact flattened-from-above view of ONE cohesive
  wrap**, not six designs sharing a canvas, with the livery painted straight
  THROUGH any panel line at full opacity. That is the only change v6 makes to
  the working v5 text.

  **The rule this violated: RULE 0.1 — a design below baseline means the port or
  the inputs are incomplete, it NEVER means A.C.E. needs new creative
  direction.** Rewriting the creative framing to fix a pixel defect is exactly
  the move that rule forbids.
- **`runtime/atlas-master-qc.cjs`** measures `flatBlackRatio` (near-black blob
  *interiors*, not edges) against `nonBlackFraction` — the SHARE of the zone that
  is artwork. A cutout is a minority of flat black inside a zone that is mostly
  artwork; a black wrap is mostly black. Measured on fixtures: punched
  wheels/glass = 22% flat black with 77% artwork (fails), black wrap = 90% flat
  black with 10% artwork (passes).

  **Do not use the mean brightness of the non-black pixels as the
  discriminator.** That was the first attempt and it convicts black wraps: a
  mostly-black design still has vivid accents, so the mean over its non-black
  pixels reads high. Locked by `tests/atlas-master-qc.test.mjs`, which fixtures
  all three cases.

  **Do not use the raw flat-black aggregate as the discriminator either.** That
  was the second attempt, and the first REAL master through the gate
  (2026-08-24) proved it convicts artwork: driver read 7.3% flat black across
  **3,761 components** — anti-aliased lettering interiors and shadow detail,
  average component 0.002% of the zone. A die-cut wheel is ONE shape. The
  synthetic fixtures were clean flat colours and could never produce that
  texture. The aggregate now counts only components ≥0.25% of the zone
  (`concentratedFlatBlackRatio`); a punched opening is orders of magnitude
  above that floor, so every hole fixture still convicts. Ink scattered as
  specks is design; ink concentrated in shapes is a hole.

**Do not relax either threshold to get a run through.** A master that fails this
is telling you the truth — but a *rejection no longer kills the run*: Call 1
re-rolls up to `MAX_MASTER_AUTHORING_ATTEMPTS` (3) times inside the one claimed
authoring fence, feeding the gate's own findings back as corrective direction,
exactly like the proof QC. A rejected candidate was never persisted and is not
"the design"; the fence still makes a second concurrent master impossible.

### A CUT-OUT IS A PRINT DEFECT, NOT A BROKEN DESIGN (Trish 2026-08-24)

**A cut-out must never destroy the design or its seven proofs.** The 3D proof
masks the master to the real painted body — the proof prompt says so in as many
words — so a hole where the wheel arch sits lands in the region the mask
discards anyway. The proof is unaffected *by construction*. Live proof: the
Flamingo Pools seven-view set (`DID-5B2EB96C`, prompt version `…20260822.v2`,
`masterQcPassed = null`) came out of a completely ungated cut-out master and
every one of its proofs is correct. **The hole only becomes real at the panel
cut**, where it prints as a hole in the vinyl.

Killing the whole request at authoring therefore had the blast radius exactly
backwards: it destroyed a good design, its DesignID and all seven proofs to
prevent a defect that only exists in the extracted panels. So the two failure
classes are now separated, and `deterministicMasterChecks` returns them apart:

| class | examples | consequence |
|---|---|---|
| **blocking** — a broken *design* | blank zone, no contrast, passenger not the driver's twin | fatal, exactly as before; there is nothing worth showing a customer |
| **cut-out** — a defect in the *panel* | wheel arch, glass, bed opening punched out | design and proofs survive, affected surfaces flagged |

A cut-out no longer short-circuits the semantic review — the sheet still has to
earn coherence, brief fidelity and correct lettering, because it is about to be
shown to the customer, and because the exhausted path needs a complete QC record
to persist rather than an empty one. `accepted` still means spotless, so the
loop keeps re-rolling for a clean sheet; only when all three attempts carry
cut-outs is the design kept, with `masterCutoutSurfaces` / `masterCutoutFindings`
recorded on the revision.

**Those surfaces' panels must not print until a human has seen them on a
template.** That is what `await_panelpro_preflight_qc` is for. `masterQcPassed`
stays `true` because the *design* passed; the cut-out is panel-scoped and
carried separately. Locked by `tests/atlas-master-qc.test.mjs`.

### DO NOT RE-ROLL FOR A CUT-OUT. FILL IT. (Trish 2026-08-24)

**A cut-out is never worth another authoring pass.** Re-rolling costs ~60s and
buys nothing: the proofs mask that region away, so the design is already
correct, and the panel is repaired deterministically. Spending three passes
hoping Gemini draws it solid put two minutes on the critical path *before the
customer saw a single image*. Call 1 now breaks on a cut-out's first
appearance. Re-rolls remain only for a broken **design**, where another throw is
genuinely the only remedy.

**The proofs use the authored master; the panels use a filled duplicate.**
`runtime/atlas-cutout-fill.cjs` closes each convicted hole by repeatedly
averaging its boundary pixels from the artwork they already touch, growing the
surrounding design inward from every side. Deterministic, ~100ms, no AI, **no
second producer of design**.

- The master is **never mutated** — same rule as the Call 11 de-logo set:
  duplicate, modify the duplicate, preserve the original byte for byte. It stays
  the authority the seven proofs are conditioned on and hash-bound to.
- The fill reads its mask from `atlas-master-qc.cjs`'s **own exported
  thresholds** (`CUTOUT_ALPHA_MAX`, `FLAT_BLACK_CHANNEL_MAX`,
  `MIN_CUTOUT_COMPONENT_RATIO`). Two definitions of "hole" would let the fill
  miss a shape the gate convicted, or erase artwork it never objected to.
- Master and duplicate differ **only inside the holes** — exactly the region the
  proof masks away — so proof and panel still agree everywhere either asserts
  anything. `panelSourceHash` records what the panels were actually cut from;
  it equals `canonicalMasterHash` on a clean master.
- **Mirroring is not used.** It is well defined across a straight outer edge,
  which is why the 5″ bleed uses it, and undefined across an interior hole.

It does not invent: a large hole closes as a soft continuation of its own
border, not as new design. `masterCutoutSurfaces` still records that the sheet
arrived holed, and PanelPro's human QC still sees those sides flagged. Locked by
`tests/atlas-cutout-fill.test.mjs`.

## 🖥️ RULE 0.16 — CALLS 1–7 EXECUTE ON THIS SERVER (2026-08-23)

`design-panel-ai-generate` and `generate-color-render` run **in this runtime**,
against the server key pool, behind the worker secret. The persona stack is
ported by name:

| File | What it is |
|---|---|
| `runtime/designiq-prompt.cjs` | A.C.E., ported verbatim from `supabase/functions/design-panel-ai-generate/index.ts` |
| `runtime/view-angles.cjs` | the locked seven camera angles |
| `runtime/studio-os.cjs` | studio lighting |
| `runtime/photorealism-prompt.cjs` | the photorealism lock |

`standardProviderFactoryFor()` in `runtime/generation-worker.cjs` defaults to
`createDesignPanelServerProvider`. **The Supabase Edge transport is an explicit
rollback only** — `DESIGNPRO_STANDARD_TRANSPORT=edge`. Unset, or misspelled,
resolves to the server, so Edge can never become the default again by omission.
It was the default on 2026-08-23 and cost six of seven views to
`provider_attempts_exhausted`.

**Both pipelines produce 3D proofs through that same stack.** A.T.L.A.S. makes
exactly **one** fast flattened AI call for the canonical top-view master; every
camera after it is a projection, and the panel cut is pure geometry.

## 🔗 RULE 0.17 — ONE PIPELINE. A.T.L.A.S. IS NOT A SIDE EXPERIMENT. (Trish 2026-08-23)

A.T.L.A.S. runs the **same** file-output chain as Standard. It was excluded from
the production handoff, which made it a dead end by construction: a master, six
separated surfaces, seven proofs, and then nothing to validate.

Both pipelines now reach the same idempotent handoff, behind the same seven-view
readiness check. The flat-first gate
(`designpro_flat_first_handoff_gate`) decides on **canonical-master acceptance**
(`metadata.masterQcPassed`), never on the atlas `production_eligible` column —
that column describes the atlas *layout* geometry, is false by design
(`calls-1-7-layout-only`), and production dimensions come from the GENIE manifest
at `manifest.resolve`. Conflating the two is why the gate could never open.

After purchase: `manifest.resolve` (GENIE) → `source.verify` →
`await_panelpro_preflight_qc` → `enhance.upscale` (Topaz, gated on the purchased
entitlement, skipped when unpurchased) → `output.build`.

## 🖼️ RULE 0.18 — THE THREE PRODUCTION SURFACES LIVE ON THIS SERVER

None of these may be re-implemented against `supabase.functions` or
`production_flow_assets`. They read the run through `dpApi` only, and
`tests/designpro-customer-path-seam.test.mjs` walks their whole import closure.

| Surface | Route | Module |
|---|---|---|
| RevisionStudioIQ — the product editor: design grid, seven-view carousel, GalleryMode, layered canvas, revision box, Production Layers, Logo Pack entice | `/revision-studio` | `pages/RevisionStudioIQ.tsx` + `ProductionFlowLayersCard.tsx`, sourced by `lib/revisionstudio-source.ts` and `lib/revisionstudio-flow.ts` |
| The job's server-artifact status view (NOT the product RevisionStudio) | `/designpro/jobs/:generationId` | `components/revisioniq/ServerRevisionStudio.tsx` |
| PanelPro branded studio — tool rail, canvas, seven view tabs | `/designpro/jobs/:generationId/panel-studio` | `pages/DesignProStudio.tsx` |
| PanelPro Studio board — per-side REAL DESIGN PROOF ∥ PRINT PANEL, approve side, preflight gate | `/designpro/jobs/:generationId/panelpro` | `pages/designpro/PanelProStudioBoard.tsx` |
| GENIE Universal Panelizer progress — step rail, glowing 7 sides, "when all panels glow it's a go" | `/designpro/jobs/:generationId/progress`, `/productionflow/:generationId` | `pages/designpro/GenieProgress.tsx` |

**The board is not a producer.** RestylePro's "Pull panel" / "Mirror from driver"
built panels in the browser; here Call 9 cuts them deterministically. A side with
no panel is reported as server work, never hand-patched — adding those buttons
back is the second producer the one-sanctioned-chain rule forbids.

A side **glows** on the progress page only when its Call 9 panel actually exists,
not when a view merely rendered.

## 🧞 RULE 0.19 — GENIE DEPLOYS ONLY WHEN THE PRODUCTION PACK IS ORDERED (Trish 2026-08-23)

`manifest.resolve` sits **after** `await_purchase`, never in the free entice run.
It resolves the true production dimensions and drives the progress page, and that
is paid work.

It used to sit second, in the free half, where it waits with
`wait_reason = genie_dimension_validation_required` until a human validates the
vehicle. So every run parked before the 2D proof or a single panel existed — one
sat there sixteen hours on 2026-08-23 — and **that, not a code bug, is why
RevisionStudio had no extracted panels.**

**The free half needs no validated production geometry.** Call 1 resolves the
design-time size of every side (`resolveFlatAtlasPreviewDimensions`) and cuts the
six panels to it with the 5″ bleed already in the layout. Those panels are what
RevisionStudio entices with and what PanelPro Studio is later served. That
geometry is marked `calls-1-7-layout-only` precisely because it is the design
size, not the validated production size.

Because the entice run no longer resolves GENIE, it can no longer prove a
dimension manifest — so `create_designpro_production_workflow` requires only what
that run actually proves: a completed `pack.activate` and its immutable
source/artifact identity.

A parked stage is still never reported as a running one: the gateway projects
`waiting_for_genie_dimensions` with the candidate id and the pages link to
`/designpro/genie-qc`. **Never re-map a `waiting` stage onto `running`,** and
never auto-accept grounded candidate values to clear a queue — validating
dimensions is a human judgement about a real vehicle.

## 🎨 RULE 0.20 — A.T.L.A.S. CALL 1 IS THE INITIAL DESIGN GENERATION

Not a preview. Call 1 authors the canonical flattened master **and cuts the six
print panels from it**, each stamped with that side's trim/print inches and
square footage. Every one of the seven vehicle views is a projection of that
master, and those same dimensions are sent into `design-panel-ai-generate` so
each 3D side renders at its true proportion instead of a guessed one.

An A.T.L.A.S. run is therefore orderable like any other. Hiding the Order
Production Pack button, the Logo Pack, the proof actions or the Call 8 card
behind `!isFlatFirstDiagnostic` is the dead-end framing — it was written in five
places and is locked out by `tests/atlas-fail-fast.test.mjs`.

What stays refused: per-view regeneration. One master owns the whole proof set.

## 🔀 RULE 0.21 — THE ACCEPTED MASTER FANS OUT IMMEDIATELY, TO BOTH SURFACES AT ONCE (Trish 2026-08-25)

**A.T.L.A.S. is not a pretty flattened preview. It is the production source.**
The first A.T.L.A.S. AI design generation creates the ONE flattened master and
is the design authority. The moment that master is accepted it fans out — it
does not wait for a later UI to recreate or "pull" anything:

```text
A.T.L.A.S. FIRST AI DESIGN GENERATION
one flattened master / one design authority
        │
        ├──► deterministic split by surface
        │      driver · passenger · hood · roof · front · rear
        │      exact GENIE dimensions + 5" physical bleed on every side
        │
        ├──► those SAME surface regions condition the matching 3D proof views
        │
        └──► the SAME paired artifact set, published in parallel to
               RevisionStudioIQ   AND   PanelPro Studio
```

**No side independently redesigns the wrap.** RevisionStudio does not wait for
PanelPro and PanelPro does not wait for RevisionStudio: they are parallel
consumers of one server-owned lineage, never two workflows.

The intended relationship, for all six surfaces, is one row:

> **REAL DESIGN PROOF ∥ PRINT PANEL**

Left is that surface's 3D proof. Right is the deterministic A.T.L.A.S.
extraction for that exact `surfaceKey` at GENIE dimensions + 5" bleed — **never
an upload, never an AI regeneration, never a browser-made crop.** The pair is
bound by the same `generationId`, A.T.L.A.S. revision / `masterContentHash`, and
`surfaceKey`.

| surface | purpose |
|---|---|
| **RevisionStudioIQ** | revise/edit the approved design lineage and inspect its production artifacts |
| **PanelPro Studio** | validate the exact print panels beside the real 3D proof and release them through production QC |

**Neither UI is a producer.** Do not restore `Pull panel`, `Mirror from driver`
or manual `Upload panel` as the canonical workflow — those are browser-era
producer controls, and the server already holds the panel bytes cut from the
accepted master. This whole rule is a **handoff/wiring** statement; it is not
permission to redesign A.T.L.A.S.

### The acceptance test — this is what catches a fake "wired" state

> For one fresh generation, open the same `generationId` in RevisionStudioIQ and
> PanelPro Studio. Driver proof + driver panel must carry the same A.T.L.A.S.
> parent hash; repeat for all six surfaces. **If either UI shows an empty panel,
> an uploaded replacement, a different revision, or a generated substitute, the
> wiring is not complete.**

Where this already holds, and where it is enforced: `cutCallOnePanels` splits
the accepted master by `SURFACE_KEYS` with `sharp.extract` (no AI), stamping
`surfaceKey`, `sourceMasterHash` and the trim/print inches with `bleedInches`;
`viewAuthorityFor` **throws** unless a proof's authority hashes to the master and
matches `surfaceForProofView()`; the panel artifact publishes
`metadata.sourceMasterHash` and the view publishes
`atlasBinding.masterContentHash`, so both halves carry the binding to the UI.
PanelPro compares them per side and **refuses to approve** a pair that provably
came from different masters — locked by `tests/server-revision-studio.test.mjs`.

## 🏭 RULE 0.22 — PANELPRO STUDIO IS THE PRODUCTION CONTROL ROOM, NOT A SIX-CARD VALIDATOR (Trish 2026-08-25)

**PanelPro is TWO surfaces, and confusing them is how one gets rebuilt as the
other.** The canonical contract (2026-08-24, §6) names both:

| Surface | Route | File |
|---|---|---|
| The branded studio — tool rail, canvas, seven view tabs, upload/text/logo/adjust/layers/move/scale/rotate/arrange | `/designpro/jobs/:generationId/panel-studio` | `app/src/pages/DesignProStudio.tsx` |
| The production/QC board — proof ∥ panel per side, dimensions, hashes, human preflight, downstream artifacts | `/designpro/jobs/:generationId/panelpro` | `app/src/pages/designpro/PanelProStudioBoard.tsx` |

Both are routed and both bind to the same generation. An earlier revision of
this rule named `AdminGeminiCompareStudio.tsx` as the restore target; the
canonical contract names `DesignProStudio.tsx`, and that is what is routed.
`AdminGeminiCompareStudio.tsx` is unrouted RestylePro import weight, not the
DesignProAI studio.

The board is a validator, not a second producer — but it IS the design team's
complete production workspace for one order, keyed by `generationId` · Design
Order ID / order number · Design ID (DID), and it must preserve the whole
chronological lineage.

### A.T.L.A.S. version history — every revision, never only the newest

V1, V2, V3, V4… all remain inspectable and downloadable. **Never silently
replace V1 when V2 is created.** Each revision shows: revision number · Design
ID · Design Order ID · date · exact timestamp · **the customer revision/prompt
text that produced it** · the A.T.L.A.S. master · master hash / lineage
identity · its 3D proofs · its production proof · its deterministic surface
panels.

### The complete asset set, each individually downloadable

Flattened A.T.L.A.S. master · every saved A.T.L.A.S. version · driver ·
passenger · hood · roof · front · rear panels · 5″ bleed versions · all
canonical 3D proofs · 2D Production Proof · logos / extracted branding ·
metadata + dimension sheet · panel dimensions · square footage / GENIE geometry
· production PNG · production TIFF · required production derivatives · QC and
approval metadata.

**Do not hide files behind only a final ZIP.**

### PanelPro QC is HUMAN design-team QC, not AI scoring

The team verifies each output against the **actual vehicle template** and
confirms the panel will physically fit the real vehicle. Per surface: correct
vehicle/template · correct surface · correct dimensions · 5″ bleed · correct
design/revision · proof and panel from the same A.T.L.A.S. master · graphics
aligned to the real template · text/logo placement safe · nothing important
falling into openings or cut areas · production resolution and file integrity.

### ⚠️ THE MANUAL CORRECTION PATH MUST REMAIN — DO NOT STRIP IT

**No manual/browser panel GENERATION. Yes to controlled human production
CORRECTION and upload, with lineage and audit history preserved.**

That distinction is the whole rule. `Pull panel` and `Mirror from driver` were
browser-era *producers* and stay gone — the server already holds the panel bytes
cut from the accepted master. But when a deterministic panel does not fit the
real template, the designer must be able to:

1. download the panel;
2. correct/re-output it against the real vehicle template;
3. **upload the corrected production panel back into the SAME surface/revision
   lineage**;
4. retain BOTH the original system artifact and the corrected human-approved
   artifact, for audit history;
5. mark the corrected artifact as the active production artifact;
6. click Approved only after physical/template QC passes.

An agent reading "no Upload panel" out of context will delete a required
production function. One already did: a lock in
`tests/server-revision-studio.test.mjs` forbade the string outright and had to be
corrected. Forbid *generation*, never *correction*.

**How it is wired (2026-08-25).** A correction is its own artifact kind,
`corrected-panel`, recorded by `record_designpro_corrected_panel`
(`supabase/migrations/20260825000000_designpro_panelpro_corrected_panels.sql`)
against the exact `surface_key` and revision it replaces. It carries
`correctedFromPath`, `correctedFromHash`, `sourceMasterHash`, `correctedBy`,
`correctedAt` and a required reason; a correction with no Call 9 panel to
correct is refused. The branded panel is **never touched**, so `source.verify`'s
exactly-six-distinct assertion still reads the same six rows.

`enhance.upscale` enhances the **active** artifact per surface — the newest
correction when one exists, the branded panel otherwise — and records
`humanCorrectedSurfaces` on the receipt. That is what makes the human gate real:
enhancing the panel the team rejected, while the correction sat unused in the
vault, would let the gate pass and the wrong artwork print.

### Approval → Production Pack → WrapBox

Once the human QC checks pass: freeze the approved revision and panel
identities · stamp the Production Pack Proof approved · record approver, date,
time, hashes and metadata · assemble the Production Pack · generate the
metadata/dimension sheet · ZIP the approved deliverable.

The ZIP carries at minimum the approved 3D proof set, approved 2D Production
Proof, metadata/panel-dimension sheet, approved production panels, TIFF and PNG
outputs, and the production/approval metadata — **plus any pack assets the
working implementation already supports.** After the ZIP is built and verified,
publish it to **WrapBox**, where the customer downloads it.

### Final acceptance

For one fresh generation, PanelPro Studio must show the whole lineage:

> Design Order → Design ID → V1/V2/V3… → prompt + timestamp → A.T.L.A.S. master
> → 3D proofs → 2D Production Proof → six panels → human/template QC →
> corrected upload if needed → approved Production Pack → ZIP → WrapBox

**Nothing in that lineage may be silently replaced, disconnected, or lost.**

## ⚡ RULE 0.23 — DRIVER SIDE FIRST, THEN ASK. (Trish 2026-08-25)

**The customer must not wait for seven proofs to see whether the design is
right.** A.T.L.A.S. renders Driver first and hash-verifies it before projecting
the other six, so a real look at the design exists about a minute before the set
is finished. The product asks there:

> **"Do you want to see all sides of this design, or revise it?"**

- **See All Views** reveals the remaining proofs the server is already rendering.
- **Revise This Design** opens `/revision-studio` immediately, against the same
  design lineage.

Neither button is a producer. Making the customer watch six more proofs before
they can say "change it" spends six renders on a design they have already
rejected — and a revision supersedes all of them anyway.

**What already holds, and must not be undone.** `runAtlasProofStages` runs
Driver alone, hash-verifies the accepted bytes through `hydrateDriver()`, then
projects the remaining six **concurrently** (`parallel: true`) from the same
frozen master. `waitForGeneration` polls every 2s and reveals each view the
instant it lands. Call 1 cuts the six panels deterministically before any proof
renders, so panel extraction is never on the AI critical path.

**Do not serialize the six projections to "reduce load", and do not hold a
finished artifact back for an all-or-nothing bundle.** Progressive publication is
the contract: RevisionStudio and PanelPro fill per surface as either half
arrives, and a panel appearing before its proof is correct.

Locked by `tests/server-revision-studio.test.mjs` and
`tests/designpanel-view-reveal.test.mjs`.

## ⛔ RULE 0 — OPTIMIZE FOR BEHAVIORAL PARITY, NOT ARCHITECTURE (Trish 2026-08-17)

**The screenshots in `docs/LAST-WORKING-STATE-2026-07-24.md` are the spec.**
The question is not "what is the elegant architecture?" — it is "how does the
app behave like the working product again?" Sessions burned weeks debating
design masters, surface masters, proof regions, synthetic masters and
view-vs-origin philosophy while the product behaviour stayed absent.

**Stop archaeology. Do not propose alternate manufacturing models. Do not
redesign the product.**

The operating invariant — for each of the six surfaces the system must produce
AND show: (1) an approved side proof, (2) a matched print panel, (3) a composed
2D proof sheet, (4) all six side outputs visible in the UI. The PRINT PANEL is
deterministically derived for **that same side** at GENIE dimensions with 5"
bleed — no AI re-render for manufacturing, no cross-side reuse, and passenger
mirror is an explicit operator action, never pipeline default.

Full spec, acceptance criteria, measured starting position, and the A/B session
split: **`docs/BEHAVIORAL-SPEC.md`.**

## 🔒 RULE 0.25 — DESIGNID COMPLETION CONTRACT (Trish 2026-08-17, verbatim)

> **DESIGNID COMPLETION CONTRACT**
>
> Calls 1–8 constitute the complete DesignPro design workflow for one DesignID.
>
> Calls 1–7 produce the original design and required approved views.
>
> Call 8 automatically produces the 2D Production Proof for that same
> DesignID/revision.
>
> After Call 8, the design is complete and frozen.
>
> Calls 9+ are manufacturing only and may not creatively regenerate or
> reinterpret the design.
>
> The frozen DesignID/revision is the authority for every downstream panel,
> logo asset, production file, ZIP and WrapBox delivery.

**One DesignID owns Calls 1–8.** The customer-approved DesignID/revision is
frozen after Call 8; everything after it is deterministic manufacturing of that
exact design. **No second design generation after approval. No independent
manufacturing artwork. No reinterpreting the brief downstream.**

Design cycle: Calls 1–7 create the design and all locked-angle customer views
under one DesignIQ identity → Call 8 completes the 2D Production Proof for that
accepted DesignID/revision using the same approved state and GENIE geometry.
**At that point design work is complete.** Then manufacturing:

| Call | Produces |
|---|---|
| **9** | the six extracted **branded** production panels, at GENIE geometry + 5" bleed, independent immutable hashes — this is the original production artwork, and it is never mutated again |
| **10** | logo asset registration/separation for that accepted design |
| **11** | **duplicate** the six branded panels, remove the **logos** from the **duplicates only**, and push those six `qc-panel` duplicates to PanelProStudio for human sizing/template QC |

**The hard order: Design → Extract → Separate/Register logos → Duplicate +
de-logo → PanelPro QC → Topaz → Final outputs → ZIP → WrapBox.** Topaz upscales
the *approved* panels after human/template QC passes on the de-logoed
duplicates. **No Topaz before PanelPro. No mutation of the Call 9 branded
panels, ever.**

The runtime's frozen `STAGES` list already puts `await_panelpro_preflight_qc`
before `enhance.upscale`, so that constraint holds today — do not reorder it.
Call 11 inserts between `logos.extract` and `await_panelpro_preflight_qc`.

**Two sets exist on purpose:** the branded extracted panels are the untouched
production artwork; the de-logoed duplicates are the working QC/template
validation set. **Call 11 may never overwrite or replace the branded production
panel set.**

### CALL 11 — DE-LOGO DUPLICATE SET (owner contract, verbatim)

> Input: the six immutable branded panels from Call 9.
>
> For each canonical side:
>
> 1. duplicate the exact branded panel;
> 2. remove the known logo regions from the duplicate only;
> 3. preserve the original branded panel byte-for-byte;
> 4. output six de-logoed QC panels;
> 5. bind each de-logoed panel to its source branded panel hash and surface_key;
> 6. push the six de-logoed panels to PanelProStudio for human sizing/template QC.
>
> Call 11 may never overwrite or replace the branded production panel set.

The runtime today emits no Call 11 and no duplicate stage, so **this is a real
gap against the intended product behaviour, not a numbering quibble.**

**OWNER DECISIONS — BLOCKERS CLOSED (2026-08-17). No further architecture
decision is required; implement by matching the proven RestylePro behavior.**

1. **Do not add Generation-side placement geometry** merely to implement Call
   11 — that is another seam redesign. Recover the proven RestylePro
   logo-removal/detection behavior and apply it to **Call 11 QC duplicates
   only**. Its constrained AI/logo detection **is allowed here**, because the
   output is a non-authoritative QC instrument, never production artwork.
2. **Call 11 removes logos.** A.C.E.-authored company name / contact / type
   treatment **may remain** — a phone number on a QC duplicate does not defeat
   a sizing check. **Do not expand Call 11 into general lettering/text
   removal.**
3. **`qc-panel` artifact kind approved.** Preserve the exactly-six panel
   invariant **unchanged** — never relax that assertion to make room.
4. Call 11 sits between Call 10 and `await_panelpro_preflight_qc`.
5. Topaz stays after PanelPro preflight and runs on the **authoritative branded
   production path**, never the QC derivatives.

Each `qc-panel` keeps its canonical `surface_key` and its source Call 9 hash,
and may never enter Topaz/output/ZIP as production artwork. The exact functions
to port (`locateBrandingElements`, `collapseContainedBrandingElements`,
`strictGeminiBox2d` in `restylepro-os` `worker/index.js`) and the dilation /
clamp / honest-no-op pattern that goes with them: `docs/BEHAVIORAL-SPEC.md`.

### 6A — do not fabricate separability that does not exist

**There is no authoritative pre-branding base artwork, and no session may
synthesize one.** Calls 1–8 emit a single composited raster per surface
(`proof.build:455`, `role: canonical-production-surface`), Call 9 consumes
those exact bytes (`panels.build:513`, *"Consume, never cut"*), and the
revision snapshot carries no base-artwork field. Do not erase, inpaint,
regenerate, pixel-lift, approximate a clean background, or reclassify baked-in
artwork as an overlay after the fact. That is a frozen-seam violation, not a
Manufacturing workaround.

This is a standing prohibition, not an open question. **Call 11's `qc-panel`
duplicates are not that base** — they are derived downstream from the immutable
branded Call 9 panels, are non-authoritative, are never printed, and are never
Topaz/output/ZIP inputs. They must never be relabelled as production artwork,
promoted into the output set, or allowed to overwrite Call 9.

## 🧊 RULE 0.5 — THE GENERATION ↔ MANUFACTURING SEAM IS FROZEN (Trish 2026-08-17)

Generation owns producing the approved per-side artifacts. Manufacturing/UI
owns consuming them and binding them to the production board and the
downstream deterministic flow.

**Neither session may unilaterally change the shape, naming, identity, storage
contract, or semantics of the approved side-render interface.** Manufacturing
adapts to the existing contract instead of reshaping generation output;
Generation preserves it instead of changing it for UI convenience.

**If you conclude the seam must change: STOP and report the proposed contract
change to the owner.** Do not coordinate a silent change with the other
session. Any seam change is an owner-level decision.

Frozen, by real name: `SURFACE_KEYS` / `surface_key` · content-addressed
`storagePath` in private `wrap-files` (never a URL) · sha256 `contentHash` ·
`revisionId` embedded in the path · receipt kind + `receipt_hash` ·
`source.verify`'s exactly-two-proofs / exactly-six-distinct-panels check, which
is what makes implicit mirroring impossible.

**Geometry is NOT on this seam** — dimensions resolve from the vehicle at
`manifest.resolve` via the GENIE manifest. Generation must not emit dimensions.

Enforcement points, the full frozen list, and what counts as a breaking change:
**`docs/SEAM-FREEZE.md`.**

## ⛔ RULE 1 — RESTYLEPRO IS THE REFERENCE IMPLEMENTATION. RECOVER BEFORE YOU INVENT.

**Applies to every session in this repository.** If a capability worked in
`Tdill1980/restylepro-os`, find that implementation and reuse it. Do not design
a new one.

Use restylepro-os as the behavioural and code reference for the last working
per-side manufacturing path. For every post-approval stage you touch here,
**first locate the corresponding proven implementation in restylepro-os and
compare them side by side**, then port the smallest proven behaviour that
closes the gap.

**Do not redesign** — port as-is:
per-side source binding · `proofRegion` provenance · `brandedMaster` /
`cleanMaster` relationships · deterministic side identity · GENIE geometry ·
logo separation · PanelPro handoff.

**Adapt only what the standalone boundary actually changes:**
persistence · auth · CAS/hash storage · durable stage execution · droplet and
runtime plumbing.

**Before writing code**, name the exact RestylePro file and function you are
using as the reference. If the standalone version differs, explain the delta
before you change it. If no RestylePro counterpart exists, say so explicitly —
that is what licenses new design, and it should be rare in the post-approval
half.

**Do not restore old infrastructure wholesale. Do restore the working logic.**

The goal is **working restylepro-os production behaviour inside the new
designproai-os operating-system contracts** — not new manufacturing behaviour
invented again.

Per-stage reference map (`stage_key` → RestylePro file/function), the frozen
list, and the one documented exception:
**`docs/RESTYLEPRO-REFERENCE-RULE.md`. Read it before touching a
post-approval stage.**

## 💾 A DARK DEPLOY THAT DIES ON "120 GiB FREE" IS A FULL DISK, NOT A BAD BUILD

`ops/install.sh` refuses to install below **120 GiB free on /opt**, and every
deploy attempt leaves an immutable release directory, a runtime+gateway image
pair (~730 MB) and a `/var/backups/designpro-cutover` snapshot behind. They
accumulate until the next release is starved.

The error reads `Host requires at least 120 GiB free on the /opt filesystem`
and exit code 3, in the *dark-deploy* job, **after** a green release gate — so it
looks like the change under review broke the deploy. It did not.

**The remedy is the repo's own workflow**, `disk-maintenance.yml`, dispatched
with `RECLAIM_DESIGNPROAI_DISK`. It deletes only DesignProAI-owned leftovers —
release directories and `designproai-*` images that no live `current`/`public`/
`restore` pointer references, and all but the newest three cutover backups — and
never touches the shared spool, env files, Caddy, or any non-DesignPro path.
Then re-run the failed dark-deploy job; nothing needs rebuilding.

Live on 2026-08-25: 116 GiB free blocked the deploy; the reclaim took the host
from 194 GiB used to 58 GiB, and the same artifact deployed unchanged.

## Where things are

| | |
|---|---|
| Required behaviour + acceptance criteria + session split | `docs/BEHAVIORAL-SPEC.md` |
| The frozen cross-session seam | `docs/SEAM-FREEZE.md` |
| What the working system produced (the spec, in screenshots) | `docs/LAST-WORKING-STATE-2026-07-24.md` |
| Post-approval stage dispatch | `runtime/designpro-standalone-claimant.cjs` |
| Calls 1–7 port scope and the passenger-mirror exception | `docs/CALLS-1-7-PORT-SCOPE.md` |
| What ships first and what is unproven | `docs/GO-LIVE-READINESS.md` |
| Reference checkout | `restylepro-os` alongside this repo (clone it if absent) |
