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
  is `designpro-flat-first-atlas-20260826.v9-dpag`; older masters are refused for
  NEW authoring/regeneration only, never migrated — and never hidden: existing
  generations stay readable/viewable/downloadable on every read surface
  (owner protection #1, locked by `tests/atlas-historical-read.test.mjs`).

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

**BOTH halves use the filled duplicate — the proofs too. (Corrected 2026-08-26.)**
`runtime/atlas-cutout-fill.cjs` closes each convicted hole by repeatedly
averaging its boundary pixels from the artwork they already touch, growing the
surrounding design inward from every side. Deterministic, ~100ms, no AI, **no
second producer of design**.

This section used to read *"the proofs use the authored master; the panels use a
filled duplicate"*, justified by "the two differ only inside the holes, which is
precisely the region the 3D proof masks away." **Production canary
`6667efac-6d62-4e8f-bf3c-39aa805ed352` (2026-08-26) disproved that with a
measurement.** Driver and passenger each came back with **26.7% of the zone
punched out across four components** — a vehicle silhouette, not a wheel arch.
The proof QC is handed that exact surface crop as "the sole artwork authority",
and refused every view conditioned on it, verbatim:

> "The candidate proof shows a Ford F250 Crew Cab truck, but the authority image
> shows a cargo van."  — `side`, and the same finding on `passenger-side` and
> `close-up`

Three of seven proofs survived, and they were the three whose surfaces had the
smallest cut-outs or none. Meanwhile the repaired duplicate — a solid rectangle
of continuous livery — sat unused by the proof half.

So `projectionDerivative` and `buildViewAuthorities` now take
`surfaceSourceBytes`, the same bytes `cutCallOnePanels` takes. **On a clean
master nothing changes at all**: the fill returns the same buffer, so the
projection and all six surface crops are byte-identical to before. This is also
what RULE 0.21 already states — *"those SAME surface regions condition the
matching 3D proof views"*.

**`sourceMasterHash` is LINEAGE, not provenance.** A panel publishes the
CANONICAL master hash, because that is the identity PanelPro pairs it with its
proof by; the repaired sheet it was actually cut from is recorded separately as
`surfaceSourceHash` (and on the revision as `panelSourceHash`). Publishing the
repaired hash as the lineage made a correct pair report *"the proof and the panel
came from different masters"*. Locked by
`tests/atlas-repaired-sheet-conditions-proofs.test.mjs`.

- The master is **never mutated** — same rule as the Call 11 de-logo set:
  duplicate, modify the duplicate, preserve the original byte for byte. It stays
  the persisted lineage identity (`canonicalMasterHash`, the revision's
  `master_content_hash`, every UI binding); the repaired duplicate is what both
  the panels and the proofs are derived from.
- The fill reads its mask from `atlas-master-qc.cjs`'s **own exported
  thresholds** (`CUTOUT_ALPHA_MAX`, `FLAT_BLACK_CHANNEL_MAX`,
  `MIN_CUTOUT_COMPONENT_RATIO`). Two definitions of "hole" would let the fill
  miss a shape the gate convicted, or erase artwork it never objected to.
- Master and duplicate differ **only inside the holes**, and both halves of the
  fan-out read the duplicate, so proof and panel agree everywhere either asserts
  anything. `panelSourceHash` records what the panels were cut from and the
  proofs were conditioned on; it equals `canonicalMasterHash` on a clean master.
  It is **not stored as bytes** — `fillMasterCutouts` is deterministic, so a
  resumed revision rebuilds it and `flat_atlas_surface_source_mismatch` refuses
  a rebuild that no longer reproduces the recorded hash.
- **Mirroring is not used.** It is well defined across a straight outer edge,
  which is why the 5″ bleed uses it, and undefined across an interior hole.

It does not invent: a large hole closes as a soft continuation of its own
border, not as new design. `masterCutoutSurfaces` still records that the sheet
arrived holed, and PanelPro's human QC still sees those sides flagged. Locked by
`tests/atlas-cutout-fill.test.mjs`.

## 📸 RULE 0.29 — THE 3D PROOF STACK IS THE REAL RESTYLEPRO STACK, PINNED (Trish 2026-08-27)

For every extracted A.T.L.A.S. panel, the proof producer is the REAL RestylePro
photographer stage — not a new generic renderer. Sources, at
`restylepro-os@113d137dbe8813ca3bf70c8d7265ad081ebd4524`:

| role | file | pinned sha256 (16) |
|---|---|---|
| 3D proof producer | `supabase/functions/persona-photographer-render/index.ts` | `7aefea1f1b8ca899` |
| prompt builder | `supabase/functions/_shared/persona-photographer-prompt.ts` | `11cb76524211e42a` |
| camera, framing, frame-fill | `supabase/functions/_shared/view-angles-os.ts` | `8890be50c124a2c5` |
| studio **and lighting** | `supabase/functions/_shared/studio-os.ts` | `7b02814bb1e9e867` |

All four are byte-identical to the pin, asserted by
`tests/proof-stack-pinned-sources.test.mjs`.

- **`view-angles-os` owns camera angle, framing and frame-fill.**
- **`studio-os` owns the studio environment AND the lighting** — the LED strips,
  daylight balance, reflections, wall/floor treatment, and the requirement that
  the studio stay identical between views. **Do not invent studio or lighting
  prompts in the server runtime.** The runtime consumes `STUDIO_ENVIRONMENT`; it
  never restates it.
- **HERO IS REMOVED (owner, 2026-08-27).** `view-angles-os` had drifted from the
  pin by one added `hero-3d` shot; it is restored to the pinned bytes and the
  plan is the canonical seven views. The runtime keeps its legacy `hero-3d` →
  `hero3d` READ mapping so historical generations stay viewable (owner
  protection #1) — that is a read path, not a plan entry, and it is not a licence
  to render one.

**Adapt, do not restore blindly.** The pinned photographer describes a
historical six-shot sequence and an old `heroRenderUrl` continuity dependency.
Keep its photographer/studio/view-angle logic; replace the artwork authority
with the matching extracted A.T.L.A.S. panel for the requested `shotKey`, and
drop the hero-first dependency. Per surface:

`driver panel → shotKey driver` · `passenger panel → passenger-side` ·
`hood panel → hood` · `front panel → front` · `rear panel → rear` ·
`roof panel → roof` · `close-up → the correct selected surface/detail authority`

**The extracted panel is ARTWORK authority. The photographer/view/studio stack
is PRESENTATION authority only.** Every output must persist `generationId`,
`atlasRevisionId`, `sourceMasterHash`, `surfaceKey`, the source panel artifact
id + hash, and `shotKey`, so both UIs can prove a proof came from its matching
panel.

## 📐 RULE 0.28 — THE ARTBOARD IS LABELED CONTAINERS AT GENIE DIMS + 5″ BLEED, FILLED EDGE TO EDGE, WITH NO BODY LINES (Trish 2026-08-27)

Owner, verbatim: **"ATLAS FLATTENED TOPO VIEW CONTAINER MUST HAVE LABELED
CONTAINERS AND GENIE DIMS WITH 5\" BLEED — ATLAS FILLS FLATTENED TOP DESIGN
WITHOUT BODYLINES FILLED TO RECTANGLE CONTAINER EDGES."**

1. **Sizes come from the GENIE Panelizer catalog**, `vehicle_dimensions` (1781
   measured rows, migrated 2026-08-27). `resolveFlatAtlasPreviewDimensions`
   reads it FIRST. The class-constant estimator
   (`provisionalDimensionsFromCandidate`) is only what happens when the catalog
   has never seen the vehicle. Measured cost of not doing this: GENIE has the
   F-250 Super Duty Crew Cab side at **251×60**; the estimator produced
   **153×56** — ninety-eight inches short, on every container.
2. **The guide IS the artboard.** Labeled rectangles, true GENIE panel
   dimensions, 5″ bleed already included. The model paints inside them.
3. **Filled edge to edge.** Artwork runs off all four sides of its rectangle.
   No blank margin, white gap, letterboxing, rounded corner, frame or border.
4. **NO BODY LINES.** No door seams, panel gaps, rocker or hood contours, wheel
   arches, windows, glass, lights, handles, bumpers or vehicle silhouette. The
   artwork paints straight THROUGH every place one would sit.

### ⚠️ THIS NARROWS RULE 0.15, BY THE OWNER'S OWN DECISION — DO NOT "RESTORE" IT

RULE 0.15 says an A.T.L.A.S. master legitimately carries the vehicle's panel
geometry (door seams, rocker and hood contours) and warns loudly about a session
removing that to chase a pixel defect. **That warning still stands for a
session. It does not bind the owner, and she has now decided the opposite on
this one point (2026-08-27), looking at the live output.** Holes were already
forbidden; seams, contours and arches are forbidden now too, because a line
drawn on the master prints as a line on the wrap.

Everything else in RULE 0.15 is unchanged: a panel is still one solid rectangle,
still opaque corner to corner, and a zone that returns a picture of a vehicle is
still a failed master.

5. **Unwrapped regions are masked by CODE, never drawn by the model.** Owner:
   *"masked truck bed must not have any wrap design."* A pickup's bed opening
   carries no vinyl — but asking the model to leave a hole for it reintroduces
   exactly the cut-out class RULE 0.15 convicts, with soft edges and invented
   placement. The model fills the whole rectangle; geometry applies the mask
   deterministically afterwards.
6. **Every 3D proof is built from that side's EXTRACTED PANEL, and nothing
   waits.** Owner: *"ALL 3d from extracted panels — no waiting. Individual
   panels fed to 3d sides and duplicated, put in RevisionStudioIQ alongside 3d
   proofs and in PanelPro with all upscaled assets."* `panel(surface) → 3D
   proof(surface)` the moment that panel is cut. `buildViewAuthorities` /
   `viewAuthorityFor` must hash-bind to the persisted Call-9 panel rather than
   to a fresh crop of the master — same strictness, pointed at the artifact the
   customer actually buys. Each panel is then duplicated and published without
   waiting for the set: RevisionStudioIQ beside that side's proof, PanelPro with
   the upscaled assets.

### THE SHELL IS THE OWNER'S TOPO SHEET (Trish 2026-08-27)

Spec: **"A.T.L.A.S. FLATTENED – TOPO TOP VIEW · SINGLE SOURCE MASTER · SIX
DETERMINISTIC PANELS · 1:1 TOPOLOGY"**. The shell renders exactly that:

- **Centre column reads ROOF → HOOD → FRONT → REAR from the top.** `CENTER_ORDER`
  IS the layout; the panels follow `manifest.zones`. It was rear/roof/hood/front,
  a physical front-to-back unroll — correct as geometry, not what the sheet draws.
- **Two rectangles per container.** Outer = the container (structural). Inner
  **dashed blue** = the printable area, the exact panel crop, drawn at `zone.trim`
  — the box `trimRectangle()` has always computed inside the 5″ bleed.
  `cutCallOnePanels` still crops the full container; the dash is what the model
  fills corner to corner and runs past.
- **Every container captioned** with its name, `Surface ID: XX`, `W: n px`,
  `H: n px`, upright, level with the container.
- **Faint top-view vehicle silhouette + grid** under everything, so the sheet
  reads as topography rather than three columns of boxes.
- **Header band + footer** (`ATLAS MASTER SHELL · 4096 x 4096 px · TOPOLOGY VIEW ·
  NOT PRINTABLE`), both in the canvas margin.

**Why the captions are beside the containers and not on them.** The sheet draws
them inside a generous structural border. Real GENIE geometry has no such border:
5″ of bleed on a 251″ flank is ~70px on the 4096 canvas, so four stacked lines
render at 10px — a smudge, not a label. The room that exists is the gutter, which
carries the same four lines upright at ~28px.

**⚠️ THE GUARD NOW PROTECTS `zone.trim`, NOT THE WHOLE CONTAINER. DO NOT WIDEN IT.**
`renderAtlasAuthoringGuide` used to throw on any `<text>` at all. That was a proxy
for the 2026-08-25 `artifactFreeContract` deaths, and the proxy was wider than the
defect: what came back painted was a surface name centred **ON** the area the model
was told to fill. The paint area is the dashed trim box. Every `<text>` must
declare an x/y anchor (`flat_atlas_authoring_guide_text_unlocatable` otherwise) and
every anchor must lie outside every `zone.trim`
(`flat_atlas_authoring_guide_contains_text`). A caption is also physically unable
to reach a customer: the master is masked to the zone rectangles and each panel is
finished to trim.

Contract `atlas-artboard-designiq.20260827.v5`, folded into the Call-1 `promptHash`
so masters authored against the old shell are not reused. `PROMPT_VERSION` stays
`designpro-flat-first-atlas-20260827.v10-edge` — **no migration cutover.**

### SUPERSEDED — the gutter-caption form (2026-08-27, earlier the same day)

Owner, looking at the live master: **"You almost had it just fix so it's a true
topography flattened view labeled containers"**, against a spec sheet reading
*A.T.L.A.S. FLATTENED – TOPO TOP VIEW · SINGLE SOURCE MASTER · SIX
DETERMINISTIC PANELS · 1:1 TOPOLOGY* with every container carrying its Surface
ID and its W/H in pixels.

**The topology was already right.** `buildAtlasManifest` has always produced
passenger flank as a tall left column, a centre column running vehicle-rear to
vehicle-front, driver flank as a tall right column. What the ARTBOARD lacked
was identity: the copy handed to the authoring model carried geometry and
nothing else, so six unnamed grey rectangles had to be mapped onto six names
carried separately as prose.

So both guides now caption every container — `DS · DRIVER`, its pixel size, its
GENIE inches + 5″ bleed — plus the topo title band, and the Call-1 panel list
carries the same Surface ID and placement (`DS — DRIVER SIDE — tall column down
the RIGHT edge — 251" x 60"`) so the list and the sheet name the same rectangle.

**⚠️ THIS NARROWS THE "NO TEXT AT ALL" GUARD, DELIBERATELY. DO NOT WIDEN IT BACK.**
`renderAtlasAuthoringGuide` used to throw on ANY `<text>`. That was a proxy for
the 2026-08-25 `artifactFreeContract` disaster, and the proxy was wider than
the defect: what came back painted was a surface name centred **ON** the
rectangle the model was told to paint. A caption in the empty gutter is a
different object, and it is safe twice over — no glyph is inside a paintable
rectangle, and `normalizeAtlasMaster` masks the delivered sheet to the zone
rectangles (`activeZoneMaskSvg`), so anything painted in a gutter is discarded
before a master exists. The margin is structurally unprintable.

The guard is therefore **positional**, and still fail-closed: every `<text>`
must declare an x/y anchor (`flat_atlas_authoring_guide_text_unlocatable`
otherwise) and every anchor must lie outside all six zones
(`flat_atlas_authoring_guide_contains_text`). The prose telling the model what
NOT to paint still never reaches it — that footer stays on the human map only.
Locked by `tests/atlas-authoring-guide.test.mjs`, whose fixture is now built by
the real `buildAtlasManifest` rather than hand-placed rectangles.

Enforced by `tests/atlas-artboard-edge-call1.test.mjs` and
`tests/genie-catalog-sizes.test.mjs`. Contract version
`atlas-artboard-designiq.20260827.v4` — it is folded into the Call-1
`promptHash`, so masters authored against the unlabeled artboard are not
reused. The DB-pinned `PROMPT_VERSION` is unchanged at
`designpro-flat-first-atlas-20260827.v10-edge`, so this needs no migration
cutover. Items 5 and 6 are SPECIFIED, not yet
built — see `docs/ATLAS_ONE_ARTIFACT_GRAPH.md` §2.

## 🧬 RULE 0.27 — ONE ARTIFACT GRAPH. CODE OWNS THE ARTBOARD; A.I. OWNS THE DESIGN. (Trish 2026-08-27)

**Full directive: `docs/ATLAS_ONE_ARTIFACT_GRAPH.md`. Read it before touching
RevisionStudioIQ, PanelPro Studio, panel extraction or the proof fan-out.**

The owner proved the pipeline is still split, from the product's own screens:
PanelPro reported **Print panels 0/6** while RevisionStudioIQ showed images in
its Production Pack column; PanelPro reported **3D proofs 8/7**; a roof proof
existed in one surface and was reported missing by another. Three numbers about
one design that cannot all be true.

> "Your intended architecture was one source → duplicate publication, whereas
> the current implementation has become one source → several independently
> reconstructed representations."

Three rules follow, and they are architectural, not cosmetic:

1. **HARDWIRE THE ARTBOARD SHELL.** Gemini must not be responsible for drawing
   the A.T.L.A.S. containers. Code/GENIE deterministically builds the six
   labeled rectangular surface containers, their real GENIE proportions,
   positions, surface IDs and the master canvas — the Houdini PANEL LAYOUT
   topology. DesignPanelAI then authors ONE cohesive wrap INSIDE those defined
   interiors in ONE Call 1. **The A.I. owns the design; the code owns the
   geometry.** Still one source design, still one authoring call.
2. **THE MASTER FANS OUT IN PARALLEL, IMMEDIATELY.** Panels (+5" bleed), asset
   extraction, and the Driver proof all start on master acceptance. The
   user-facing critical path is ONLY `Call 1 → Driver proof`; on "See All
   Sides" the remaining six render concurrently. Panels and logos are never
   behind the proof set.
3. **ONE LINEAGE, PUBLISHED TWICE — NEVER RECONSTRUCTED TWICE.** The SAME
   persisted artifacts go to RevisionStudioIQ and PanelPro Studio. No separate
   RevisionStudio panel producer, no client-side crop, no preview standing in
   for a production panel. **Neither UI may synthesize its own representation of
   a missing canonical artifact** — a missing panel is reported missing.

Acceptance: one fresh generation showing 1 master at 4096×4096, 6/6 persisted
panels with 5" bleed, extracted assets, Driver first, 7 canonical proof slots,
both UIs populated FROM THE SAME ARTIFACT IDS, all bound to one `generationId`
/ `DesignID` / `atlasRevisionId` / `masterContentHash`. **Do not report READY
while either UI is synthesizing a missing artifact.**

Status 2026-08-27: §1 and §2 are NOT built; the five data contradictions in §4
of the doc are diagnosed, not fixed. Design quality is a SEPARATE failure and a
graph fix is never licence to rewrite the creative prompt (RULE 0.1).

## 🎯 RULE 0.26 — ONE CANONICAL CALL 1: THE REAL EDGE FUNCTION EXECUTES THE PERSONA BRAIN (Trish 2026-08-27, supersedes the 08-26 vendored-bridge form)

**Owner directive (PASTE_TO_CLAUDE.md, 2026-08-27): "Call 1 must execute through
the actual deployed `supabase/functions/design-panel-ai-generate/index.ts` …
For its ATLAS/artboard mode, import and execute the real `buildDesignerPrompt`
from `../_shared/persona-designer-prompt.ts`. Do not reproduce its words in
another runtime file." Behavioral authority = the pinned edge functions from
`Tdill1980/restylepro-os` @ `113d137…` (persona-csr-enrich,
persona-designer-generate + persona-designer-prompt.ts,
persona-photographer-render, logopro-*, studio-os, view-angles-os,
artboard-template-os) — the working creative stack the source audit
(`SOURCE_AUDIT/WORKING_DESIGN_PIPELINE_EDGE_FUNCTIONS.md`) identifies.**

How it is implemented — DO NOT re-split it:

- `design-panel-ai-generate` (deployed on this project) is the SOLE Call-1
  network endpoint: `mode: "atlas-artboard"` dispatches to
  `handleAtlasArtboard`, which makes exactly ONE Gemini image request and
  returns the flattened master + full provenance (requestId, functionName,
  sourceCommit, promptVersion `atlas-artboard-persona.20260827.v1`, model,
  imageRequestCount, masterSha256).
- The prompt assembly is ONE canonical module,
  `supabase/functions/_shared/atlas-artboard-prompt.ts`: it EXECUTES the real
  `buildDesignerPrompt` (never re-types it), swaps ONLY the presentation tail
  (studio scene, side camera, on-vehicle photo lines) for the flat-master
  output contract via exact-match throw-on-drift replacements, and appends the
  owner logo contract (LOGO_REQUIREMENT + typeface-is-not-a-logo) and contact
  lock (no invented phone/website) — byte-locked against
  `runtime/designiq-prompt.cjs` so the two homes cannot drift.
- `runtime/flat-first-atlas.cjs` assembles NO creative text and makes NO
  direct Gemini request for Call 1: `atlasEdgeRequestBody` maps the verified
  input + GENIE manifest onto the request, `callAtlasArtboardEdge` POSTs it,
  verifies the returned master sha256, enforces `imageRequestCount === 1`, and
  records the provenance chain (`metadata.atlasEdgeProvenance`). QC gate,
  cut-out fill, deterministic panel cut and lineage hashes are unchanged.
  `PROMPT_VERSION` = `designpro-flat-first-atlas-20260827.v10-edge`.
- DELETED from the product path (do not restore): the transpiled vendor bridge
  `runtime/vendor/designpanel-authoring.cjs` + its build script, the
  reconstructed `buildAtlasArtboardDesignIQDirection`, the SIDE-TWIN
  photographic-scene framing, and any direct Call-1 Gemini invocation outside
  the edge function.
- Locked by `tests/atlas-artboard-edge-call1.test.mjs` (both halves of the
  contract, plus the persona-drift alarm), and the assembly module is
  transpiled and EXECUTED by `tests/designpro-persona-contract.test.mjs` /
  `tests/designpro-reference-authority.test.mjs`.
- The v9 DB pin (20260826090000) was applied to production and REVERTED live
  the same night (the deployed runtime still emits v8);
  `20260827010000_designpro_atlas_revert_v9_pin.sql` captures that revert
  idempotently. SHIP ORDER for v10: the DB gate must learn v10-edge in the
  same cutover as the runtime that emits it — runner and gate may not diverge
  across a customer-visible window again.
- Acceptance (owner protection): a dark, isolated Call-1 run through the
  DEPLOYED edge function — report requestId, function name + source SHA,
  prompt version, image-request count exactly 1, zero direct Call-1 Gemini
  requests elsewhere, the master image, and the source-master hash + six crop
  hashes. STOP after showing the owner the master; no proofs, no traffic
  switch, until she approves it against HVAC Hero / Iron Horse.

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

### 🎛️ THE AUTHORING MODEL IS PINNED BY NAME — AND THE NAME IS THE **GA** ID (2026-08-26, corrected same day)

**Pinning by name stays. The value was wrong, and it was wrong on my own
evidence.** The droplet writes `GOOGLE_IMAGE_MODEL=gemini-3-pro-image`
(`ops/configure-env.sh`), and `lockModel` alone pins **the first of whatever is
configured** — config drift, not a pin. That half of the rule is unchanged:
`DESIGNPANEL_AUTHORING_MODEL` names it, Call 1 passes it as `model:` alongside
`lockModel: true`, and **it must not become an env lookup** — the projections may
follow `GOOGLE_IMAGE_MODEL`, the design authority may not.

It was briefly set to `gemini-3-pro-image-preview`, because the reference builds
that id into its endpoint (`index.ts:1320`) and because **one** A/B pair on the
Precision Climate Solutions payload preferred it. **Eleven real production runs
say the opposite**, measured as border-vs-interior luminance on the actual
masters pulled from storage:

| generation | date | prompt | model | flanks | centre four |
|---|---|---|---|---|---|
| `5b2eb96c` | 22 Aug | v2 | GA | **full bleed** (border 147) | **full bleed** (141–167) |
| `87c481ca` | 23 Aug | v4 | GA | picture of a vehicle (0) | full bleed (135–177) |
| `9dd6d43c` | 26 Aug | v8 | GA | picture of a vehicle (0) | full bleed (137–175) |
| `04cc0b29` | 26 Aug | v8 | **preview** | picture of a vehicle (18) | **picture of a vehicle (20–23)** |

Every GA run holds a border median of 135–177 across the centre four on every
prompt version from v2 to v8. The first `-preview` run drops it to 18–23 with
63–83% of each border dark. **The Flamingo master this product is judged against
(`5b2eb96c`) was authored on the GA id**, and so were its seven good proofs.

**One A/B pair is not eleven production runs.** A single sample on one payload is
exactly the measurement that should lose to the fleet, and this one did.

### ⚠️ THE FLANKS HAVE BEEN BROKEN SINCE v4 — AND THAT IS A SEPARATE BUG

Same table, different column. `driver` and `passenger` come back as a vehicle
silhouette on a dark surround from **v4 onward, on every model**, while the
centre four stayed clean. v4 (`5b8f75d`) is the commit that created
`runtime/flat-first-atlas.cjs`, and it added the **only flank-specific sentence
in the whole prompt** — the SIDE-TWIN CONTRACT, which tells the model those two
zones share a *"scene"*, *"landmarks"* and a viewpoint *"reversed for the
opposite flank"*. That describes a photographed vehicle side. The centre four are
never mentioned by it and never broke.

The same commit added the negative block — *"Do not draw or punch out vehicle
windows/glass, wheel arches… Do not draw a vehicle, camera scene, shadows"* —
which is the prompt shape this file already warns Gemini over-indexes on.

**This is not yet fixed and must not be "fixed" by guesswork.** RULE 0.15
records what happened the last time a session rewrote the vehicle framing to
chase a pixel defect. The controlled test is the A/B harness with one variable:
same payload, same model, the side-twin sentence with and without the
scene/landmarks framing.

**v2's prompt text is not in this repository.** `flat-first-atlas.cjs` was created
at v4, so the Aug-22 code was never committed here — the v2 evidence is
behavioural, measured on the stored artifact, not a text diff. Do not go looking
for a v2 source file; there isn't one.

### 🖼️ A PROMPT MAY NOT CITE ATTACHMENTS THE REQUEST DOES NOT CARRY (2026-08-26)

The same run measured `0 gold-standard artboard(s)` on the live droplet:
`loadDesignPanelArtboardExamples` reads bucket `wrap-files flat panel`, which is
**not populated on this project**, and it fails soft by design. Meanwhile the
closing line of every A.T.L.A.S. prompt said *"Match the production quality of
the provided gold-standard DesignPanel artboards"* — pointing the model at
images that were never in the request.

The clause now follows the attachment count. Populating that bucket would be a
real improvement and is a separate piece of work; until it is populated, the
quality bar is stated without the dangling reference. **When you add examples,
check the prompt still cites them** — the count is threaded through
`atlasPrompt(input, manifest, { artboardQualityExampleCount })`.

### 📏 REPRODUCING THE A/B

`.github/workflows/designiq-ab-precision.yml` (dispatch, `RUN_DESIGNIQ_AB`) is
the harness. It captures the COMPLETE assembled request for both calls before
Gemini and then executes them, so a design-quality argument can be settled on
the request rather than on impressions of the output.

Two things about it that are load-bearing:

- **It runs in the live runtime image, not on a host path.**
  `ops/Dockerfile.runtime` installs into `/app` inside the image, so the host
  release directory has no `node_modules` at all. `calls-1-7-seam.yml` still
  asserts `$release/runtime/node_modules/@supabase` and will fail the same way.
- **The control is transpiled from the vendored source, never re-described.**
  `scripts/build-control-prompt.mjs` slices the pure prompt half of
  `supabase/functions/design-panel-ai-generate/index.ts` and swaps only the Deno
  import header; the harness refuses to run unless the SLICED SOURCE still
  hashes to the pinned value. (2026-08-26: the guard used to hash the ASSEMBLED
  prompt, which embeds the brief — so any non-default payload tripped "control
  drift". It is source-based and unconditional now.) A drifted control is not a
  control.
- Arms are A / A2 / B / C (+ B-configured when the droplet model differs);
  `arms:` narrows a dispatch and the summary prints `imageRequestsExecuted`.
  `runtime_source: checkout` is the isolated acceptance route (RULE 0.26).

## 🎭 RULE 0.24 — THREE REFERENCE CLASSES, THREE AUTHORITIES (Trish 2026-08-26)

Mixing these roles is a design-drift mechanism, so they are locked in tests
rather than left to prose — `tests/designpro-reference-authority.test.mjs`.

| class | what it is | what it may teach | what it may NEVER do |
|---|---|---|---|
| **STRUCTURAL** | the bundled Houdini flattened-top-view pair | how ONE cohesive wrap is represented across a flattened master — layout, orientation, surface correspondence, seam intent | contribute artwork, wording, logo, colour, brand or style |
| **CREATIVE** | the customer's own VisionBoard images | artwork authority under `exact_reference`; style authority under `style_inspiration` | — |
| **PRESENTATION** | the 3D proof example + Studio OS | vehicle presentation, camera, studio, photorealism, wrap realism | contribute artwork or redesign the customer's wrap |

**The Houdini sheet is NOT a creative-style reference** unless the customer
explicitly supplies it as one. It is attached to teach the output format.

**Authority order for a 3D proof:**

1. the accepted A.T.L.A.S. source design — **ARTWORK** authority
2. YMM + the angle contract — **VEHICLE/VIEW** authority
3. the 3D example + Studio OS — **PRESENTATION** authority

`viewAuthorityFor` enforces (1) by hash: an authority not bound to the surface
source, or bound to the wrong surface, throws
`flat_atlas_view_authority_identity_mismatch`. A presentation example can never
pass that gate, which is what stops a render reference redesigning the wrap.

The classes stay apart in metadata too — `topologyExamplesApplied` /
`topologyExampleIdentities` versus `verifiedCustomerReferenceCount` — so a later
reader cannot mistake one for the other.

## 📐 THE PERSONA WILL BE MEDIUM-AWARE. NOT YET, AND NEVER VIA AN AI CALL. (Trish 2026-08-26)

DesignProAI's professional persona ultimately applies to vehicle wraps, WallPro /
wall wraps, window graphics and GraphicsPro. The creative layer today is
vehicle-hardcoded: 55 `vehicle` references in `runtime/designiq-prompt.cjs`, no
medium abstraction, and no wall/window/graphics authoring path in the runtime.

**Do not generalise those 55 references yet.** Vehicle DesignPro is what is
blocking, and it must be proven first.

**When it is done, two constraints are already fixed:**

- **Medium selection is deterministic and local.** Assemble the correct
  professional persona for the medium in code. Do NOT add an LLM
  classification or persona-selection stage — that is latency on the critical
  path before the customer sees anything, and RULE 0.20's one-source-design
  contract does not get a second AI call to decide who is designing.
- **One source-design AI authoring call stays one call.** VisionBoardIQ runs
  only when reference images exist, and it is the only additional AI stage the
  authoring path may carry.

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

**⚠️ THAT TABLE IS STALE AT `/panelpro`. THE ROUTE IS THE ANSWER. (2026-08-26)**

`3bc41b6` moved `/designpro/jobs/:generationId/panelpro` onto
`AdminGeminiCompareStudio.tsx` deliberately, and said why in its own message:
*"The PanelPro route mounts the full Admin Studio, which opens the job the URL
names; the per-surface validator keeps its own path one level down."* So:

| Surface | Route | File |
|---|---|---|
| **PanelPro Studio — the internal QC/lineage control room** | `/designpro/jobs/:generationId/panelpro` | `pages/AdminGeminiCompareStudio.tsx` |
| The per-surface validator | `/designpro/jobs/:generationId/panelpro/surfaces` | `pages/designpro/PanelProStudioBoard.tsx` |

An earlier revision of this rule called `AdminGeminiCompareStudio.tsx` "unrouted
RestylePro import weight". It is routed, and it is the control room. **Determine
this from the route and its history, not from this table** — the table has now
been wrong in both directions, and `git log -L` on the route line settles it in
one command.

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

### ⛔ AMENDMENT — SCHEDULING IS NOT PART OF THE FROZEN SEAM (Trish 2026-08-27)

RULE 0.5 freezes the **artifact contract** — shape, naming, identity, storage,
`source.verify`'s exactly-six/exactly-two counts. It does **not** freeze *when*
a downstream workflow stage is scheduled, and a session reading "the seam is
frozen" as "do not touch stage sequencing without asking" stalled real
orchestration work on that misreading.

**Owner directive, final: "The graph contract is already decided... Do not
stop again because an old rule describes the obsolete serial architecture.
Update the rule/contract to the graph architecture and continue."**

So, explicitly: **workflow stage dependencies, scheduling and the conditions
under which a workflow row is created are NOT an owner-level stop.** Wire them
to the graph model — each node's real data dependency, nothing more — and keep
going. What remains frozen is only what RULE 0.5 actually names above:
`SURFACE_KEYS`, storage paths, content hashes, receipt shape, the exactly-six
panel / exactly-two proof counts. Changing *those* is still an owner-level
stop. Changing *when a stage may run* is not, and never was — it was read into
the rule, not written into it.

**Applied immediately**, per the graph contract:
`handoff_designpro_generation_to_production` used to require the generation's
overall engine state to be `outputs_ready` — every one of the seven proof slots
accepted — before it would create the entice workflow at all. That gated
`panels.build` **and** `logos.extract` behind the slowest of seven independent
AI calls, which is exactly the global barrier the graph forbids, one layer
above the `claim_designpro_stage` predecessor chain already removed. A
flat-first (ATLAS) request now hands off on **master acceptance alone** — the
same evidence `designpro_flat_first_handoff_gate` already reported as
production-eligible on a read-only path that disagreed with the write path
gating it. See
`supabase/migrations/20260827120000_designpro_logo_extraction_does_not_wait_for_proofs.sql`.
A Standard (non-flat-first) request is unchanged: it has no master and no
panels, so `outputs_ready` remains its only gate.

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

## 🧬 PATCHING LIVE PL/pgSQL: VALIDATE THE RESULT, NOT ONLY THE SEARCH STRINGS (2026-08-26)

Two rules, and the second was learned the expensive way.

1. **Patch the live body; never restate it.** `20260822090000` text-patches
   `complete_designpro_stage` rather than re-emitting it. A migration that
   `CREATE OR REPLACE`s the whole function silently reverts every earlier patch —
   the shadow gate caught exactly that on the Close-Up boundary.
2. **Then parse what you produced.** `20260826010000` asserted each of its six
   search fragments appeared EXACTLY ONCE — and every assertion passed — while
   one replacement deleted the legacy `ELSIF v_stage.stage_key='panels.build'`
   header it was supposed to keep. Three symptoms followed and all three read as
   something else: a clean A.T.L.A.S. promotion fell into the orphaned legacy
   body, a mutated one still raised (masking the shape problem), and **a Standard
   run matched no `panels.build` arm at all and completed with no contract
   enforced.** Validating the inputs proves you found the right text; only
   inspecting the generated body proves you left valid code behind. The
   structural locks in `supabase/tests/atlas_stage_contract.test.sql` — A.T.L.A.S.
   arm present verbatim, legacy arm present verbatim, A.T.L.A.S. before legacy —
   are what that costs to prevent.
3. **And then RUN it, over a row that exercises the expression.** `20260826030000`
   wrote `pg_catalog.coalesce(...)` inside the `jsonb_agg` that projects each
   approved view. **COALESCE is SQL grammar, not a function in any schema** — the
   parser resolves it before a search path is consulted, so a qualified form
   cannot exist. It applied clean in shadow, applied clean in production, and
   passed every check, because **PL/pgSQL compiles an expression the first time
   it is EVALUATED, and an aggregate over zero rows evaluates nothing.** So the
   read returned a flawless `[]` for every generation whose proofs the sibling
   fence withholds — including the acceptance generation I verified against —
   and raised `function pg_catalog.coalesce(jsonb, jsonb) does not exist` for
   every generation that actually had proofs, which is the only case
   RevisionStudio exists to serve.

   `SET search_path = ''` is why qualifying is the right reflex, and it stays
   right for functions, operators and types. It does not apply to the grammar:
   COALESCE, NULLIF, GREATEST, LEAST, CASE, EXTRACT and the aggregate syntax
   forms take no qualifier and reject one. `grep -n "pg_catalog\.\(coalesce\|nullif\|greatest\|least\)" supabase/migrations/`
   finds this class in one command.

   Fixed by `20260826060000`; locked by
   `supabase/tests/generation_workspace_contract.test.sql`, which seeds SEVEN
   view rows and CALLS the function — a fixture with an empty view set
   reproduces nothing at all.

## 🪞 A POLICY RUNS AS THE CALLER, AND PRODUCTION HAS OBJECTS THE HISTORY NEVER CREATED (2026-08-26)

Two facts, learned together, because the second hides behind the first.

1. **A row-security policy expression is evaluated with the PRIVILEGES OF THE
   QUERYING USER.** So an inline `EXISTS` inside a policy can only read tables
   the caller could read directly. `designpro_generation_requests` and
   `designpro_qc_members` are service-role only, so a policy that reaches either
   of them from an `authenticated` session dies with
   `permission denied for table designpro_qc_members` — and it takes the whole
   read down, not just that branch. The remedy is the idiom the codebase already
   uses: a `SECURITY DEFINER` helper in `designpro_private`, whose body runs as
   its owner, granted `EXECUTE` to `authenticated`.

   Note what this means for `designpro_generation_requests`' own SELECT policy:
   its `designpro_qc_members` clause can never fire for a real caller, because
   nothing can select that table as `authenticated` in the first place. It is
   reachable only from a definer function.

2. **`designpro_private.caller_owns_generation(text,text)` exists in production
   and in NO migration.** `20260814160000` wrote that predicate inline; someone
   later refactored it into a function directly against the database. So a new
   policy that calls it passes every check against production and dies in the
   shadow apply — which is exactly what happened, on the first attempt at the
   RevisionStudio migration:

   ```
   ERROR: function designpro_private.caller_owns_generation(text, text) does not exist
   At statement: 18   CREATE POLICY designpro_owner_read_generation_views
   ```

   **Validating against production is necessary and not sufficient.** Production
   is a superset of the migration history, so it will accept references a fresh
   database refuses. Before depending on any function, check it is CREATEd in
   `supabase/migrations/` — `grep -rn "FUNCTION <name>" supabase/migrations/` —
   and if it is not, define your own in your migration rather than borrowing the
   drifted one. `designpro_private.caller_owns_generation_path(text,text)` is
   that in-history twin.

## 🚦 THE MERGE DOES NOT DEPLOY ITSELF, AND DISPATCHING THE GATE ON `main` KILLS THE ONE THAT WOULD (2026-08-26)

Two facts, learned in the same five minutes, and the second is invisible until
you go looking for it.

1. **`release.yml`'s concurrency group is `designpro-release-<ref>`, with
   `cancel-in-progress: true`.** A `workflow_dispatch` on `main` and the push
   gate from a merge to `main` resolve to the SAME group, because neither has a
   pull-request number. So dispatching the protected production migration right
   after merging **cancels the merge's own gate run** — and
   `deploy-production.yml` only auto-fires on
   `workflow_run.conclusion == success && workflow_run.event == push`, so a
   cancelled gate means the deploy is skipped, silently. Live on 2026-08-26:
   gate `32936283425` cancelled, deploy `32936295705` skipped.

2. **The auto-deploy path also requires an opt-in marker in the merge commit.**
   Its "Prove exact protected main intent" step runs
   `git log -1 --format=%B | grep -Fq '[dark-deploy]'` on the `workflow_run`
   branch. A merge commit without that literal string never deploys, however
   green its gate. This is deliberate: merging is not the same act as putting
   an artifact on the droplet.

**So the order that actually works** is: merge → dispatch `release.yml` on
`main` with `APPLY_DESIGNPRO_PRODUCTION` (it must be `main`; the job asserts
`test "$GITHUB_REF" = "refs/heads/main"`, which is why dispatching it on the
feature branch fails at the guard) → then dispatch `deploy-production.yml` on
`main` with `exact_sha` = main's head and
`DEPLOY_DARK_TO_DESIGNPROAI_PROD_SFO3`. The dispatch path asserts
`GITHUB_SHA == EXACT_SHA`, so it can only ever deploy the head of main.

**WAIT FOR THE PUSH GATE TO FINISH BEFORE DISPATCHING.** The cancellation is
symmetric — whichever run enters the group second kills the first — so the
order of the two mistakes is the only thing that varies. Both happened here
within half an hour:

| | dispatched | push gate | cancelled |
|---|---|---|---|
| `1cd0163` | 06:00:13 | 06:00:10 | the **push gate**, so the deploy had no artifact to consume |
| `1e9e29f5` | 07:28:27 | 07:28:35 | the **dispatch**, so the migration never ran |

A cancelled push gate is the more expensive of the two, because
`deploy-production.yml` selects its artifact with
`event=push&status=success` and asserts **exactly one** — cancel that run and
the dispatch deploy fails at *"Select the one successful exact-main release
run"* with a count of zero. Re-running the cancelled push gate restores the
count; nothing else does.

So: merge → **let the push gate go green** → dispatch the migration → dispatch
the deploy. Put `[dark-deploy]` in the merge commit only when the merge itself
should ship, and then do not dispatch anything until that gate has finished.

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
