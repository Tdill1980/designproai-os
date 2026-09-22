# CLAUDE.md — designproai-os

## 🏷️ CUSTOMER-FACING NAMES: DESIGNPROAI IS THE OS; VEHICLEPRO, WALLPRO, CUTPRO RUN INSIDE IT; NO ENGINE IS NAMED (owner ruling, Trish 2026-09-16; "Powered by Atlas" retired 2026-09-22)

Full record: `docs/BRAND-NAMING-2026-09-16.md`. Source of the words:
`app/src/lib/os-brand.ts`. Locked by `tests/os-brand-naming.test.mjs`.

- **DesignProAI** is the master brand, in the persistent header on every page
  with *Prompt-Based Design + Production-Ready File Output* under it. Hero:
  *The Design-to-Production OS Built for Wide Format.* Never "an AI image
  generator", never "a design tool".
- **VehiclePro** is the vehicle tool (the one at `/designpro/create`). It used
  to read "DesignPro / Vehicle Wrap Design System" under a header that also
  read "Vehicle Wrap Design System" — owner: *"its a double name, we need this
  tool called VehiclePro"*. **CutPro** replaces "GraphicsPro" in every
  customer-facing word. **WallPro** keeps its name. Inside a tool the header
  names the tool BENEATH the DesignProAI lockup, never instead of it.
- **No engine is named to a customer.** This bullet used to read *"Customer
  copy says Powered by Atlas and, with room, The intelligence layer behind
  DesignProAI."* That ruling is RETIRED — owner, 2026-09-22: *"Remove all UI
  Powered by Atlas"* / *"Remove and hide atlas"* / *"Panel production proof is
  source."* `ATLAS_BRAND` is deleted from `os-brand.ts` (no empty object left
  behind), the tagline is gone from `DesignProAIHome`, `DesignPanelProPremium`,
  `GenerateDesign`, BOTH SEO meta descriptions (`app/index.html`, `Index.tsx`)
  and the FAQ answer, and nothing replaces it. What the customer reads instead
  is what the product does: **Call 1 draws the three-zone Production Panel
  Proof, and every print-ready file is cut from it.** The A.T.L.A.S. vocabulary
  in this file, the runtime, the gateway and tests is engineering vocabulary
  and stays — but it no longer reaches a screen, an alt text, a meta tag or a
  crawler (`tests/no-atlas-on-human-surfaces.test.mjs` now convicts the tagline
  in any case, and the word "topology" wherever it is visible text).
- **This was copy, not a rename.** Keys (`designpro`, `graphicspro`,
  `wallpro`), routes (`/designpro/*`, `/graphics-pro*`, `/printpro/wallpro`),
  buckets, edge functions, tier gates, logic keys (`<FAQ productName="GraphicsPro">`,
  `toolSource === "GraphicsPro"`) and stored rows are unchanged, on purpose.
  `/vehiclepro`, `/vehicle-pro`, `/cutpro`, `/cut-pro`, `/cut-pro-wall`,
  `/cut-pro-window` redirect INTO the served routes; nothing redirects out.
  Do not "finish the rename" by touching an identifier a stored row or a
  deployed function reads.


## 🚫 NO HUMAN-READ SURFACE SAYS "ATLAS" — AND THE IDENTIFIERS STAY (owner, Trish 2026-09-21/22)

Owner, looking at the live PanelPro board: *"My 3-zone is Call 1. Delete ATLAS."*
then *"Remove all atlas references."* #596 and #597 each removed a handful of
labels by hand and each missed the next handful, because nothing looked for
the word. Now something does: **`tests/no-atlas-on-human-surfaces.test.mjs`**
scans `app/src` and `gateway/src`, strips comments, and fails on any
`A.T.L.A.S.` or word-bounded `ATLAS` that can render, toast, throw to a
screen or land in an alt/aria/title. Verified to fail against the pre-fix
tree (it listed 27 strings across 11 files the two hand passes had missed,
including six multi-line JSX texts no grep for a quote could see).

The words to use instead: **print master** (the sheet), **Call 1** (the
step), **design / revision** (the lineage). Runtime error MESSAGES that reach
a screen (StageError text, worker refusals, proof-QC reasons) were rewritten
in the same change; runtime PROMPT text that names A.T.L.A.S. to the model is
hash-pinned and untouched.

**The scope line, and do not cross it:** this is copy, not a rename. Table
names (`designpro_atlas_call1_runs`), storage paths (`atlas-call1-inputs/…`),
env flags (`DESIGNPRO_ATLAS_*`), stage keys, edge modes (`atlas-artboard`),
identifiers (`atlasBinding`, `isAtlas`, `AtlasRefusal`) and file names all
stay. Renaming any of them touches stored rows and the deployed edge
function, and removes no confusion a customer can see. The lock is
case-sensitive and word-bounded precisely so it never asks for that.

**"Powered by Atlas" IS in scope now, and it is removed (2026-09-22).** This
paragraph used to exempt the tagline as the owner's own 2026-09-16 brand
ruling. The owner retired it the same day this section was written: *"Remove
all UI Powered by Atlas"*. The lock was extended rather than a hand pass made:
it now convicts `/powered\s+by\s+atlas/i` on every line, scans `app/index.html`
as well (a crawler reads that meta description), and convicts **"topology"**
wherever it is VISIBLE text — a quoted string literal, JSX text or HTML text —
while leaving identifiers (`authoringTopology`, `TOPOLOGY_LABEL`, `.topology`,
`topology:` keys) legal, because those are stored-row and gateway-contract
names. `AtlasRefusedSheets` maps every route the ledger can record — including
`panel-proof`, which used to render as the literal "undefined" — to product
words; the admin fact reads "Call 1 route", never "Topology".

**"Panel production proof is source"** is the companion ruling, and it is a
placement, not a word: the three-zone sheet is mounted ONCE per surface, as
`ProductionProofSourceCard` ("Production Panel Proof · V{n} — the source of
every print panel below"), directly ABOVE `ProductionFlowLayersCard` and the
Order Production Files button in RevisionStudio, and above the panel board in
PanelPro, keyed on the selected version. It wraps the one existing reader
(`AtlasPanelProofSheetLoader`) and holds no query of its own — one reader per
artifact, RULE 0.21. Locked by `tests/server-revision-studio.test.mjs`.

## 🎨 CALL 1 IS THE DESIGNER'S THREE-ZONE PROOF. `separatedArtwork` IS THE DEFECT — NEVER SEND IT. (owner, Trish 2026-09-22)

Owner, on the first real generation of this route (`0f53d4e7`, 2021 F150,
botanical brief with a home photo and a custom logo): *"these are not my design
edge functions my system created incredible designs this did not follow my
prompt and quality is shit!"* — gradient panels, generic lettering, a doubled
logo, 115 s.

**The contract, verbatim:** *"It gets the production panel template with vehicle
make and model info including dimension of rectangle panels and it takes
customer prompt and designs a cohesive set of 6 wrap panels using our persona
based edge functions, and is shown the ridgeline pools 3 zone proof so it does
the same — it creates the zone 1, 2, and 3 all at one time."* And: *"Call 1 is
from our designer persona and Gemini using its own brain to create the flat
panel production proof using our example."*

**ALL OF IT WAS CODED AND NONE OF IT RAN.** `requestProofSheet` sent
`separatedArtwork: true` on every customer Call 1, and that ONE FIELD made the
edge do the opposite of every clause:

| `production-panel-proof/index.ts` | what the flag did |
|---|---|
| 640–660 | the three-zone prompt is assembled at :621 and **discarded** for *"six clean printed background artworks"* — Zone 2 alone, no lettering, no logo, no bands, no panel inches, no exact-text block |
| 643–648 | **every A.C.E. line containing no / not / never / without / don't is stripped**, which is most of the designer's own rules |
| 773 | the hash-pinned **Ridgeline gold sheet is not attached** |
| 717–728 | the container is drawn `mode: "artwork"` — six plain grey rectangles, no vehicle, no dimensions — and the caller's dimensioned template is refused as a fallback |
| 972, 1090 | single turn, plus a second paid image request for the logo |

The assembler then rebuilt Zone 1 from those unlettered backgrounds plus a
`typeset.renderLockup` wordmark and the uploaded logo. Gradients, generic type,
two logos — exactly what the owner rejected.

**Where it came from:** `separatedArtwork`, the background-only prompt and the
comment *"THE CUSTOMER-VISIBLE CALL 1 IS BUILT BY CODE, NEVER BY GEMINI"* all
arrived together in **`91d0b8e`** (2026-09-20, whose own bullets read *"Make
Gemini author backgrounds only, never the proof sheet"* and *"Never expose raw
Gemini artwork as customer Call 1"*). That decision is reversed and the comment
is deleted, so it cannot be restored from a note in the code.

**CODE BUILT ONLY THE PRODUCTION PANEL PROOF DOCUMENT.** The template, header,
job block, zone bands, panel rectangles, dimension callouts, PANEL DIMENSIONS
REFERENCE table, notes and legend are drawn from GENIE, so a dimension can never
be invented. **The artwork in Zone 1, Zone 2 and Zone 3 is the designer's**,
created in one pass through the design edge functions and published as drawn.
Code owns the document. It does not own the design.

- Zone 1 and Zone 2 are read off the returned sheet (`cutProofPanels`
  `["zone1","zone2"]`). Zone 3 keeps `sheetDrawnCutGraphic`, which reads its five
  boxes off the same sheet and trims them to their ink — a raw box crop beside it
  would be a second producer of one artifact (RULE 0.21).
- `planProductionPanelLockup` / `compositeProductionPanels` **do not run on the
  sheet path**. They are untouched for the DERIVED path (`zone2Panels` supplied),
  where a legacy six-surface or field revision has no authored sheet and code
  must build its document. Asserted byte-identical.
- `threeZoneLayout.brandedSource` is `sheet-drawn` or `composited`. Reporting one
  as the other is the receipts-green/pixels-wrong shape this file records four
  times.
- The absence of a customer logo or contact line is recorded for EVERY path, not
  inside the compositor branch — it is a fact about the customer's input, and it
  had silently stopped being written.

**THE SHEET'S DIMENSIONS ARE THE VEHICLE'S.** `panelRowsFromManifest` states
PRINT inches on purpose (its aspect reproduces the zone exactly) and the edge had
no other dimension source, so `containerSvg` read them as trim and added the 5″
bleed a second time: a 222.5 × 53 driver drawn as `242.5" W x 73.0" H (TRIM:
232.5" x 63.0")`. Both numbers wrong, on the sheet the designer is shown.
`panelTrimRows` now travels beside the print rows and `panelDimensionManifest`
labels from both; absent, the drawing is byte-identical to before.

**THREE LOCKS ENCODED THE DEFECT** — the sixth, seventh and eighth time this file
has recorded that shape. `separatedArtwork === true` was asserted as the
contract; *"clean-background generation leaves typography to the compositor"* sat
beside a `BACKGROUND ARTWORK ONLY — NO LETTERING OF ANY KIND` assertion; and
*"Zone 1 derives from green Zone 2, never blue generated Zone 1"* pinned five
composited logo placements, which is the doubled logo written down as a
requirement. All three are inverted and were verified to fail against the
pre-fix tree.

**REVISIONSTUDIO WAS UNREACHABLE.** `viewsVisible` is unconditionally true on
this pipeline, so the block holding the only link to `/revision-studio` never
rendered — RULE 0.23's "then ask" half, deleted. The reveal and revise actions
are no longer gated together.

**NOT PROVEN:** no live generation has run on this path. Acceptance is the
owner's eye on the exported sheet against the seeded Ridgeline proof — the
company name on both flanks in the design's own typeface, one logo per panel,
Zone 2 the same panels without type, and callouts reading the vehicle's real
trim.

## 🧩 THE THREE-ZONE PANEL PROOF: DURABLE, READABLE, AND ON (2026-09-19; flag corrected 2026-09-22)

Owner, on the architecture: *"Production panel proof is source it has the 3
zones / For panels, panels with seperated and logos and text."* Then, on the
work: *"Finish crop correctness, durable DAG execution, and immediate three-zone
display."* — *"Keep the three-zone route off for customers until the repaired
path passes a controlled real-generation test."*

**FLAG STATE: `atlas_panel_proof: ON` on the droplet.** This paragraph used to
say `off` (contained at `e540012`, run 35460623843). That is stale: deploy run
**1876**'s resolved-flag banner prints `DESIGNPRO_ATLAS_PANEL_PROOF=on`, so the
three-zone route IS the customer's Call 1 today. Read the flag line in the
deploy log before judging a run's route — the same lesson this file records
for `atlas_field_first`. Everything below is built and locked; the controlled
real generation with uploaded assets that was to gate the flip is still the
owner's acceptance standard for calling the pixels good.

### Five defects, all of them live, all found by measurement

| # | what was wrong | how it was found |
|---|---|---|
| F12 | **the route forwarded NO customer logo or VisionBoard reference at all**, while six-surface and field carry both as `edgeExtras.referenceImagesBase64`. RULE 0.24 names those CREATIVE authority and no gate convicts their absence | read the branch against the other two |
| F02 | **`cacheOnly` was a no-op**, so a recovery could buy a SECOND paid sheet. The edge minted a fresh uuid per invocation, so the identity could not mean anything | traced the edge's provider request |
| — | **`panelRowsFromManifest` emitted PIXELS labelled as inches, transposed.** `DRIVER: 979" wide x 2674" high` instead of `163" x 66"`, so the prompt described an 81-foot portrait panel, the container drew a 1.160:1 cell against a true 2.470:1 zone, and `fit: "fill"` stretched every flank ~2.1x | the new aspect guard fired on a legitimate fixture |
| — | **the whole three-zone proof was unreadable.** The sheet is not a column — it lives in `metadata.panelProofAuthoring` — so nothing could resolve or sign it. The product showed the assembled master (Zone 1) and none of the document it came from | looked for the read path and there was none |
| — | **`proof.assemble` could not be FINISHED.** See below |

The fill rule was the earlier one: `INSTALLATION_FACT` never carried RULE 0.28 §3
("artwork runs off all four sides"), and adding it took branded fits from
0.61–0.86 to 0.92–1.00 on a live probe (35454079732). Clean 0.98–1.00; cut
graphics 0.19–0.29, which is **correct** — Zone 3 is marks on a ground.

### THE NODES DID ALL THE WORK AND THEN COULD NOT BE FINISHED — the trap this file already names

CLAUDE.md's own v28 section says it: *"authorElements does NOT fail soft on a
missing migration: the nodes run and the LAST one trips the
`master_storage_path IS NOT NULL` CHECK after doing the work."* The panel-proof
pair reproduced that exactly, measured on the real migration on PGlite:

```
proof.sheet  completed
proof.assemble  -> 11/11 sibling panels stored, master 22690d52eee3 assembled
finishing proof.assemble failed (designpro_atlas_call1_rpc_failed)
  -> node stuck `running`, lease expired, the node re-ran, caller timed out
```

`finish_designpro_atlas_call1_node` let only `master.assemble` and
`master.composite` write the run's master columns, and the run's
`CHECK (state<>'completed' OR ... master_storage_path IS NOT NULL ...)` therefore
refused to complete. `20260919190000` adds `proof.assemble` beside
`master.composite` **with the same `IS NULL` guard**, so it can name a master
only when nothing else has. **SHIP ORDER: that migration lands before any runtime
that emits `proof.assemble`** — there is no soft path, which is the worst shape a
missing migration can have.

### The DAG, and an honest statement of what it buys

```
proof.sheet ──(storagePath, contentHash, byteSize)──▶ proof.assemble
```

Two nodes in the EXISTING `designpro_atlas_call1_runs` / `_nodes` tables (no new
tables; `node_key`'s CHECK is a regex that already admits a dotted key), behind
the SAME `atlas_call1_graph` kill switch as the cascade.

The boundary is drawn where the fallible, billable work is — the same reasoning
RULE 0.39 gives for splitting `surface.driver.view` from `surface.driver`.
`proof.sheet` is the ONE image request; a re-claimed run reads its completed row
and spends **nothing**, not even the cache-read round trip. `proof.assemble` is
cut → gate → place → assemble → store the two sibling quadrants: ~17 sharp
operations, zero model calls.

**It is ONE node and not three on purpose.** Splitting the cut from the assemble
would force six extra stores of the Zone-1 panels across a boundary purely to
make a second-long deterministic step independently retryable.

**IT DOES NOT SHORTEN CALL 1.** The critical path is still that one image
request. What it buys is durability, per-node retry of the half that can fail,
and a queryable timeline. Do not describe it as a latency improvement.

`authorPanelProofMaster` was split into `requestProofSheet` +
`assemblePanelProofMaster` and is now a two-line composition of them, so the
graph and the in-process pass **execute the same functions** — a second producer
of these panels is what RULE 0.21 forbids by name.

### Two seams that had to move with it

- **The panel-proof transport takes its owner PER CALL**, like
  `createAtlasAuthorTransport` already does. Both runtime processes build ONE
  transport at start-up and then serve panel-proof nodes of ANY customer's run,
  so a construction-time-only owner sends an EMPTY `x-designpro-owner-id` on
  every graph-claimed node. The edge fails that closed with 403, correctly — but
  it would have made every durable run fail, and the owner id is also the
  provider cache's own isolation key.
- **`readNode` now selects `lease_owner` and `attempt`.** Without them the
  receipt records `null` for the sheet's own worker, so the provenance claims not
  to know something the row plainly says — and a queryable timeline is the whole
  thing the graph buys.

### The read path: `GET /api/generation/requests/:id/panel-proof`

`designpro_atlas_panel_proof_paths` (owner-scoped, NULL for absent and
other-owner alike) → the gateway signs a five-minute preview per object and
strips every path, exactly as `/atlas` and `/atlas-refusals` do.

- **Zone 1 is DESCRIBED, never re-signed.** It became the accepted master, which
  `/atlas` already signs; a second copy here is the two-master shape the
  2026-08-31 ruling retired by name.
- **The storage policy matches EXACT NAMES, never the prefix.** Both families are
  content-addressed (`atlas-panel-proof/<sha>.png`,
  `.../quadrants/<sha>.png`), and content addressing is deliberately NOT
  owner-scoped — a prefix predicate would let any authenticated caller sign any
  other customer's sheet by replaying a hash. Membership: the object must be
  named by a panel-proof revision THIS caller owns.
- **`{panelProof:false}` is a STATE, not a failure.** A six-surface / field /
  hero-driver revision is a real design with no three-zone document, and a UI
  that cannot tell it from NULL shows "not found" for a perfectly good run.

**The sheet now shows IMMEDIATELY**, above "See All Views" and not gated on it:
all of these artifacts exist the moment Call 1 is accepted, so making the
customer press a button for more 3D camera angles first had the order backwards.
On any other topology the component renders nothing, so a six-surface run is
byte-identical.

### `Number(null)` IS `0`, AND THAT PRINTED A FABRICATED DIMENSION

`Number.isFinite(Number(x)) ? Number(x) : null` turns an ABSENT value into a real
one. A Zone 3 slot has no inches **by contract** — it is sized at the plotter —
so every cut graphic was reported as `0" wide`, which a UI prints as fact.
`measuredNumber` keeps absence absent. Locked both in the gateway and in the
component (`never prints 0" × 0"`).

**And per the owner's instruction — do not represent raster crops as editable
layers or vector cut files** — the component is asserted to contain no "editable
layer" and no "vector file", and says plotter-ready contours are produced in the
production pack, which is where the cut-contour builder actually lives.

### What is NOT done, and must not be claimed

- **No controlled real generation has run on the repaired path.** Every measurement
  above is a probe, a fixture, or a read of a live row. The owner's own standard:
  a real test, not source greps or synthetic fill tests.
- ~~**Zone 2 is not yet wired to `panels.delogo` (Call 11)**~~ **Stale as of
  2026-09-22.** Call 11 copies the frozen Zone 2 bytes as the qc-panel when the
  snapshot carries `panelProofAuthoring` (`backgroundsReused: true`), and
  `20260922051200` makes the snapshot carry it on EVERY handoff, not only when
  a logo was uploaded (three no-logo runs of 09-21 had none). Zone 3 → Call 10
  is still the model's drawing plus the persisted cut graphics; Call 10 owns
  the inventory downstream.
- ~~**PDF delivery is still absent from the paid contract.**~~ **Stale.** See
  the section below: the paid contract is v4 — five formats, two variants,
  sixty files. What has NOT changed: no fresh paid run has been opened to
  confirm the set lands in the ZIP a customer downloads.

### EVERY PRINT ASSET IS 150 PPI WITH 5" BLEED — INCLUDING THE BLANK PANELS (owner, Trish 2026-09-22: "make sure ALL assets files are processed to 150 ppi with bleed at 5\"")

Audited before touching anything. Until this date a paid pack held:

| asset | shipped as | 150 PPI + 5" bleed? |
|---|---|---|
| six branded panels (Zone 1) | Topaz → (trim + 10") × 150 px → PNG/JPG/TIFF/EPS/PDF | yes |
| six **blank panels (Zone 2)** | the raw crop off the proof sheet — a few hundred px wide, trim only, `bleed: null`, `printable: false` — in the ZIP's `qc-panel/` folder | **no** |
| Zone 3 cut graphics | the frozen bytes: vector SVG (typeset/contact) or the customer's own uploaded logo | n/a — no inches by contract, sized at the plotter |
| Logo Pack logos | as-is (separated cut assets) | n/a, by design |

**Now: output contract `designpro.production-formats.v4`** — five formats ×
two VARIANTS (`branded`, `clean`) × six surfaces = **60 files**. Call 12
enhances the six frozen Zone 2 backgrounds to the identical
(trim + 10") × 150 rectangle as `upscaled-clean-panel` artifacts, and
`buildPrintOutputs` writes both variants (`…/outputs/<side>-clean.<ext>`,
`metadata.variant: "clean"`). Registration with the branded panel is by
construction: the clean crop is fitted into the branded panel's OWN pixel
rectangle exactly as the Zone 1 crop was fitted into its master zone (resize
inside, copy-extend the remainder — `fitCleanToBrandedRectangle`), then
enhanced to the same target. This is RestylePro's worker behaviour
(`panelKey_clean` from `background_url`, RULE 1), not a new producer.

- **The Call 11 `qc-panel` is untouched.** RULE 0.25's "Topaz never runs on the
  QC derivatives" still holds: the clean variant is Zone 2 SOURCE artwork from
  the accepted Call 1 proof, not a derivative of the branded panel. The
  qc-panel stays the on-screen QC instrument.
- **A revision with no Zone 2** (authored before the three-zone proof) builds
  the branded-only set under v3 (30 files) and its receipts say so; a v2 pack
  still verifies as 24 and a v1 pack as 18 (`formatsForContract`,
  `variantsForContract`, `outputFileCountForContract`). Half a clean set is
  refused (`enhanced_clean_panels_missing` / `_unreceipted`).
- **`output.verify` keys files by `surface:variant:format`**, binds a clean
  PDF/JPG to the clean PNG of the same surface, and refuses a variant the
  contract does not ship. The v4 receipt carries `exactVariantSet`; pre-v4
  receipts are byte-identical to before, so their `outputSetHash` is unchanged.
- **The DATABASE gate had to move too, and it was already refusing #600.**
  `assert_production_output_build` (20260920113000) admitted ONLY contract v2 /
  24 files, so the JPG tier (v3 / 30) would have raised
  `production_pdf_output_build_required` on the first paid `output.build`.
  `20260922060000` admits v2, v3 and v4, counts DISTINCT
  (surface, variant, format), and re-patches the `output.verify` block's four
  `6*cardinality(formats)` counts to `production_output_file_count(run)`.
  Runtime tests cannot see this gate — check the migration when the format set
  changes.
- Cost: twelve Topaz calls per pack instead of six. The owner asked for it.
- **`parseCustomerIntake` is a SECOND Flash call on the customer's critical path**
  inside Call 1. It is not timed separately and it is the next latency lever.

## 🅰️ v28 — THE CLEAN BASE IS LIVE ON SIX-SURFACE (deployed 2026-09-18, NOT yet judged on pixels)

Full record: `docs/ATLAS-V28-CLEAN-BASE-ELEMENTS.md`. Read it before touching the
element graph, the output-class inspector or the deploy order.

**Deployed and verified from each side itself, not from a green check:** migration
`20260918030000` in `schema_migrations` AND in the live
`finish_designpro_atlas_call1_node` body; edge
`atlas-artboard-designiq.20260918.v28-clean-base-elements` read out of the
deployed function; runtime `a02066f5` on both replicas, `VERIFIED_WORKING`. Flags
resolved on the box: `TOPOLOGY=six-surface FIELD_FIRST=off HERO_FIRST=off
ELEMENT_GRAPH=on CALL1_GRAPH=on PANEL_FINISH=off`.

**The element architecture was already built and correct; it was UNREACHABLE.**
`ATLAS_CLEAN_BASE_CONTRACT`, `cleanBaseEnabled()` and the five element nodes all
existed and were right. They compiled only inside `compileHeroDriverGraph`, and
hero-driver is off — so `DESIGNPRO_ATLAS_ELEMENT_GRAPH=on` was live on the droplet
and INERT. Measured: live `efca5e03` had zero graph runs and zero nodes; across
all history there are 6 `master.composite` rows and **one** completed. No customer
had ever received a clean base with a composited lockup. That is the whole reason
lettering was diffusion paint. `elementNodes()` is now one builder for both
shapes; six-surface sends `cleanBase` and runs the subgraph against its already
accepted sheet, with the master crossing the node boundary as
`{storagePath, contentHash, byteSize}` (RULE 0.39), re-validated before it
replaces the accepted master and refused back to Layer 0 if it is not printable.

### THE COMPOSITE PROMOTED THE MASTER AND NOT THE PANEL BYTES (found 2026-09-18, never ran live)

**The v28 change shipped the two-master defect the 2026-08-31 ruling retired by
name, and the lock written to prevent it stayed green.** The promotion moved
`acceptedMasterBytes` / `acceptedMasterHash` / `acceptedMasterStoragePath` — but
the six print panels and the seven proof authorities are built from
`surfaceSourceBytes`, a DIFFERENT variable, which stayed on the clean base:

| | |
|---|---|
| master shown to humans, revision row, checkpoint | **composited** — company name on both flanks |
| the six PRINT PANELS the customer buys | **the unlettered clean base** |
| the seven 3D proofs | conditioned on that same clean base |
| each panel's `sourceMasterHash` | the **COMPOSITED** hash |

So PanelPro's "proof and panel came from the same master" check PASSES while the
bytes disagree, and the print files ship blank. Receipts green, pixels wrong —
the failure mode this file names in three other places.

`surfaceSourceBytes` and `panelSourceHash` now move with the promotion.
`panelSourceHash` must, because it is the identity a RESUME re-derives: the
resumed worker re-runs `fillMasterCutouts` over the STORED master, which is now
the composited sheet, so leaving the hash on the clean base would turn
`flat_atlas_surface_source_mismatch` into a guaranteed failure.

**THE LOCK ENCODED THE BUG — the fourth time in this file.**
`tests/atlas-accepted-master-is-the-repaired-one.test.mjs` asserted
`cutCallOnePanels(surfaceSourceBytes, manifest, acceptedMasterHash, {` and called
that "the six panels cite the accepted master". It only ever checked the HASH
argument; the BYTES were never asserted, which is exactly the gap the defect
lived in. The new case pins both, and was verified to fail against the pre-fix
runtime. **When a lock names two things, assert both of them.**

It never reached a customer: the element graph had not composited once on
production, so the first run to fire it would have been the first to ship blank
panels.

### THE COMPOSITE'S OWN GUARD WAS TRANSPOSED ON BOTH FLANKS (live d8c2e779, 2026-09-18)

**The first production run ever to reach `master.composite`.** The element DAG did
exactly what it was built to do — `typeset.produce`, `contact.produce` and
`element.lockup` all completed, four placements across both flanks, **zero model
calls, 270 ms** — and then the compositor refused its own correct sheet:

```
atlas_composite_altered_base: composite changed 0.0275% of the sheet
outside its own elements
```

taking an accepted six-surface master, six cuttable panels and the entire
generation with it (`state: failed`, `retryable: false`). **The sheet was fine.
The instrument measuring it was not.**

`sheetPlacement` returns `drawWidth`/`drawHeight` in **reading space**, which is
correct — the compositor resizes to them and only THEN rotates, so they are what
`.resize()` must be handed. The sheet-space footprint after a quarter turn is the
transpose, and the function already knew that: its 90° branch derives `left` from
`dh`, the post-rotation width. `darkDeltaOutside` did not, and masked `drawWidth`
across by `drawHeight` down — the transpose of the region just painted.

`ELEMENT_SURFACES` is exactly `["driver","passenger"]` and on every real manifest
both flanks are tall columns at ±90°, so this was not an edge case: **every
placement the element graph has ever made was masked with a transposed
rectangle.** Measured on that run's own stored geometry (driver trim
`{x:2838,y:711,w:979,h:2674}` at −90°, box from `element.lockup`'s output):

| | |
|---|---|
| reading space | 909 × 236 |
| sheet space | **236 × 909** |
| old mask | x 3080..3989 — **172 px past the flank's own right edge (3817)** |
| new mask | x 3080..3316 — inside its column |
| lockup ink outside the old mask | **74%** |

Zero was always the right threshold; the mask was wrong. `sheetPlacement` now
also returns `sheetWidth`/`sheetHeight` (the transpose on ±90, identical on 0)
and the guard masks with those. The resize still takes the reading pair, the
placement algebra is byte-identical, and an unrotated zone is unchanged.

**A FIXTURE LAXER THAN THE REAL THING CANNOT CATCH A DEFECT OF THE REAL THING —
the fifth time this file has recorded that shape.** Every fixture in
`atlas-three-tier-layers` used the default `rotationDegrees = 0`, so the guard had
only ever been exercised in a configuration production cannot produce, on the two
surfaces that are always rotated. Locked by the +90 and −90 cases there (both
verified to fail against the pre-fix runtime, reproducing the live error code
verbatim), an unrotated case pinning that the identity path did not move, and a
**live-geometry fixture** in `tests/atlas-master-composite.test.mjs` built from
`ac8ab0a0`'s own rows.

**Two things checked and found already correct, so do not "fix" them:**

1. **The ordering.** `composePassengerFromDriver` runs BEFORE the composite
   (`flat-first-atlas.cjs` ~3855 vs ~4111), so the mirror flops the CLEAN base
   and the lockup drops onto both flanks un-flipped afterwards. Reversing that
   order would rebuild the reversed-passenger defect inside the new architecture.
2. **The box algebra.** Driver `xPct 0.08` width `0.34` mirrors to
   `1 − 0.08 − 0.34 = 0.58`, exactly the passenger placement the live run
   recorded. "The mirror is the box, never the element" holds in the numbers.

**The lettering cannot trip the hole gate.** `typeset` emits `#1f2937` (r=31)
and `FLAT_BLACK_CHANNEL_MAX` is 24, so the composited type sits ABOVE the
near-black predicate and the post-composite re-validation cannot convict it as a
cut-out. That re-validation also keeps the clean base on a blocking failure
rather than throwing, so the composite node's own guard was the only hard stop.

**`metadata.elementGraph` has three states and they are NOT interchangeable:**
`null` = never ran · `changed:true` = composited · `changed:false` with `refused`
= ran and its sheet failed re-validation. A run with `cleanBase` on and
`elementGraph: null` ships a wrap with NO company name — treat that as a bug.

**And the canary now CONVICTS that state instead of reporting it.** `2d5a2e30`
put `companyName`/`phone`/`website` on the canary request so the subgraph would
COMPILE; it did not make the canary notice when the subgraph then produced
nothing, so a null `elementGraph` would have passed silently one layer up from
the defect that fix was written for. A null graph on a branded brief now throws,
a refusal back to Layer 0 is reported rather than swallowed, and the composite is
asserted on **both** flanks — a one-flank composite is a half-branded wrap that
every receipt would still call composited. Locked in
`tests/production-canary-contract.test.mjs`.

**ROLLBACK IS ONE FLAG:** `atlas_element_graph: off`. The migration is safe to
leave applied: `master.composite` writes the run's master columns only WHILE THEY
ARE NULL, so hero-driver provenance still records Layer 0.

**BUT THE ASK AND THE COMPOSITOR ARE GOVERNED BY TWO FLAGS, NOT ONE, AND READING
ONLY THE FIRST WAS A TRAP.** The compositor is reached solely through the Call-1
node worker — `generateOrReuseFlatAtlas` requires `atlasCall1GraphEnabled()` as
well before it calls `authorElements` — so `atlas_call1_graph: off`, a documented
kill switch for the HERO CASCADE that says nothing about lettering, silenced the
compositor while Call 1 went on asking for a sheet with no lettering on it. A
wrap with no company name, reachable by flipping an unrelated switch, while this
file and the code comment both claimed half-on was impossible. `cleanBaseEnabled`
now returns false when `DESIGNPRO_ATLAS_CALL1_GRAPH=off`: **the ask follows the
ability.** The opposite coupling is NOT done — `authorElements` drives that same
worker's `tick()` and would hang against a disabled one. Production runs
`CALL1_GRAPH=on`, so this was never live. Locked by the half-on case in
`tests/atlas-clean-base-contract.test.mjs`, verified to fail against the pre-fix
runtime.

**THE MIGRATION MUST LAND BEFORE A v28 RUNTIME, and the commit message that says
otherwise is wrong.** `authorElements` does NOT fail soft on a missing migration:
the nodes run and the LAST one trips the `master_storage_path IS NOT NULL` CHECK
after doing the work, and with `cleanBase` on there is no recovery — Layer 0 has
no company name. The three genuinely soft `null` returns are: flag off, nothing to
place, worker without `authorElements`.

### THE OUTPUT-CLASS INSPECTOR JUDGED A SQUEEZED SHEET (live efca5e03, 2026-09-18)

Both flanks came back die-cut to a truck silhouette — wheel arches, door seams,
handles, mirror — on an `rgb(88,88,88)` surround, and EVERY gate passed it. Every
hole predicate is a DARKNESS test (`holeAt` ≤ 24, `nearBlackAt` ≤ 40) and that
surround is luma 88, so `edgeHoleRatio` read 0.073 against a 0.35 limit,
`nonBlackFraction` 0.939, `opaqueRatio` 1.00000, and the fill had nothing to fill.

**The inspector's prompt was already right** — it names "a vehicle-shaped island …
a plain single-colour surround (grey, white, black or any colour)" — and it
answered `flat_atlas` at confidence 1.0 with "no visible vehicle anatomy", because
it judged the whole 4096² master squeezed into ONE 1280px JPEG, leaving the driver
flank ~303px across its short side and lying sideways. Perception, not wording.
It now transports each surface separately, cropped and rotated into reading
orientation with the same `extract → rotate → flatten` order `cutCallOnePanels`
uses. Without `zones` the request is byte-for-byte the previous one. This is the
SAME defect RULE 0.36 fixed for the lettering reader; the lesson had never been
carried here.

**A colour-agnostic field detector was built and deliberately left NON-BLOCKING.**
`measurePlainSurround` records the dominant plain border field per zone. It
separates the real cases cleanly (efca5e03 driver 0.624 border share vs the Sept-8
good master's 0.064) and it still may not convict: this repo's OWN full-bleed
fixtures — a flat ground with graphics inset from the edge — score **1.000**, more
extreme than the defect, and are legitimate. No border-share threshold separates
"canvas showing through" from "a flat ground that IS the design", which is exactly
why RULE 0.32 refused this detector. Do not promote it without a new
discriminator.

### ⚠️ CLAUDE.md WAS STALE: THE `release.yml` CONCURRENCY HAZARD IS FIXED

The section below warning that a dispatch on `main` cancels the merge's own push
gate describes a defect that **has been repaired**. `release.yml` now keys its
concurrency group on the EVENT as well as the ref, and says so in its own comment.
The ordering advice still stands, but for the migration reason above, not this
one. Verify a concurrency claim against the workflow before planning around it.

## 🚗 RULE 0.35 — CALL 1 IS THE HERO-DRIVER CASCADE: ONE CONVERSATION, NOT ONE IMAGE (owner ruling, Trish 2026-09-11)

> **STATUS 2026-09-14 — HERO-DRIVER IS OFF IN PRODUCTION (owner: "1st call should
> be atlas proof … we got it to produce in under 45 seconds before").** Flag
> dispatched back to `six-surface` on deploy run 1275 (`FLAGS_APPLIED`). The
> cascade cannot pass on a real vehicle as built: a driver flank is ~3.6:1
> (Porsche 178.4″×48.84″ → drift 1.55–1.59) and Gemini 3 Pro Image's widest
> `aspectRatio` is 21:9, so `MAX_ASPECT_DRIFT_RATIO=1.12` refuses every driver
> tile before content is even judged. Three real runs (09-13, 09-14 ×2), 0/3,
> each burning ~94 s and two image calls in FRONT of the ~40 s six-surface
> ATLAS call. Splitting the flank into tiles would fix the aspect but not the
> model's die-cut prior (every refusal since 09-06 is the vehicle's shape drawn
> into the sheet), so tiling is shelved, not planned. Do not re-enable the flag
> without a probe run that passes on a real vehicle manifest.
>
> What was missing and is now built: **the refusal ledger.** 13 refused sheets
> accumulated (09-06 → 09-14) in `wrap-files/atlas-call1/` that no human could
> see while the gates that refused them were tuned blind. Every refused Call-1
> candidate is now recorded in `designpro_atlas_refusals` (runtime
> `recordAtlasRefusal`, best-effort), read by the owner through
> `designpro_atlas_refusal_paths` → gateway
> `GET /api/generation/requests/:id/atlas-refusals` (signs via storage policy
> `designpro_owner_sign_atlas_refusals`), and shown on the failure screen
> (`AtlasRefusedSheets`) with each gate's verdict verbatim. Judge the gates
> from those pixels before touching a threshold. Two candidates to judge first:
> the 09-06 "no healing" ruling refuses cutouts although a deterministic
> ~100 ms `atlas-cutout-fill` exists (wheel-arch/glass regions are trimmed at
> install), and the output-class inspector refused a *"vintage Porsche Martini
> race team"* brief because "the image contains a side profile of a race car" —
> the artwork's subject, not a vehicle mockup.
>
> **RULING 2026-09-14 (owner: "Fix it omg … get designpro working end to end")
> — RULE 0.15 RESTORED, INSPECTOR NARROWED. Both gate changes are deliberate
> reversals; do not "restore" the 09-10 behaviour.**
> 1. **A cut-out is a print defect, not a broken design.** A wheel-arch / glass
>    / bed opening in an otherwise full-bleed panel is repaired by the
>    deterministic `fillMasterCutouts` (pixel continuation, no AI), the repaired
>    sheet is structurally RE-VALIDATED (`flat_atlas_repaired_master_invalid` if
>    it does not yield six clean regions), re-classified on its own bytes, and
>    then ACCEPTED — one image call, no ledger row. The 09-10 (82da00d) refusal
>    of cut-outs in the loop and before the fill turned the fill into dead code;
>    7 of the 13 refused sheets since 09-06 were cut-out-only. The silhouette
>    case (artwork never reaching its own borders, `edgeHoleRatio`) is NOT a
>    cut-out and still refuses; the field fail-over tests now use that fixture.
>    Locked by `tests/atlas-authored-topology.test.mjs` ("repaired … on ONE
>    image call") and `tests/atlas-authoring-recovery.test.mjs`.
> 2. **The output-class inspector convicts pictures of vehicles, not livery.**
>    Its prompt named "grille, headlight, door or window shapes" and "printed
>    panel names (ROOF, REAR, DRIVER)" as vehicle_depiction, so it refused two
>    Porsche Martini race-livery sheets for their own motifs and a six-panel
>    sheet for having hood/side/rear panels. It now states that motifs and panel
>    captions are `flat_atlas`; a whole vehicle in perspective/elevation with
>    real wheels, a scene, reflections, or a vehicle-shaped island on a plain
>    surround remain `vehicle_depiction`. Locked by
>    `tests/atlas-output-class-gate.test.mjs`.

**Supersedes the "one image request" half of the 2026-08-31 artifact-graph
contract and the 2026-09-06 six-surface restoration wherever they conflict.
The gates, the lineage, the assembly and everything after Call 1 are untouched.**

Owner, verbatim: *"It must create the hero driver side and then flip the driver
for passenger side then show each to each side generated in parallel so for
instance rear would see driver, passenger, front and hood then roof would see
all."* — *"Requires multi-turn spatial reasoning. Passing the thought_signature
from the hero driver-side generation into the passenger/rear/hood requests
locks the design continuity across all panels."* — *"Keep Gemini Image Pro 3.
DO NOT USE VERTEX or IMAGEN."* — *"we need speed a 7 minute orchestration is not
good."* — *"OK Go with this LETS DO IT GET IT COMPLETED."*

**Why (measured, designproai-os-prod, 21 days to 2026-09-11):** 73 failed /
43 delivered. After the slot infra was fixed on 08-27, **36 of the 52
failures were the ONE-IMAGE Call 1 drawing the vehicle into the six-surface
sheet and a gate correctly refusing it** — across v23, v24 one-field, v27,
v28 and v29. Five prompt versions did not move that number. The shape of the
ask does: one 21:9 rectangle of printed artwork is the ask this model answers
cleanly; six related rectangles of one vehicle on one 4096² canvas is the ask
it keeps failing.

**The cascade** (`runtime/atlas-hero-driver.cjs`, hybrid wiring chosen for
latency, ≈1.8 min to a full master at the measured ~35 s per call):

| stage | surfaces | how |
|---|---|---|
| 1 | driver | the hero — from scratch, through the REAL persona brain (`buildDesignIQPrompt` with `atlasHeroSurface`, edge mode `atlas-author`, `first:true`) |
| 2 | passenger | `flop(driver)` in code, then the existing brand-band mirror re-drops lettering forward. **Zero model calls.** |
| 3 | hood · front · rear | **in parallel**, each a continuation of the SAME conversation: the driver exchange replayed with its thought signature on the part it arrived on, driver + passenger attached as references |
| 4 | roof | sees all five; replays driver, hood, front, rear (trimmed to the request budget) |
| — | assemble | `assembleFinishedMaster` places the six rectangles in the GENIE manifest zones; the SAME whole-master gates then judge the sheet |

Every surface is bounded (two requests, the second without the replayed
chain — which is also the fallback for a rejected signature from a
linearised parallel branch), evaluated by the same "hole" predicate the
master gate uses (`MAX_AUTHORED_HOLE_RATIO`), resized to its exact zone, and
idempotent under the provider cache (`attemptKey: author:<surface>:<n>`), so
a worker restart re-reads accepted sheets instead of regenerating them.

**Selection and safety:** `DESIGNPRO_ATLAS_TOPOLOGY=hero-driver` (deploy
input `atlas_topology`) turns it on; unset, six-surface with its one-field
fail-over runs byte-for-byte as before. A refused hero pass — any surface
refused, the assembled sheet refused by the gates, or the passenger mirror
declining on a design that carries lettering — **fails over to six-surface**
with the refusal recorded as `metadata.authoringFailover`. Revision edits
keep their parent's topology. Nothing here touches a gate threshold, Call 8,
Call 9, QC, Topaz, ZIP or WrapBox. The per-surface receipt lives on the
revision as `metadata.heroDriverAuthoring`.

**Acceptance is the owner's eye, not a green suite:** the probe workflow
(`atlas-hero-driver-probe.yml`, no production rows) hands over six images
first; then one real generation through proofs, both QC gates and WrapBox;
only then does the deploy input flip the default. Locked by
`tests/atlas-hero-driver-topology.test.mjs`.

### RULE 0.35 ADDENDUM — THE CASCADE RUNS AS A DURABLE NODE GRAPH (owner, Trish 2026-09-11: "Graph orchestration in parallel wherever you can improve latency")

The first tether ran the cascade as ONE in-process function: a `Promise.all`
inside the generation worker, no node rows, no cross-worker claims, no
per-surface retry. Another session named it exactly — *"it is a graph in one
half of the system and not in the other, and the half that is failing is the
one that is not."* The owner ruled: make it one. It is now.

**`runtime/atlas-call1-graph.cjs` + migration `20260911170000_designpro_atlas_call1_graph.sql`**,
built on the 2026-09-08 PanelProFileOutput graph pattern, not on the Calls
8–12 kernel (whose CHECK constraints and string-patched PL/pgSQL are left
alone):

| | |
|---|---|
| **Run** | `designpro_atlas_call1_runs`, one per (generation request, definition hash): manifest, frozen input, creative context, provider identity. Idempotent — a re-claimed generation finds its run and its completed surfaces, spends nothing. |
| **Nodes** | `designpro_atlas_call1_nodes`: `surface.driver` → `surface.passenger` → `surface.hood` / `surface.front` / `surface.rear` → `surface.roof` → `master.assemble`, with `depends_on` = exactly the surfaces each is SHOWN plus the exchanges it REPLAYS. Nothing else orders it; whatever is not an edge runs in parallel. |
| **Claim** | `claim_designpro_atlas_call1_node` — `FOR UPDATE SKIP LOCKED`, parents completed, **the run's generation request still `leased`** (the claim returns the current lease token; the edge authorises the provider request against it exactly as before — RULE 0.26 unchanged). Hood, front and rear are claimable in the same instant passenger completes, and BOTH runtime processes (`runtime-1`, `runtime-2`, each `DESIGNPRO_ATLAS_CALL1_NODE_CONCURRENCY` slots, default 3) draw them. |
| **Lease / retry** | 600 s lease, 30 s heartbeat, `max_attempts` 3 with backoff; a lost lease re-runs ONE node (the provider cache's `author:<surface>:<attempt>` keys make the re-run read its own earlier image request instead of spending another). `attempts_exhausted` → run failed; `resume_designpro_atlas_call1_run` re-arms retryable failures only. |
| **Refusal** | A creative refusal (`flat_atlas_hero_driver_refused`, the surface drawn wrong twice) fails the node non-retryably and the run once; `author()` throws the SAME `HeroDriverRefusal`, so flat-first-atlas fails over to six-surface untouched. |
| **Ledger** | `designpro_atlas_call1_events` (immutable): every transition of every node with the worker that held it. "What happened to the hood" is a query. |

**Same primitives, same door, same gates.** A node runs `authorSurface` /
`composePassengerPlaceholder` / `assembleHeroMaster` from
`atlas-hero-driver.cjs` through `createAtlasAuthorTransport` (the ONE edge
transport, exported from flat-first-atlas and handed to the node worker by
`index.js`). The assembled sheet lands in front of the same master gates.
`provenance.execution = "graph"` + `provenance.graph.nodes[].leaseOwner`
record which process drew each surface.

**Kill switch: `DESIGNPRO_ATLAS_CALL1_GRAPH=off`** (deploy input
`atlas_call1_graph`, sticky in `configure-env.sh`) runs the in-process
cascade. A database without the migration is logged and recorded as
`provenance.graph.unavailable` and falls back in-process — never silent.

**Honest latency statement.** The critical path is still THREE sequential
model calls (driver → {hood, front, rear} → roof) whichever process runs them.
Nodes buy durability, both-worker parallelism, per-node retry and a queryable
timeline; they do not shorten that path. The next latency levers are
wider wiring (roof beside hood/front/rear, showing driver + passenger only)
and releasing the driver's 3D proof before the roof lands — both are edge
changes to the graph definition, not new orchestration.

**Deploy plumbing corrected in the same change (would have failed the dark
deploy):** `validate-env.py` did not permit `DESIGNPRO_ATLAS_TOPOLOGY` and
refuses an empty value, and `configure-env.sh` wrote it EMPTY for
six-surface. The writer now spells `six-surface`; the validator permits
`{six-surface, hero-driver}` and `DESIGNPRO_ATLAS_CALL1_GRAPH ∈ {on, off}`
when present (never required — the upgrade lesson of run 34254151959).

Locked by `tests/atlas-call1-graph.test.mjs` (the real migration on PGlite,
a two-worker end-to-end run, the refusal path, the runtime seams) and
`ops/tests/server-cutover.test.mjs` (the env vocabularies).

## ✂️ GRAPHICSPRO IS ROUTED, PORTED AND LOCKED (owner-directed, Trish 2026-09-11: "Graphicspro must work end to end")

Full record: `docs/GRAPHICSPRO-END-TO-END.md`. What was measured: the
GraphicsPro product in `app/src` was a byte-identical RestylePro copy that no
route served, and every edge function it invokes and every table it reads was
absent from this repository and from the DesignProAI Supabase project.
MyVehiclePro for GraphicsPro was broken in RestylePro as well (the panel never
sent a styling prompt or the mockup; the function 400'd on every click).

- **Routes** `/graphics-pro`, `/graphics-pro-wall`, `/graphics-pro-window`,
  `/graphicspro` (redirect); sidebar key `graphicspro`, tier `complete`. One
  tool serves walls, windows and vehicles; interior-mount window graphics are
  cut in REVERSE (the kit is mirrored); vehicle zones come from every
  uploaded angle.
- **The cut-contour files are PRODUCED, deterministically** (owner: "it must
  design and produce cut contour designs and files"). `_shared/cut-contour/`
  executes the WePrintWraps guide: unified silhouette cut line as a real PDF
  `Separation /CutContour` (CMYK 0/100/0/0) 0.25 pt stroke, the artwork's own
  colour bled 1/4" past it, layers CutContour / Artwork / Bleed for Print &
  Cut and — WPW File Prep: "layered vector files are required" — one vector
  film layer per colour with offset-path bleeds and no raster for
  Manufacture Film Cut, every graphic nested on one sheet ≤ 51.5", 10% scale
  with the scale in the name beyond the 200" PDF limit, manual-review flags
  (letters under 2", hairline, > 200 vertices, tiling). `cut-contour-build`
  file-prep mode serves it (PDF + SVG + ZIP + sheet size to order);
  `run_production` stages 2–4 are that one call and pricing is the nested
  sheet. The flat artwork is briefed as cut-ready input. No model, no
  secret on the cut line; `cut-map` / `generate-cut-files` / VTracer /
  Replicate are not carried. Locked by `tests/cut-contour-geometry.test.mjs`
  and `_shared/cut-contour/produce.test.ts` (deno).
- **Recovered edge functions (RULE 1)**: `generate-graphics-pro`,
  `graphicspro-on-vehicle-photo`, `edit-vehicle-photo`, `cut-graphics-proof`,
  `cut-contour-build`, `vectorize-it`, plus `_shared/myvehicle-prompt-builder.ts`.
  Deltas are inline and deliberate: files live in the **public
  `graphicspro-files` bucket** (wrap-files is private here); RestylePro's
  `quick-prep-pdf-export` is not carried (its PDF never embedded the artwork);
  `vectorize-it` requires `VECTORIZE_DROPLET_URL` and carries no RestylePro
  droplet IP.
- **MyVehiclePro contract**: the approved mockup rides as `colorData.designUrl`
  (IMAGE 2) and the brief as `customStylingPrompt`; vehicle jobs only.
- **Schema** `20260911210000_graphicspro_cut_contour.sql`: the live RestylePro
  shapes, `surface_type` admits `'studio'`, `shop_pricing_config.user_id`
  UNIQUE, pricing seeded (Avery 6.32 / 3M 6.92 per sq ft).
- **Konva on the customer's photo** is the existing `ZoneMasker` (react-konva)
  on wall, storefront and every uploaded vehicle angle; the rectangles are
  burned into the photo (`composeZoneOverlay`) and sent first as the hard mask.
- **Step two, not started**: move Topaz / VTracer / BiRefNet stages onto the
  droplet runtime as a durable node graph (the WallPro production pattern),
  then signed reads. Acceptance is the owner's eye on a fresh generation.

Locked by `tests/graphicspro-end-to-end.test.mjs` and
`supabase/tests/graphicspro_cut_contour.test.sql`.

## 🧱 WALLPRO ACTIVE CONTRACTS (owner-directed, Trish 2026-09-11)

WallPro is the wedge product: a wall is one flat rectangle, so "output the
panels correctly every time" is deterministic here. These are the live
contracts; each names its lock.

- **Flat first, then imposed (owner, 2026-09-11).** The flat rectangle is the
  product and the print file, so generation needs the wall size and nothing
  else (`wallGenerationBlocker`). With a photo and no valid corners the flat
  design shows first; four valid corners switch on the on-wall view
  (`wallPreviewBlocker`). Corners never block generation or print files
  (`tests/wallpro.test.ts`). **The client sees both at once**: the flat
  master stays on screen beside the photo pane, which shows the same file
  imposed the moment the corners exist (`WallPro.tsx` preview section).
- **Upload takes the photo the phone actually gives us (owner, 2026-09-12,
  from an iPhone: "button won't press for upload").** The picker is opened by a
  real `<button>` calling a `sr-only` input's `click()`, never a transparent
  file input laid over a label — on a phone that overlay is one hit-test away
  from doing nothing, and a tap that does nothing reads as a broken app. The
  accept list is wide (`image/*` plus the HEIC/HEIF extensions) so the iOS
  photo picker offers every photo, and `prepareWallUpload`
  (`app/src/lib/wallpro-render.ts`) converts what comes back: a JPG, PNG or
  WebP passes through byte for byte so a print-ready upload is never
  re-compressed, and anything else — above all iPhone HEIC — is decoded and
  re-encoded to JPEG once in the browser, under the 58 MP ceiling the
  validator enforces. The old "export HEIC first" refusal is gone: nobody
  exports a file while standing in front of a wall. Locked by
  `needsWallTranscode` tests in `wallpro.test.ts`.
- **Corner detection runs on upload; masks are marked by hand.** A wall photo
  is sent to `detect-wall-openings` the moment it is chosen and only the four
  corners land, as editable preview state; the photo starts as the full frame
  so nothing errors before detection lands. **That default is never displayed.**
  The on-wall composite waits for `wallLocated` — valid corners AND
  `cornerSource !== 'default'`, so detected, hand-marked or restored — because
  painting the design across the untouched full frame covers the room: the flat
  pane and the photo pane then show the same picture and the photo is gone
  (owner, 2026-09-12: "I replaced artwork and clicked show on my wall didn't
  work", then "the photo disappeared and it just shows the same image twice").
  Until the wall is located the photo pane stays on the photo, the "On your
  wall" tab is not offered, and a notice says whether detection is still
  running or the four corners need marking. Print files never wait on any of
  it. Protected areas
  (windows, drapes, furniture) are hand-marked, or requested explicitly with
  "Auto-mask windows & furniture" (segmentation masks, preview-only). Owner,
  2026-09-11, after auto-masks swallowed the wall: "just have people mark it".
  Signed-out or failed detection never fails the upload. Print panels stay
  full rectangles (`wallpro-detect.test.ts`). **"Show me with AI"**
  (`render-wall-view`) paints the flat master onto the room photo with the
  image model and leaves everything that is not wall untouched; it is a
  presentation picture, never a print file (`wallpro-view.test.ts`).
- **WallPro designs live in RevisionStudioIQ and on the team board.** WallPro
  is its own app on DesignProAI, like GraphicsPro, so its designs join the
  RevisionStudio grid (`listWallDesignsForStudio` → `wallStudioRow`,
  `mode_type: wallpro`, row id = project id, panels in `admin_notes.wallpro`)
  and the admin/tester board at `/admin/wallpro-production` finds any
  customer's 150 PPI panels by DesignID (`wallDesignId(versionId)`, e.g.
  `DID-60553D10`). A reload without `?project=` reopens the last project
  (`wallpro:last-project`); "Start fresh" is the only way to a blank wall.
  Locked by `wallpro-studio.test.ts`.
- **Seamless is measured and closed by code, never by re-asking the model.**
  `app/src/lib/wallpro-seamless.ts`; the print export refuses an unverified
  repeat (`wallpro-seamless.test.ts`).
- **Scale is decided by code from the wall inches, never asked of the
  customer** (owner, 2026-09-11, after a mural printed with three-foot
  flowers: "WallPro should use its brain and know how to scale").
  `app/src/lib/wallpro-scale.ts`: the brief's words and the wall width pick
  tile-versus-mural (`autoWallScale`) and the tile's real-world width
  (`autoRepeatWidthIn`: about TWO repeats across — the same measured baseline a
  match gets — unless the brief names a genuinely fine material, a slat, plank,
  tile or weave (`FINE_MATERIAL_WORDS`), which keeps four across. Four across
  for a botanical is what produced a dense craft-fair print, owner 2026-09-12:
  "design gen is horrendous, also pattern way too small");
  the generator is told that width and the mural's inches so motifs are
  drawn at print size (`prompt.ts`); production tiles at exactly that width.
  Auto is the product; Mural and Repeating pattern remain overrides. A 4K
  master is never called print-ready unless pixels over wall inches say so.
  **On a match, the uploaded reference IS the scale baseline** (owner,
  2026-09-12, looking at a matched tropical mural returned at a quarter size:
  "not matched and the pattern is too small, there should be a base line"). A
  reference photograph of a covering already depicts a wall-sized area, so
  the baseline is MEASURED off a real installed wall, not assumed. The owner
  photographed the same design hung in her own room (2026-09-12, "this is the
  size pattern, see the difference"): against a 74-inch sofa and a 26-inch
  shelf the anthurium blooms print about 10 inches, which puts that design's
  full repeat at 74 to 87 inches on a 142-inch wall. The generic four-across
  (36") was half life size; treating the file as one wall width (142") was
  double. `autoMatchRepeatWidthIn` therefore repeats a matched design about
  TWICE across the wall, on the same 6-inch steps, clamped 48 to 96 — 72 inches
  on that wall, inside the measured band, with the pattern-size slider reaching
  the rest of it (110% is 79 inches). Naming the material ("slatted", "floral",
  "stone") describes the reference and never re-scales it; only a brief asking
  for one scene makes it a mural. The tile sentence "a bloom or a leaf a few
  inches across" directly contradicted the match instruction to keep the
  reference's motif scale, so a match never receives it. The match branch of `prompt.ts` states the baseline and never
  carries the small-motif or many-elements sentences. The pattern-size slider
  is then how a customer tiles it down from there. Locked by
  `wallpro-scale.test.ts` and the match-prompt tests in `wallpro.test.ts`.
- **A design uploaded to match goes on the wall before a token is spent**
  (owner, 2026-09-12: "I'm uploading an image and it's not showing on the
  image"). `previewArt` falls back to the reference on the match intent, so the
  flat pane and the on-wall composite show it at once, labelled "Your uploaded
  design — not print-ready yet". Preview only: every print, version and
  production path still reads `artwork`, which exists only after a generation.
  A finished generation also scrolls the page to `#wall-preview` and names the
  two view buttons in the notice, because on a phone the preview card sits
  below the fold and a completed design looked like nothing had happened
  (owner: "what button do I push so I see the recreated design on the photo I
  provide" — none; it lands there by itself).
  Locked by `wallpro-scale.test.ts` and `wallpro.test.ts`.
- **Pattern size is PatternPro's slider, ported (owner, 2026-09-12: "Look at
  PatternPro, we literally had this").** Reference: `restylepro-os`
  `src/components/tools/modes/WrapByTheYardMode.tsx` (30–300 % slider, the
  swatch previewed as `background-size: 100/scale%` repeated). In WallPro the
  design is the swatch: `patternSizeAtScale` draws it at the percentage of its
  generated width, a mural being one swatch the size of the wall (smaller
  repeats it, bigger crops it to the middle). **The 59-inch panels never
  change; the design is what scales.** Deterministic, no token, and one
  geometry everywhere: a tile larger than the wall is centred on it by
  `tileOrigin` in `wallpro-geometry.ts` and the identical rule in
  `runtime/wallpro-production.cjs`, so the flat pane, the on-wall view and the
  print file agree. **Pattern size never changes print size** (owner,
  2026-09-12): `planPanels` / `planWallPrint` read wall inches, bleed, overlap
  and the 59-inch roll only, so the wall, the panel count and the file's
  dimensions are identical at every percentage — the only thing that changes is
  how big the design is drawn on them. The honest limit on "bigger" is
  resolution, and the control states it live: `patternPpi` shows the master's
  own pixels over the inches it is drawn across, and `maxPrintSafeScale` offers
  the largest fully sharp size rather than letting Topaz invent detail
  silently. The slider commits on release (`onValueCommit`, with a 400 ms
  fallback for touch and keyboard) and previews instantly in CSS meanwhile, so
  one exact canvas render happens per decision instead of one per tick; the
  on-wall composite keeps its last image while the next renders and only blanks
  when the wall or the design itself changes. Locked by
  `wallpro-scale.test.ts`, `wallpro.test.ts` and
  `source-tests/runtime/wallpro-production.test.mjs`.
- **The roll is 54 inches, and every panel is written as TIFF, PDF and PNG**
  (owner spec sheet, 2026-09-12: Avery HP MPI 2610 wall vinyl, matte/luster,
  billed per linear foot, "all panels billed at 54\" width, regardless of
  actual printed width"). `WALLPRO_PRINT_WIDTH` and the runtime's
  `DEFAULTS.panelWidthIn` are BOTH 54 and must stay equal; they were 59 until
  2026-09-12, which is wider than the media, so those panels could not be
  printed at all. Lower both if the press needs an edge margin — every panel
  plan, seam guide, preflight and print file follows from that one number.
  Each panel is stored three ways from the same pixels (`PRINT_FORMATS`):
  `.tif` lossless LZW with the resolution tag (the RIP's file), `.pdf`
  flattened — one page at the exact printed size, one FlateDecode DeviceRGB
  image, no layers, fonts or transparency, written by hand because the runtime
  image carries only sharp — and `.png` for the UI. A format that fails to
  encode fails SOFT and records its reason; the panel is already stored.
  Locked by `source-tests/runtime/wallpro-production.test.mjs`, which reads the
  TIFF compression tag, inflates the PDF image stream back to the panel pixels
  and checks every xref offset.
- **The print file is ONE file.** Every production job stores the whole wall
  with bleed as one PNG at the panel PPI (`stitchWholeWall`, stitched from
  the enhanced panels' own pixels, 450 MP budget, fails soft) and every
  surface shows it first as "Print file"; the 54-inch panels are the fallback
  for a RIP that cannot tile. Locked by
  `source-tests/runtime/wallpro-production.test.mjs`.
- **TWO PERSONAS, ported from the vehicle stack (RULE 1)** — owner, 2026-09-12:
  "look at the vehicle wrap designer edge functions… persona based designer".
  References: `supabase/functions/persona-csr-enrich` (consultant) and
  `_shared/persona-designer-prompt.ts` (designer), whose own header states the
  rule WallPro had broken: *"Prompt length = quality killer. Keep under 4K
  chars total. Every word must earn its place."*
  **Measured when "design gen is horrendous" was reported:** the assembled wall
  prompt was **4,501 characters, of which 3,342 were generic persona
  boilerplate and 44 were the customer's brief** — the persona outweighed the
  design 76 to 1, so every wall came back as the average of the persona. Adding
  more persona text made it worse, which is what the first attempt at this did.
  The vehicle stack solves it with two personas, not a longer one:
  `wallConsultantPrompt` (persona 1) turns the customer's words into a brief
  with named colours, arrangement and flow, and `WALL_DESIGNER` (persona 2)
  stays short because the brief now carries the content. `DESIGN_TRANSLATION`,
  `CAPABILITIES` and `ARCHITECTURAL_SCALE` are deleted: a consultant writing
  specifics beats a generic lookup table. Assembled prompts are now ~2.3–2.7 K
  and a test fails the build above 4 K.
  `enrichWallBrief` runs on `prompt` and `wall` only (a match reproduces the
  reference, a refine edits a version), **after the credit is reserved** so an
  unreserved request never spends it, and **fails soft** — no answer, bad JSON
  or a timeout and the customer's own words go through unchanged. The designer
  also emits a name and a `DESIGN ANCHOR` (palette in hex, placement, flow)
  before the image, exactly as the vehicle designer does, so a refinement has
  something exact to hold. The tile instruction states the hero motif's size in
  inches from the repeat width instead of the old "a bloom or a leaf a few
  inches across", which was the sentence producing dense all-over prints.
  **The consultant applies real industry design knowledge when a business or
  space type is named** (owner, 2026-09-12: "a wrap for a restaurant... using a
  knowledge baseline... amplifies prompts... like a real custom wrap/wallpaper
  designer"), the same move the vehicle stack makes inferring an industry from
  a company name (`persona-csr-enrich`, "infer the industry from the company
  name"). It draws on Gemini's own knowledge of how that kind of space is
  actually designed by working commercial interior designers — palettes,
  materials, motifs, mood — and states that language explicitly in the brief.
  This is amplification, never replacement: every subject, colour, mood or
  style word the client actually used survives into the brief unchanged, and a
  named business type is licence to fill in what was left unsaid, never to
  invent a different subject. Locked by the prompt-budget, consultant and
  handler tests in `wallpro.test.ts`.
- **Five entry paths are generator intents**: Pick a design (catalog), Match
  my design (`match`: the reference IS the design), Design for my wall
  (`wall`), Describe a design (`prompt`), Use my print-ready file. The
  generator logs model, requested 4K, aspect, returned size and required
  enlargement (`supabase/functions/generate-wall-design`).
- **Design sessions: CREATE → REFINE* → APPROVE → PRODUCTION.** Refinement
  edits the current version in place (`intent: 'refine'`), every refinement is
  a new immutable version, outside-mask pixels are restored deterministically,
  any version can be restored, exactly one version is approved and production
  reads only it. `docs/wallpro/WALLPRO-REFINEMENT-WORKFLOW.md`, migration
  `20260911150000_wallpro_design_versions.sql`.
- **Ready-to-sell catalog (WrapReady Designs, wall medium).** DesignID =
  the library `WPB-0001..0500`; GenerationID + master SHA-256 are the
  canonical truth; SynthID is provenance only. `docs/wallpro/`,
  `/admin/wallpro-batch`, `wallpro-catalog.test.ts`. **The batch generator
  calls the same `generate-wall-design` edge function the customer designer
  does** (`generateWall`), so every batch job already runs through the
  two-persona pipeline (RULE above) and its industry design knowledge — but it
  was NOT sending the tile width the curator's own "Repeat tile width" field
  collected, so a repeat batch job told the model nothing about motif scale at
  all (owner, 2026-09-12: "redo the batch generator to follow the same edge
  functions"). `runOne` now passes `repeatWidthIn: job.tileWidthIn` on a repeat
  job. The batch UI's own default also moves from the legacy four-across craft
  scale (`DEFAULT_TILE_WIDTH_IN`, 24, kept only as the fallback for historical
  rows with no stored width) to the measured two-across architectural baseline,
  48 inches on the tile's own 96-inch square canvas — the curator can still
  type any width per batch or per job.
- **The batch feeds the personas NATURAL-LANGUAGE briefs, the RestylePro
  batch pattern (RULE 1; owner, 2026-09-14: "I don't understand why we didn't
  use persona engineering … natural language prompts required … that batch
  needs to pattern how RP's Vehicle Batch design app. Every single one was
  fantastic. SEE ZERO AI SLOP. Designer Persona is Key!").** What made
  RestylePro's batches work was measured in its code, not guessed:
  `src/data/prompt-presets.ts` (128 vehicle briefs) and
  `src/data/wall-prompt-presets.ts` (111 wall briefs) are each ONE customer
  brief in plain prose — subject, named colours, technique, mood — and
  `supabase/functions/generate-batch-prompts` is a Gemini-flash brief-writer
  persona that writes fresh ones; the batch page then sends `preset.prompt`
  to the same edge function a customer's words reach, and the two personas
  design. The 500-row `wallpro-prompt-library.json` is the opposite object: a
  spec sheet ("Concept: … Visual language: … Palette: … Visual intensity:
  …") followed by production boilerplate, and `batchCreativeBrief` only
  rewrote that sheet through lookup tables — a template, not a brief, which
  is exactly the "average of the persona" failure the two-persona rule
  describes. Ported: `app/src/data/wallpro-presets.ts` (the 111 RestylePro
  wall presets verbatim, IDs re-keyed to the catalog's `WPB-` DesignID CHECK,
  plus residential Etsy sets for the three rendering families the owner
  supplied — flat bold print, fine-line engraving, photoreal faux material —
  every repeat naming its motif size in inches); and
  `supabase/functions/generate-wall-batch-prompts` (curator-only: JWT +
  `user_roles` admin/tester, the catalog's own RLS predicate; never on the
  customer path, so the "no extra LLM stage before the customer sees
  anything" rule holds), whose persona is a wallpaper studio's creative
  director writing 50–110-word client briefs with the ground colour named,
  the technique, the repeat structure and inches, and a ban on marketing
  adjectives, production words, mockups, text/logos and named artists;
  `normalizeGeneratedBriefs` drops what breaks that and stamps
  `WPB-AI-<stamp>-<nn>`. `WallPromptEntry.brief: 'natural'` is the contract:
  `briefForEntry` sends such an entry to the consultant VERBATIM; only the
  legacy structured library still goes through `batchCreativeBrief`. The
  batch page's "Brief source" is presets (default) / AI brief writer /
  legacy library; nothing after the request changed (same edge function,
  same personas, same seam ladder, same publish row). Locked by
  `wallpro-presets.test.ts` (every preset catalog-legal, spec-sheet-free,
  under the 4K lock through the real prompt builder, publishable through
  `designUpsertRow`) and `wallpro-brief-writer.test.ts` (persona text, the
  normalizer, curator gate, provider failure paths). Acceptance is still the
  owner's eye on a fresh batch.
- **Production rules** (owner workbook, `docs/wallpro/WALLPRO-BATCH-PRODUCTION-RULES.md`):
  one canonical master, never AI-generate panels, duplicated overlap identical
  on both panels, seam QC, 150 effective PPI from real pixels.
- **Production panels: 150 PPI through Topaz, per panel, on the runtime
  (owner, 2026-09-11: "make it 150 and auto run topaz").** Approving a version
  auto-requests `request_wallpro_production`; the droplet runtime claims the
  job (`claim_wallpro_production_job`, `runtime/wallpro-production.cjs`),
  rasterises each 54-inch panel (the roll width, overlap inside it) from the approved master at native density,
  enhances it through the same `enhancePanel` Call 12 uses (fails closed when
  Topaz is unavailable), lands on panel inches × 150 exactly, stamps the PNG
  density and stores it under `{owner}/production/{job}/` in `wallpro-files`.
  Why per panel: a 4K master over a wall is ~30 PPI and Topaz caps one request
  near 96 MP, so a whole-wall 150 PPI master is not one request; a panel is.
  Panels are independent graph nodes and build in parallel
  (`DESIGNPRO_WALLPRO_PANEL_CONCURRENCY`, default 3); only the manifest waits.
  Migration `20260911190000_wallpro_production_jobs.sql`; locked by
  `source-tests/runtime/wallpro-production.test.mjs`.

## ONE-FIELD FAIL-OVER: A REFUSED CALL 1 NEVER LEAVES THE CUSTOMER WITH NOTHING (owner-directed, Trish 2026-09-10)

Measured, 2026-09-04 → 09-09: 20 generation requests, 8 delivered, 12 failed.
Seven of the twelve were Call 1 drawing the vehicle into the sheet (wheel
arches, side-profile silhouettes, `vehicle_depiction`), refused twice by the
gates, then `failed` with nothing for the customer. The successes cluster on the
2022 F250 Crew Cab, which is the vehicle in the Flamingo teaching proof; the
failures cluster on Transit vans, a Model X and F250 box variants. Owner:
*"every time I try a design it fails"*, *"it should never take 7 minutes"*.

**The six-surface contract stays the product and keeps its 2026-09-06 budget
unchanged** (one candidate, one unchanged fallback, no corrective text). What
changed is the exhaustion path in `generateOrReuseFlatAtlas`: instead of
throwing, it fails over ONCE to the v24 one-field contract (RULE 0.33, Field
Recovery v2 — the only configuration that has measured clean, anatomy-free
flanks), with `attemptKey: master:field:1`, the field request body
(`fieldContract`, `noseEdge`, no teaching sheet, no guide), the field
territories cut in code, and the same gates. The revision records
`metadata.authoringTopology` (`six-surface` | `field`) and
`metadata.authoringFailover` (the exact six-surface refusal code, reason,
attempt count and raw candidate paths). Resume paths recognise a field
acceptance through the stored revision's `manifest.topology` and, when the row
never landed, through the shared checkpoint read with the field manifest hash.
The fail-over rides the authoring fence the six-surface pass holds (or found
spent), so it can never turn a spent fence into a live request.
`DESIGNPRO_ATLAS_FIELD_FAILOVER=off` restores fail-closed; nothing else does.
Locked by `tests/atlas-authoring-recovery.test.mjs`.

**The output-class question now names the failure it missed.** New Aura
(`DID-664D054D`, 2026-09-10 00:26Z) was accepted with both flanks drawn as an
Urus side profile on a plain grey surround and ROOF / REAR painted as captions:
the hole gate only convicts near-black fields and the classifier answered
`flat_atlas`. `outputClassPrompt` now states that vehicle-shaped artwork inside
a rectangle, an any-colour plain surround, and printed panel captions are
`vehicle_depiction`, and that `flat_atlas` requires every rectangle filled
corner to corner. Post-generation only; no authoring conditioning changed.
Locked by `tests/atlas-output-class-gate.test.mjs`. A deterministic
colour-agnostic field detector was deliberately NOT added: flat-colour
commercial wraps are legitimate, and the discriminator would convict them.

## Finishing is optional; it may never kill a generation (2026-09-09, measured)

New Aura Day Spa, `DID-664D054D`: Call 1 was recovered, Driver/Passenger/Hood
were finished and checkpointed, and one interrupted roof finishing exchange
(edge `409 provider_outcome_unknown` after 31.6 s, read from the live Supabase
function logs) failed the whole request as terminal. That is the wrong blast
radius, for the same reason RULE 0.15 gives about cut-outs: a defect that only
exists in an optional edit must not destroy the design.

Now: the shared `invokeAtlasAuthoring` transport (PR #349) carries a deadline
and, after an interrupted or unknown exchange, re-reads the SAME provider
request cache-only up to three times (the proof transport's pattern). `finishingFailureDisposition`
(`runtime/atlas-panel-authoring.cjs`) then decides per surface: unresolved or
refused (`provider_*`) → **retain the deterministic crop, stop, continue the
cascade**; edge refusal with `providerOutcome: not_sent` → the designed second,
smaller request; other `flat_atlas_*` / `operator_required` → throw and resume.
No image request is ever issued against an unresolved one. The retained
outcome is checkpointed and reported in `masterFinishing.surfaces[].providerOutcome`.
Locked by `tests/atlas-authoring-recovery.test.mjs` and
`tests/atlas-panel-authoring.test.mjs`. Production runs with
`DESIGNPRO_ATLAS_PANEL_FINISH=on` (deploy input `atlas_panel_finish`); the same
run showed Passenger and Hood each spending both candidates at ~35 s per call,
which is the next thing to measure before calling finishing a product default.

## Current owner correction — author the whole A.T.L.A.S. together (2026-09-06)

Trish rejected generation `a503b91b-65f3-4f30-ab31-5615f7db3cca`: its
center surfaces repeat one source band and its flanks do not satisfy her
cohesive-wrap requirement. She explicitly requested restoration of the
six-surface authoring path after the three-register compositor was traced.
This supersedes earlier one-field/field-compose selection instructions below.

Call 1 must author the complete six-surface topology in one image request.
Use the existing six-surface edge branch with its pinned teaching proof and
GENIE target guide; preserve the customer's brief, extraction orientation,
5-inch bleed, lineage and downstream workflow. Do not construct four surfaces
from one lower band. PR #301 remains excluded. Do not heal or redesign pixels.

This patch restores routing and removes PR #305's compositor; it is not proof
of visual quality. Prior six-surface candidates failed anatomy/full-bleed
checks. Those results remain evidence, and those gates remain unchanged.
Inspect the resulting master and all six panels before claiming creative
success; tests and a completed WrapBox delivery do not establish cohesion.


## Current owner instruction — six-surface restoration (2026-09-06)

The owner's complete source document is `docs/ATLAS-RESTORATION-WORKING-MODEL.md`,
copied unchanged from the verified trace supplied in this session (not 170909).
The current request supersedes RULE 0.33's one-field product selection and the
source document's historical stop-before-proofs instruction: restore the existing
six-surface branch and verify one fresh generation through seven proofs, Call 8,
QC, Topaz, production ZIP and WrapBox.
Do not use or merge PR #301; do not reconstruct, relocate, or heal artwork.
Do not merge `claude/dca-phase-1-execution-47019t`.

Measured production correction (2026-09-06): the last accepted six-surface run,
generation `84a3eadf-bc81-4096-8dd0-a63509e84fb7`, made two bounded Call-1
attempts. Raw candidate `c96603df-8b02-48cc-adca-41336f7316ab` was refused;
43 seconds later candidate `05f04553-cdf6-4a2e-bf02-d5d1a3e1055e` became
canonical master `1564c66d...` and reached seven proofs. Production therefore
permits exactly one unchanged fallback only after a blocking master refusal.
An accepted first candidate exits immediately, and a refused second candidate
fails closed. Do not add retry-specific corrective text or a third attempt.

Measured production correction (2026-09-06, canary `34021490632`): four raw
returns from the restored six-surface prompt were inspected. All four drew
vehicle anatomy into the print sheet (wheel arches, doors, hood/tailgate body
shapes, and in one return literal panel labels); the blocking output-class and
full-bleed gates correctly refused them. The static Call-1 output contract now
states the already-governing RULE 0.32 directly at the final target guide: six
plain rectangular printed-media regions only, stated as positive output geometry
without repeating the anatomy vocabulary that earlier tests proved can leak.
This is a prompt correction for a measured failure, not
a repair pass, alternate pipeline, relaxed gate, or retry-specific prompt.

Implementation corrections measured against the source document's proposed diff:
- `atlasNoseEdgeInput` runs before branch selection and accepts only left/right;
  the proposed helper returns top (its inverse mapping is reversed), and even the
  intended bottom is rejected. Omit this unused field on the six-surface branch;
  keep the existing manifest and extraction rotations unchanged.
- Runtime and edge prompt versions advance together when the rectangular-media
  rule changes; stale masters cannot be reused across that creative contract.
- PR #300 already preserved `MANIFEST_CONTRACT`; retain that correction.

This header is implementation context, not a live acceptance or deployment receipt.

## 🔁 RULE 0.36 — PASSENGER LETTERING IS READ ON THE PANEL AND VERIFIED ON THE COMPOSED FLANK (2026-09-15, live 8eec8162)

**What broke.** Owner run `8eec8162` (911 Turbo, "Porsche martini race team"):
the passenger flank is composed in code as the driver flank mirrored with each
lettering band re-dropped forward (`atlas-passenger-mirror.cjs`). The bands
came from the **whole-sheet** master-QC read — the 4096² sheet squeezed to one
1800px JPEG, a flank a third of that — and it located **one** band on a livery
carrying "PORSCHE", "21" and sponsor marks. Everything else flipped backwards.
The proof inspector was right (*"'PORSCHE' in the authority crop is
mirrored"*), the passenger proof was refused, and with six views the
production handoff never fired: the run sat at `outputs_ready` with no
entice workflow, which the UI shows as a stalled count.

**What runs now** (`runtime/atlas-lettering-read.cjs`, wired in
`composePassengerFromDriver`):

1. **The read is of the DRIVER PANEL, not the sheet.** `extractFlankPanel`
   crops the driver flank into its reading orientation and
   `readPanelLettering` (Flash, temp 0, schema-bound, inspectionId = panel
   sha256 prefix) names EVERY band — words, race numbers, sponsor marks — with
   its `orientation`. The whole-sheet read remains ONLY as the fallback when
   the panel read is unavailable, so the worst case is exactly the old path.
2. **The composed flank is READ BACK.** After the mirror, the passenger panel
   is cropped and read; every band reported `mirrored` is mapped to driver
   space (`x' = 1 − x − w`), merged into the bands, re-dropped forward from
   the ORIGINAL master, and the panel is read again. Bounded by
   `PASSENGER_VERIFY_READS = 3` (≤ 2 corrections).
3. **A still-reversed flank DECLINES** (`reversed_lettering_unresolved`) and
   the authored passenger is kept — an unknown flank over a known-reversed
   one, which is the outcome the owner ruled out. A verify that cannot run
   keeps the composition (today's behaviour). Nothing here throws into an
   accepted Call 1.

The receipt is on the revision: `metadata.passengerComposed.{letteringRead,
letteringSource, letteringVerify}` — `letteringVerify.mirroredFound` is the
per-read count, so "was PORSCHE ever seen reversed" is a query. Locked by
`tests/atlas-lettering-read.test.mjs` and
`tests/atlas-passenger-composition-executes.test.mjs` (pixel-asserted: the
corrected band on the passenger flank IS the driver slice, un-flipped).

### THE OPPOSITE FAILURE: A FALSE-POSITIVE BAND IS A DESTRUCTIVE PASTE (2026-09-16, live 9789762d)

One day after 8eec8162, the same machinery broke the other way. DID-9789762D
(the second Martini 911, v25 field topology): the driver flank carried **no
lettering at all** — pure stripe sweeps — and the reader boxed it anyway.
Receipts on revision `77787c8c`: `bandsApplied: 7` with `brandStringCount: 0`,
verify `mirroredFound [3,3,0]`, two corrections, status `"verified"`. Every
false positive was a raw un-flipped rectangle of stripes composited over the
mirrored flank, so the customer's passenger panel showed a hard-edged patch of
unmirrored artwork inside mirrored artwork. **A re-drop is only a correction
when the band is text; on anything else it is a seam.**

The defenses are the RestylePro locate strictness (RULE 1 — the exact
functions RULE 0.25 already names: `locateBrandingElements` /
`collapseContainedBrandingElements`, the honest-no-op pattern), ported into
`runtime/atlas-lettering-read.cjs`:

1. the prompt carries RestylePro's proven exclusion — *"Background artwork
   (patterns, gradients, scenery, flames, stripes, racing stripes, geometric
   shapes) is NOT lettering — never box it"*;
2. the parser drops any band whose `text` has fewer than
   `MIN_BAND_TEXT_CHARS` readable characters, and any band shaped like
   artwork rather than a word block (`MAX_BAND_*` caps, PR #433's half of
   this same fix, merged the same hour) — no reading direction, nothing to
   re-drop;
3. contained bands collapse into their enclosing band (one mark, one paste),
   and the survivors are bounded to a plausible total share of the panel
   (`MAX_TOTAL_BAND_AREA_FRACTION`);
4. `mergeBands` refuses an incoming band already ≥85% covered by a known one,
   so the verify loop cannot paste inside an already-corrected region.

Do not "simplify" any of these away, and do not disable the mirror to fix a
paste defect — the mirror itself is deterministic and correct; the reader's
evidence is what has to be strict. Locked by the 9789762d cases in
`tests/atlas-lettering-read.test.mjs`.

### A VERIFY THAT SAW NOTHING HAS VERIFIED NOTHING (2026-09-16, live cc382c3c)

**The receipt lied, and every gate believed it.** Precision Climate Solutions
on a 911 Turbo: the driver read missed "PRECISION" on the pre-#440 caps (0.55
wide x 0.28 tall, padded to 0.19 of the panel, over the old 0.18 area cap), the
mirror applied no bands, the passenger verify read returned nothing from that
same blind reader, and the run recorded `mirroredFound: [0]`, `bandsApplied: 0`,
**`status: "verified"`** while the flank shipped with the company name reversed.
Seven of seven views `accepted`. The brief named the company only in its prose,
so `brandStringCount` was 0, `lettersDeclared` was false, and the read-stage
decline never fired either.

**Zero MIRRORED bands is evidence only when the read resolved lettering at
all.** `letteringVerify.sawLettering` is now recorded from `verify.bands` (any
orientation) plus `verify.oversized`, and a read that resolved nothing can
never write `verified`:

| driver read | verify read | status | composition |
|---|---|---|---|
| located bands | sees them, none reversed | `verified` | kept |
| located bands | **resolves nothing** | `unproven` | **kept** |
| nothing | resolves nothing | `no_lettering_seen` | **kept** |
| any | names a band mirrored, still mirrored after the reads | `unresolved` | declined |

**Neither new status declines, deliberately.** RULE 0.36 declines only on a
POSITIVE finding of reversal; a reader that cannot see is not that finding, and
declining would destroy a composition that is probably correct — and would
destroy the genuinely text-free flank (9789762d's Martini stripes) that the
previous fix exists to protect. What changes is only that the receipt stops
claiming what it never established, so PanelPro's human QC sees an unproven
side instead of a certified one. Locked by the cc382c3c cases in
`tests/atlas-passenger-composition-executes.test.mjs`, verified to fail against
the pre-fix runtime. **Two fixtures in that file encoded the bug** — they
returned an EMPTY verify read and asserted `verified`; a working reader sees the
re-dropped words FORWARD, and they now say so.

**Do not report A.T.L.A.S. status from receipts.** This whole defect was
reported as a clean run by a session reading slot states and band counts. The
receipts said 7/7 accepted, 0 bands, master QC passed. The pixels said the
passenger was reversed. Open the export before calling a run good.

### WHERE THE WORKING SIX-SURFACE ATLAS WENT, AND THE ONE LEVER BACK (2026-09-16)

**Owner, looking at the September 8 screenshot of master `2165a36c7f52738b`:**
*"We had a working atlas, I thought I was reverted back to this state and we
were just fixing the fill step."* She is right about what that master was, and
it was never reverted to. The row says so:

| | |
|---|---|
| generation | `5d727ea9-eb71-466b-8a04-dca2d8d411e7` |
| authored | 2026-09-01, **`v23-orthographic-restored`** |
| topology | **six-surface** (`authoringTopology` null) |
| master QC | passed |
| `masterCutoutSurfaces` | **2** — the two dark wheel blobs visible on the flanks |
| `cutoutFillApplied` | **2** |

That is a good six-surface sheet with the CUT-OUT FILL as its open problem,
which is exactly the work the owner believed was in progress. It is also the
generation RULE 0.32 cites as proof the system can author excellent cohesive
A.T.L.A.S. artwork.

**What happened instead was forward drift, not a revert:** v23 → v24 one-field
→ v25 → v26, and on 2026-09-16 field-first became the routing for EVERY class
("ROUTE TRUCKS THROUGH THE FIELD ALSO"), so six-surface is no longer even the
first attempt. Every defect the owner has reported since — the painted
coordinate fractions, the silver field, the lettering pushed off the flanks,
the reversed passenger — is on field masters, not on that v23 shape.

**The lever exists in the runtime and could not be reached from a deploy.**
`fieldFirstReason()` honours `DESIGNPRO_ATLAS_FIELD_FIRST=off`, but
`configure-env.sh` never wrote that key, so it was unset on the droplet and
unset means field-first ON. It is now a deploy input, `atlas_field_first`
(`unchanged` | `on` | `off`), threaded exactly like `atlas_topology`: sticky
across later deploys, validated in `validate-env.py`, and a flip on the
already-running release reconfigures and restarts rather than no-opping.

**Adding the input changed nothing live** — absent input resolves to `on`, and
a typo fails safe to `on`. Flipping it to `off` is an OWNER decision and the
evidence genuinely cuts both ways: this file's own measurement is that
six-surface drew the vehicle into the sheet on 36 of 52 failures, which is why
field-first was adopted. That measurement and the owner's September 8 sheet are
both true. Do not flip it from a documentation pass; run it as a probe and
judge the exported sheet.

### STILL OPEN IN THE LETTERING PATH (handed over 2026-09-16, seen in pixels)

1. Flash's boxes are loose both ways. #438's flood key tightens a loose box; a
   box that MISSES part of the lockup (the logo mark on 7c7bd633 sat outside
   both reads) is only recovered by the side pad, which is not principled.
2. The flood key is fragile on same-hue art — at tolerance 28 it eats an orange
   mark touching an orange ribbon. The self-calibration picks the lowest
   tolerance clearing the border; that held on one real panel and two synthetic
   ones. Not a law.
3. The re-dropped lockup is an opaque slab and ribbons break at its edge. Shaped
   alpha was tried and rejected on real pixels. Removing the seam needs a
   logo-free base to mirror, the way RestylePro floors on the clean artboard.
4. On a strong design roll the lockup can be clipped by the third's boundary on
   the field sheet (cc382c3c). No band read can fix a clipped source.

### RULE 0.38 — EVERY CALL-1 ROUTING GETS A SECOND CONTRACT (2026-09-16, canary cf2a53d8)

**What the refusal ledger says, now that it can be read.** A read-only
`--refusals <requestId>` / `--refusal-digest <days>` selector was added to
`export-designpro-artifacts` because there was no way to get a refused sheet off
the private bucket: a Call 1 refused on every topology writes NO revision row, so
neither `--run` nor `--generation` reaches one byte of it. Thirteen refused
sheets had accumulated unseen while the gates that refused them were tuned.

Digest, 2026-09-13 → 09-16: **12 six-surface refusals, 3 field refusals, across 7
requests.** Six of those seven still reached an accepted master — and **every one
of the six got there by CHANGING CONTRACT after a refusal.** The contract change
is the recovery. Raw accept rate on refused-at-all runs: six-surface 2/14, field
4/7.

**The defect that cost the seventh.** The one-field fail-over promises "a refused
Call 1 never leaves the customer with nothing", and field-first routing inverted
it for every request it touched: `fieldResumable` is false on a field pass, so a
field-FIRST budget refused twice **threw, with nothing behind it**, while the same
request routed six-surface-first still had the field pass as its safety net. The
newer routing had no fail-over at all.

It does now, and it is deliberately one-way and bounded: at most two field
candidates, then at most two six-surface candidates, and the tail carries
`fieldFirstExhausted` so it cannot fail back into the contract this request has
already exhausted. Both resume paths are mirrored (`fieldFirstRouted` on the
stored revision and on the checkpoint), or a resumed request would measure its
own accepted six-surface artwork against the FIELD manifest and refuse it. Same
kill switch as the other direction — `DESIGNPRO_ATLAS_FIELD_FAILOVER=off` fails
closed both ways — because one misspelled flag must not cost a design. Locked by
three tests in `tests/atlas-authoring-recovery.test.mjs`, two of them verified to
fail against the pre-fix runtime, and the door count in
`tests/atlas-hero-driver-topology.test.mjs` (3 hero + 3 field-first = 6).

**What the four refused canary sheets actually showed, in pixels.** This is the
evidence for the six-surface-versus-field question, and it cuts both ways:

| # | topology | drawn | verdict |
|---|---|---|---|
| 1 | six-surface | **the best artwork of the four** — one cohesive orange/blue wrap across all six surfaces, logo and name set properly on both flanks — but each panel die-cut to the truck's silhouette on black | `edgeHoleRatio` driver 0.706 |
| 2 | six-surface | a literal 2022 F250 elevation with mirrors, glass and taillights | `vehicle_depiction` c=1 |
| 3 | field | a photograph of a car door, full bleed, door handle and panel gap | `vehicle_depiction` c=1 |
| 4 | field | two perfect full-bleed bands over one die-cut fender on grey | `vehicle_depiction` c=1 |

All four gates were right. **Six-surface fails on geometry while drawing the
better design; the field passes geometry while drawing the weaker one.** Do not
resolve that trade by relaxing `edgeHoleRatio` or adding wheel-well negatives —
RULE 0.32 forbids both by name. The resolution is hero-first (RULE 0.37), which
is a build.

### THE FIELD PASSENGER IS ITS OWN AUTHORED TERRITORY. DO NOT MIRROR IT. (2026-09-16)

**Owner: "Fix passenger we never had this issue before."** She is right, and the
history is exact. `composePassengerFromDriver` was added on **2026-09-07**
(`acbfffb1`). Before that date Passenger was authored artwork — which is what
the two standing rules that PREDATE it both require:

| rule | date | wording |
|---|---|---|
| RULE 0.33 | 09-02 | "Passenger is its own territory, never mirrored Driver." |
| RULE 0 | 08-17 | "Passenger is its own named Call-1 authority and must never be replaced by mirrored Driver pixels." |

On `field-thirds-v2` the passenger is **`third-2`** — its own band of the sheet,
composed by the model in the same pass as the driver — and the field tail
already demands that every area *"read on its own as intentional, finished,
commercially valuable artwork"* with lettering *"whole and legible"* reading left
to right. **A field passenger therefore has forward type BY CONSTRUCTION**, and
mirroring it throws away authored artwork to solve a problem that contract does
not have.

Every passenger defect since 09-07 is downstream of mirroring it anyway:
`8eec8162` reversed PORSCHE, `9789762d` pasted seven raw stripe patches over
mirrored artwork, `cc382c3c` certified a flank the reader could not see, and
`8c525565` shipped a doubled reversed lockup onto a 150-PPI print panel. **Four
defects, four fixes to the READER, and the reader was never the cause.**

`composePassengerFromDriver` now declines immediately on the field topology
(`field_passenger_is_its_own_territory`) — **before spending a single lettering
read**, so this is latency as well as correctness. The mirror is NOT deleted: it
is kept for six-surface and hero-driver, where both flanks come off one
composition and the model has measurably drifted or reversed them (canaries
`6c1bfae6`, `cad013e1`). Locked by `tests/atlas-passenger-composition-executes.test.mjs`,
whose field case was verified to fail against the pre-fix runtime while the
six-surface case still passes — the decline is scoped, not a blanket disabling.

**Everything RULE 0.36 built stays**, and stays load-bearing on the contracts
that still mirror. What changed is only which contract it is allowed to touch.

### 45% OF CALL 1 WAS ATTRIBUTED TO NOTHING (2026-09-16)

Canary `8c525565`, from its own receipt: `totalMs` **105,526**, `authoringMs`
**42,311**. The image call is **40%** of Call 1. The named buckets summed to
58,230, leaving **47,296 ms — 45% of the wall clock — measured by nothing**, and
two Gemini Flash stages lived inside that gap untimed: the output-class
inspector (one call, now two when a repair re-classifies) and the passenger
composition (up to THREE panel reads plus 4096-square crops).

`outputClassMs`, `passengerMirrorMs` and a computed `unattributedMs` are now on
`callOneTimings`, so "where does Call 1 spend its time" is a query rather than a
stopwatch held against a browser tab. A resumed run does not bill itself again
for a mirror it recovered.

Measured end to end on that run: request → durable master **112.09 s**,
request → Driver proof **154.48 s**. The SLO is 60 s / 90 s on a first-attempt
run, so a clean run is currently **~1.9x over** — and that was with ONE image
call, no refusals.

### A LOST LEASE IS WHAT THE DATABASE SAYS, NOT WHAT THE NETWORK DID (2026-09-16, canary 8c525565)

**The first run to reach the back half died at the last mile.** Call 1 accepted
on the first attempt, then six panels, seven proofs, Call 8, logos, de-logo,
pack activate, purchase, `manifest.resolve`, `source.verify`, preflight QC and
**`enhance.upscale` (Topaz) all completed** — and `output.build` failed five
times on `stage_lease_lost`, ending the run with the six 150-PPI panel masters
already built.

The timings are the diagnosis: attempts died at **3m22s, 3m52s, 8m54s and
11m14s**, no fixed boundary, always inside "resumable ZIP upload" / "ZIP
streaming". An expiry lands on a boundary; a transient RPC error does not.

`heartbeat_designpro_stage` and `acquire_designpro_heavy_lease` each return
`true` when the row is still ours and `false` when it provably is not. **A
transport error is a third case, and both heartbeats treated it as the second** —
one unanswered beat aborted the stage. The stage lease is 900 s and beats every
30, so each abort threw away up to 870 seconds of provably-held lease and every
byte of a finished output set, on a stage that streams multi-gigabyte TIFFs.

`leaseKeeper` (`runtime/designpro-standalone-claimant.cjs`) is now the one rule
for both: `false` aborts at once — that is the fence doing its job, and two
workers writing one output is what it exists to prevent — while an unanswered
beat is retried and becomes a loss only once enough time has passed that the row
itself could have expired (a quarter of the term is kept as margin, measured
from the last answer actually received, so work always stops BEFORE the database
would hand the stage to anyone else). A beat slower than the interval cannot
re-enter itself. `HEAVY_LEASE_SECONDS` is 600, not 120: the slot is fenced by the
900 s stage lease anyway, and three delayed renewals could expire the old term
under work still running.

**The two abort reasons are deliberately different sentences** — "lease is no
longer held by this worker" versus "lease could not be confirmed for Ns of its
Ns term" — because they are what the next failure carries into
`fail_designpro_stage`, they surface in the canary's stage transitions, and they
need different fixes. Locked by `tests/stage-lease-keeper.test.mjs`; three of its
six cases were verified to fail against the pre-fix behaviour.

**The canary could not have passed that run either.** It asserted
`[1, 2].includes(imageRequestCount)` — written when six-surface was Call 1's only
contract — so a run that recovers as designed across a fail-over (three or four
requests) would have been failed for it, discarding the master, the panels and
every stage after them. The bound is now checked where it lives: at most two
candidates on ONE contract (`masterAuthoringAttempts`) and at most one fail-over
(`authoringFailover`). The latency SLO had the same shape (`usedFallback =
imageRequestCount === 2` reverted a three-candidate run to the 60-second
first-attempt budget); it now scales by candidates spent, which reproduces the
existing 60/120 and 90/180 thresholds exactly at n=1 and n=2. No threshold moved.

### THE STICKY A.T.L.A.S. FLAGS DID NOT STICK: `unchanged` WAS SENT AS A WORD (2026-09-16, located)

`atlas_field_first` was deployed `off` on `031d8989` — the refusal ledger proves
it, six-surface ran first — and the very next deploy, dispatched `unchanged`,
produced a master whose single `atlasEdgeProvenance` entry carries
`fieldContract: designpro.atlas-field-prompt.v2` and no teaching proof. Field ran
FIRST. The plumbing, the SSH passthrough and the sticky sed in
`configure-env.sh` all read correct on inspection, and all three were.

**The cause is one GitHub Actions expression, and it is printed on the deploy's
own log.** Run `35061242506` (2026-09-16 05:52Z, de581246) says, in plain text:

```
ATLAS_FIELD_FIRST: unchanged
```

The workflow passed the flags as
`inputs.atlas_field_first == 'unchanged' && '' || inputs.atlas_field_first`,
which reads as *"unchanged means send nothing"* and does the opposite. **An empty
string is FALSY in a GitHub Actions expression**, and both operators return an
OPERAND rather than a boolean: `&&` yields its left when that is falsy, so the
true branch evaluates to `''`; `||` then sees a falsy left and falls through to
`inputs.atlas_field_first` — exporting the literal word `unchanged`.
`configure-env.sh` reads any non-empty value as a real instruction from this
deploy, **skips its sticky read of the live `runtime.env`**, and resolves the
flag to its DEFAULT. All four flags at once: field-first→`on`,
topology→`six-surface`, call1-graph→`on`, panel-finish→`off`.

It is invisible by construction, because a reset flag looks exactly like a flag
nobody set.

The form is now `!= 'unchanged' && <value> || ''` — the true branch carries the
value, the false branch carries the empty string, and falsiness works for it
instead of against it. **Never write `cond && '' || value` in a workflow.**

Locked by `ops/tests/deploy-workflow.test.mjs`, which evaluates the workflow's
OWN expression text through a small model of Actions truthiness and asserts
`unchanged → ''` for each flag, plus that the shipped shape still evaluates to
the literal word (verified to fail against the pre-fix workflow).

Two things from the same hour stay, because a located cause does not make a
silent flag acceptable: `configure-env.sh` prints **the resolved value of all
four A.T.L.A.S. routing flags** on the deploy log (routing selectors, never a
secret — the block sits after every secret is consumed), and the same test file
EXECUTES each sticky sed against a fixture written in the writer's own format.
**Read the flag line in the deploy log before judging a run's topology.**

### RULE 0.39 — HERO-FIRST IS TWO NODES, AND THE HANDOFF IS A REFERENCE (2026-09-16)

**Owner, verbatim:** *"Node 1 (the 3D vehicle generation) and Node 3 (the 2D
flattener) must be distinctly engineered nodes in a DAG. Node 1 executes, passes
its state and visual output to the orchestration layer, and then Node 3 consumes
that 3D output to generate the flat panel."* — *"the state handoff between Node 1
and Node 3 must pass immutable references, never raw image blobs or unpersisted
memory buffers."*

**Why hero-first exists at all** (RULE 0.37's remaining build): a driver flank is
~3.6:1, Gemini 3 Pro Image's widest `aspectRatio` is 21:9, and
`MAX_ASPECT_DRIFT_RATIO=1.12` therefore refuses EVERY single-call driver tile
before one pixel of artwork is judged — 0/3 on real vehicles. A 16:9 photograph
of the car is an ask this model answers; the flat strip is one it cannot emit. So
the driver becomes a vehicle render followed by a flatten of that render, which
is also the order RestylePro has always used (`mode: 'restyle'`,
`viewType: 'side'`, flat proof derived from the approved view).

**The DAG, in `runtime/atlas-call1-graph.cjs`:**

```
surface.driver.view ──▶ surface.driver ──▶ surface.passenger ──▶ hood/front/rear ──▶ roof ──▶ master.assemble
```

`surface.driver.view` is NODE 1 and `surface.driver` is NODE 3. They were one
claimed node making two calls, which is what the owner's correction names: a
refused flatten re-spent the 3D render on every attempt and a lost lease threw
both halves away. Measured in the lock: against a flatten that refuses twice,
node 1 runs **exactly once** and its row stays `completed` while `surface.driver`
fails alone.

**The edge carries an identity, never bytes.** Node 1 finishes with
`{storagePath, contentHash, byteSize}` and nothing else; node 3 reads it off its
dependency's output and sends `heroViewStoragePath` + `heroViewContentHash` to
the edge, which re-reads and hash-verifies the render itself. A node output
containing base64 fails the test. A missing or malformed reference is an
incomplete DEPENDENCY, never a silent fall-back to the one-call driver.

**The graph's SHAPE is the kill switch.** `compileHeroDriverGraph({heroFirst})`
is resolved once when the run is created and then stored as node rows, so a flag
flipped mid-run cannot change what an already-claimed node does. With hero-first
off the compiled graph is byte-for-byte the previous seven-node one. No migration:
`node_key`'s CHECK already admits the dotted key.

**Scope:** read only inside the hero-driver cascade, so it is inert while
production routes six-surface/field. Nothing about the gates, the assembly, the
passenger mirror's scoping, Call 8 or anything after Call 1 changes.

Locked by `tests/atlas-call1-graph.test.mjs` (the split shape, the stored kill
switch, the retry isolation) and `tests/atlas-hero-driver-topology.test.mjs`.

#### THE 2D PROOF BUTTON REPORTED A LIVE DESIGN AS `job_not_found` (live 2026-09-16)

Owner: *"I get the 'Building Production Proof on Server' modal, but it
immediately throws an error toast: 'The server did not accept this revision: job
not found'."* The design was fine. **The durable job had never been registered.**

`POST /api/jobs/:id/resume` 404'd whenever no `designpro_workflow_runs` row
existed — which is **precisely the state that button exists for**, because the
entice workflow is created by `handoff_designpro_generation_to_production` on
master acceptance and nothing else could ever create it. The GET path had already
learned to answer from the generation request (`preHandoffState`); the POST path
had not, and its 404 read as a rejection of the design.

It now REGISTERS the job through that same idempotent handoff RPC — the one
`/api/generation/requests/:id/handoff` already calls, so this is the same act by
the same door and not a second creator — returns the `runId` the frontend will
poll, and then resumes it. A generation that genuinely is not ready answers
`flat_first_production_gate_required` (the gate's own reason), and
RevisionStudio prints that as the state it is. A generation that truly does not
exist is still 404. Locked in `gateway/tests/gateway.test.mjs`.

#### A FLAG THE RUNTIME READS AND THE WRITER DOES NOT WRITE IS NOT A SWITCH (2026-09-16)

`heroFirstEnabled()` honours `DESIGNPRO_ATLAS_HERO_FIRST`, and
`configure-env.sh` wrote that key **nowhere** — so unset, and therefore ON, was
the only value it could ever have. That is exactly how
`DESIGNPRO_ATLAS_FIELD_FIRST` spent weeks being honoured by the runtime and
unreachable from a deploy, recorded two sections above; the comment beside the
new flag already claimed the opposite. **The same mistake was made again within
hours of documenting it.**

`atlas_hero_first` (`unchanged` | `on` | `off`) is now threaded exactly like
`atlas_topology`: sticky in `configure-env.sh`, an exact `{on,off}` vocabulary in
`validate-env.py`, printed in the resolved-flag banner, and opening the
reconfigure branch so a flip on the already-running release restarts rather than
printing `ALREADY_COMPLETE`.

**The lock is on the CLASS, not this instance.**
`ops/tests/deploy-workflow.test.mjs` walks `DESIGNPRO_ATLAS_TOPOLOGY`,
`DESIGNPRO_ATLAS_HERO_FIRST`, `DESIGNPRO_ATLAS_CALL1_GRAPH` and
`DESIGNPRO_ATLAS_FIELD_FIRST` from the runtime file that READS each one through
to the writer's `printf`, the writer's sticky `sed`, and the validator's
vocabulary. Add a routing flag to the runtime without those four and the build
fails. **Do not add an env-gated routing flag without adding it to that list.**

#### NODE 1 MUST STAGE ITS RENDER WHERE THE EDGE WILL ATTACH IT (2026-09-17, live 2099d17d)

**The first real hero-driver run.** The DAG did exactly what RULE 0.39 built —
`surface.driver.view` **completed** on `designpro-worker-2`, `surface.driver`
claimed it — and the edge then refused its own handoff:

```
design-panel-ai-generate atlas-author failed (HTTP 500):
atlas_author_input_path_invalid:atlas-author/driver-view.png
```

`attach()` admits an input ONLY from `^atlas-call1-inputs/<sha256>\.(png|jpg)$`,
and that guard is correct and stays: it is what stops a flatten naming an
arbitrary object to read. Node 1 was returning the edge's own PANEL path.

Node 1's render IS a Call-1 input for node 3, so `stageHeroView` now writes it to
`atlas-call1-inputs/<sha256>.jpg` and `CALL1_INPUT_PATH` mirrors the edge's regex
in the runtime, so a path the edge would refuse cannot leave the view node.
Unlike `stageReference` it does NOT downscale — a neighbour is a 1280px
continuity hint; the hero view is the flatten's SUBJECT. All four of the edge's
checks were verified rather than assumed: prefix, bucket (`wrap-files`), filename
hash == bytes hash, and `expectedHash` == the STAGED bytes' hash (the stage
re-encodes, so sending the returned render's hash would have failed here).

The fail-over behaved correctly — six-surface spent both candidates
(`edgeHoleRatio` hood 0.476, then `vehicle_depiction`) and exhausted.

**TWO FIXTURES ENCODED THE BUG**, which is why a green suite sat over a broken
seam, and this is the third time this file has had to record that shape:
the graph test's synthetic edge accepted ANY `heroViewStoragePath`, and
`atlas-hero-driver-topology` pinned the literal `atlas-author/driver-view.png`
as what stage 2 must be shown — asserting the one path the edge refuses. **A fake
door laxer than the real one cannot catch a door-shaped defect.** Both now
enforce the real allowlist and were verified to fail against the pre-fix runtime,
reproducing the live error verbatim.

#### THE HERO-FIRST FLATTEN NOW CONTINUES THE VIEW'S CONVERSATION (2026-09-17)

Owner: *"Are you using thought signatures?? Multimodal best practice from Gemini
pro 3."* Answered from the code, and the honest answer was **yes on the cascade,
no on the hop that needs it most.**

`captureImageTurn` / `replayImageTurn` carry `thoughtSignature` on the part it
arrived on, and hood/front/rear/roof each replay the driver exchange with it.
The hero-first FLATTEN did not, because it is also `first: true` (it IS the
driver) and the edge refused history for every first request:

```ts
if (first && priorTurnsIn.length) throw new Error("atlas_author_hero_takes_no_history");
```

So node 3 attached node 1's render as a flat image in a NEW conversation and
discarded the reasoning that produced it — on the single hop where the
multi-turn spatial reasoning RULE 0.35 quotes the owner asking for is the whole
point.

**Scoped, not removed.** The guard is now `first && !heroFlatten`, so a true
from-scratch vehicle view still takes no history — a conversation there would be
a second creative authority (RULE 0.26). Only the flatten may replay, and only
its own view. Three seams move together: the edge guard; `authorSurface`
prepending `heroView.exchange` to the chain (attempt 2 still drops it, so the
existing fallback for a provider that rejects a replayed signature is now also
the flatten's); and the view node persisting its exchange so whichever worker
claims the flatten can replay it. It travels as TURNS — image REFERENCES (path +
hash) plus the signature — never pixels, so RULE 0.39's no-blobs rule across the
node boundary is unchanged. Prompt versions advance together to
`v3-flatten-continues-the-view`.

**LOCKED AS ARRIVING, NOT AS SENT.** Both paths assert the edge RECEIVES two
prior turns with the VIEW's signature on the model part it arrived on, and that
the view itself replays nothing. The topology test's assertion was tightened
from the bare guard string — which passed against the blanket refusal that
discarded every signature — to the scoped expression.

**SUPERSEDED BY v28 (2026-09-18).** This paragraph read *"there is no node that
designs the logo, the company name or the contact bar as its own artifact and
then composes it … do not describe A.T.L.A.S. as having element-level design
decomposition; it does not."* That is now false, and the correction matters
because it is the first thing a session reads when asked whether the elements
are decomposed. The element subgraph — `typeset.produce`, `contact.produce`,
`logo.prepare` → `element.lockup` → `master.composite` — exists, compiles for
six-surface and field through `compileElementGraph`, and is live with
`DESIGNPRO_ATLAS_ELEMENT_GRAPH=on`.

**What is and is not a DAG on the LIVE path, stated exactly, because the two
halves differ:**

| | |
|---|---|
| the six surfaces | **one image call.** `TOPOLOGY=six-surface` authors all six in a single request, so they are not nodes and there is no conversation between them |
| thought signatures | `captureImageTurn` / `replayImageTurn` carry them and hood/front/rear/roof replay the driver exchange — **but only in the hero-driver cascade, which is OFF** (`HERO_FIRST=off`). A single-call topology has one turn, so there is nothing to continue |
| the elements | **a real DAG.** Three producers with no dependencies run in parallel, fan into `element.lockup`, then `master.composite`. Deterministic: zero model calls, asserted |
| the edge | `design-panel-ai-generate` mode `atlas-artboard`, the one Call-1 network endpoint (RULE 0.26), unchanged |

So multi-turn signature passing is not absent by oversight — it is inapplicable
to the topology the owner routed production to. Reaching it means hero-driver,
which measured 0/3 on real vehicles and is off for that reason.

### THREE OPERATIONAL FACTS THAT COST HOURS EACH (2026-09-16)

- **The field topology paints its own layout map into the artwork, and the
  `map_drawn` gate now refuses it (2026-09-16).** Four runs in a row —
  `455b1723`, `7c7bd633`, `cc382c3c` and `8c525565` — printed the panel
  fractions onto the flanks, and 8c525565's went through Topaz onto 150-PPI
  print panels: `0.9114 0.3` and `884 0.0000` printed on the customer's driver
  side.

  **The cause is in the request, not the model.** `atlasFieldContract`
  (`design-panel-ai-generate/index.ts`) emits the six rectangles as bare
  four-decimal rows and then says *"None of the map is drawn: the vinyl carries
  no numbers, outlines or frames of any kind."* A negative instruction standing
  next to the very thing it forbids is the prompt shape this file warns about
  in three other places, and it has now failed 4/4. **The rows are load-bearing**
  — they exist because the lower band alone discarded 27.81% of what was painted
  and the cut stopped matching the composition — so they are not simply deleted,
  and RULE 0.37 forbids arguing with that tail without a side-by-side.

  So the gate is the remedy that ships: `map_drawn` is a third blocking verdict
  in `runtime/atlas-output-class.cjs`, refusing under its own code
  `flat_atlas_master_map_drawn` so the ledger and its digest can tell "drew a
  truck" from "drew the map". It re-rolls within the bounded budget and then
  changes contract under RULE 0.38, so the customer still gets a design.

  **It is deliberately narrow, because a commercial wrap is EXPECTED to carry a
  phone number.** The verdict convicts a decimal fraction of the sheet dropped
  onto the picture — a leading zero and a point, small, plain, at a rectangle's
  edge, belonging to no part of the artwork — plus registration crosses, corner
  ticks and drawn frames. A telephone number, address, web address, year, price
  or race number set in the artwork's own typeface is `flat_atlas`. The
  discriminator is the FORM of the numerals, never their presence. Locked by
  `tests/atlas-output-class-gate.test.mjs`, which pins that guard by name.

  **The gate catches it; it does not prevent it.** The prevention is hero-first
  (RULE 0.37): a per-surface authoring pass needs no coordinate table at all,
  so there is no map to draw. Until that is built, expect field runs to spend
  refusals here.
- **The auto dark deploy only runs when the merge commit message contains the
  literal `[dark-deploy]`.** Every other merge must be dispatched with
  `exact_sha`. A green gate is not a deploy.
- **The canary's GENIE assertion requires an operator-validated catalog row, and
  the 2022 Porsche 911 Turbo row (`0c211a9d`) has never been validated** — so
  EVERY 911 canary reports failure at that step regardless of the generation,
  and its production pack parks at approval required. The F250 row IS validated.
  Probe on the F250 unless the 911 row is what is being tested.

**Still open, deliberately:** the proof-side continuity gate promises "one
proof-only re-render" on a drift verdict, but the A.T.L.A.S. proof provider
runs `maxProviderAttempts: 1`, so the slot dies on the first verdict. It would
not have saved this run (a reversed authority is reversed on every render) and
it is not changed here — raising it is one extra photographer call per drift
verdict and is the owner's call.

## 🎨 RULE 0.37 — THE SEPTEMBER 4 FIELD TEXT IS THE PRODUCT; JUDGE CHANGES SIDE BY SIDE (corrected 2026-09-16)

**What happened.** On 2026-09-15 the owner said *"we never had to have a
livery paragraph, we relied on the persona"*, and the field tail was stripped
to physical facts only (v25). The next live run, the owner's own Martini 911
(`220d569f`), painted the map's coordinate digits onto both flanks, drew black
blocks, went silver instead of white, and pushed every mark off the flanks.
The lettering reader then took the painted digits for lettering and patched
the passenger flank. Worse on every axis than the run before it.

**The evidence that decides it.** The Arctic Air Prius sheet of 2026-09-04
(DID-63E6629A: six areas filled edge to edge, company name on both flanks) and
the Precision master of 2026-09-08 (1564c66d) were both produced by the field
tail exactly as it read on September 4. That wording is restored verbatim as
v26 (`atlas-artboard-designiq.20260915.v26-map-is-read-not-drawn`); the only
addition is the second half of the map line, which says the map is never
drawn. Locked by `tests/atlas-clean-authoring-contract.test.mjs`.

**The rule.** The field tail is not argued about. A change to it is accepted
only with a side-by-side against those two sheets on the same briefs. "The
persona doesn't need it" was argued, shipped, and refuted by the next run.

**What this does not fix.** The Martini brief on the field (`8eec8162`, v24,
this same wording plus a livery paragraph) was still judged plain by the
owner against her August 5 RestylePro Martini. RestylePro asks the same
persona for a photo of the car (`mode: 'restyle'`, `viewType: 'side'`) and
derives the flat proof from the approved views; the OS asks it for the flat
sheet first (`mode: "atlas-artboard"`). That order is the remaining quality
gap, and it is a build (hero first, sheet derived), not a prompt edit.

## 🟢 RULE 0.33 — ONE-FIELD CALL 1 IS THE PRODUCT (owner ruling, Trish 2026-09-02 — "UNFREEZE GET ME A WORKING OS")

**Supersedes the authoring half of v19, v23, RULE 0.30's conditioning clause,
RULE 0.28 §2 and every earlier "teaching proof / neutral guide / topology
text" input rule below wherever they conflict.** The gates are untouched.

Gemini authors **ONE uninterrupted full-bleed vehicle-wrap composition** and is
shown **no production topology**: no six-region guide, no labeled Flamingo
teaching sheet, no normalized `[0,1]` text, no six named production objects,
no panel/artboard/template framing, no wheel/window/body-piece negatives. The
model request is **one text part plus verified customer references**.
GENIE/runtime owns Driver, Passenger, Hood, Roof, Front and Rear as **code-only
territories** (`runtime/atlas-field-territories.cjs`, `field-thirds-v2`) and
cuts them AFTER the one image call. Passenger is its own territory, never
mirrored Driver.

Why: the live v23 generation `84a3eadf…` (2026-09-02, the GENIE-prep
validation run) passed every gate and still painted wheel arches and body lines
into both flanks, an inverted rear and a mirrored passenger. Field Recovery v2
draw `33659500846` is the only measured configuration with clean, continuous,
anatomy-free flanks, so it is the product now. The edge assembly emits that
harness prompt **byte for byte** for its fixture (`37e4137e8ae8c8bb…`) while
the legacy six-container branch still emits the deployed v23 pin — locked by
`tests/atlas-one-field-call1.test.mjs`. Full contract:
`docs/ATLAS-ONE-FIELD-CALL1.md`. Versions
`designpro-flat-first-atlas-20260902.v24-one-field` /
`atlas-artboard-designiq.20260902.v24-one-field`.

**The thirds language in the tail is scaffolding the owner has not approved as
permanent architecture.** Draw 1 drew the thirds as framed passages with thin
white margins inside the bleed insets. That is the next creative variable to
measure on a real product generation, not a reason to re-add containers,
guides, teaching sheets or negatives.

## 📐 RULE 0.32 — A.T.L.A.S. IS PRINTED MEDIA, NOT A VEHICLE (owner ruling, Trish 2026-09-02)

**A.T.L.A.S. = the continuous printed wrap sheets, unwrapped flat, BEFORE
installation and trimming.**

This is the governing definition. Where any other section of this file describes
A.T.L.A.S. in terms of vehicle panels, body layout or "the flattened panel
layout of the vehicle", THIS WINS.

Owner, from the Avery Dennison installation reference (*Wrapping the Side of a
Vehicle with one Panel*): a Driver/Passenger print panel is **ONE CONTINUOUS
RECTANGULAR SHEET OF PRINTED VINYL BEFORE INSTALLATION**. The artwork prints
continuously through the physical location of the wheel opening. The installer
lays that continuous sheet onto the vehicle and trims the opening **during
installation**.

Therefore, for every A.T.L.A.S. surface:

> **the entire rectangular region is printable artwork.**

**Vehicle anatomy has no authority over the shape of the print artwork.** A wheel
opening, window, fender, door seam, glass area, light, handle or any other
physical vehicle feature must NEVER become missing artwork inside the rectangular
A.T.L.A.S. panel. The vehicle is where the media goes; it is not what the media
looks like.

### The acceptance contract

Not "no black pixels" — that is a proxy, and a colour-conditional one:

> **SIX CONTINUOUS RECTANGULAR ARTWORK REGIONS, EDGE TO EDGE, WITH NO
> MISSING-ARTWORK FIELDS OR VEHICLE-ANATOMY CONTOURS.**

A missing-artwork field is a missing-artwork field whatever colour it is. Measured
2026-09-02 on GenerationID `5d727ea9`: `cutoutFillApplied` reported 303,861 px
closed on the driver flank with `unresolvedPixels: 0`, and by the gate's own
near-black predicate only **22 px** survived — while **7.55% of that flank was
still one uniform non-artwork field**, visually a solid black wheel well.
`FLAT_BLACK_CHANNEL_MAX` is 24 and the filled disc measures ~`rgb(25,19,23)`. The
fill moved the defect one value on one channel out of the only predicate watching
it, and every downstream check keys on that same predicate. **Turning a
missing-artwork field into nearly-black pixels is not repair, and must not make an
invalid master canonical.**

### The objective is FIRST-ATTEMPT correct authoring

Owner, verbatim: *"I do not want the architecture to become: Gemini draws wheel
hole → reject → ask Gemini again → hope. I want: Gemini understands A.T.L.A.S. as
continuous rectangular printed media → produces continuous artwork first
attempt."*

A re-roll is a **failsafe, not the root-cause fix**. A large missing-artwork
region may ultimately fail closed as a safety measure, and small genuine edge
defects may retain the proven deterministic repair — **those are safeguards.**

**Until the conditioning root cause is identified by controlled experiment, do
NOT:** add wheel-well negative prompting · add another repair heuristic · relax a
threshold · change the DesignPanelAI creative intelligence · deploy re-roll as the
fix.

### What is established, and what is not

| established by measurement | still open |
|---|---|
| DesignPanelAI can produce excellent cohesive A.T.L.A.S. artwork (`5d727ea9`) | which Call-1 input teaches vehicle-body-piece interpretation |
| deterministic panel extraction is correct | first-attempt output-class stability |
| the wheel/glass voids originate in Gemini Call 1, painted opaque (`opaqueRatio` 1.00000) | |
| large-hole repair cannot recreate artwork Gemini never generated | |
| Call-1 output class is unstable — the SAME request returned `flat_atlas` 3/3 and `vehicle_depiction` 3/3 an hour apart | |

Investigation record: `docs/ATLAS-TEACHING-PROOF-FIELD-AB.md`,
`docs/ATLAS-CALL1-GUIDE-ABLATION.md`, `docs/ATLAS-CALL1-TOPOLOGY-TEXT.md`,
`docs/ATLAS-CALL1-TEACHING-PROOF-ORDER.md`, `docs/ATLAS-WHEEL-WELL-ROOT-CAUSE.md`,
raw evidence under `docs/ab/`.

## 🧞 GENIE PREP LIFECYCLE + MANIFEST HASH v2 (owner ruling, Trish 2026-09-02)

**GENIE knows dimensions before DesignPanelAI generates.** Vehicle complete / Enter → the browser posts its
GenerationID + vehicle → the server acknowledges, records `designpro_genie_preps` keyed by (generationId,
vehicleIdentityHash, genieContractVersion) and runs `resolveFlatAtlasPreviewDimensions` while the customer
writes. Generate consumes a READY prep for the exact owner + GenerationID + vehicle identity + contract;
anything else runs the inline resolver exactly as before. **Prepared geometry is private OS state and never
enters the model-facing request** (locked). `docs/GENIE-PREP-LIFECYCLE.md`; the trace that located the
defect: `docs/GENIE-LIFECYCLE-TRACE-2026-09-02.md`.

**Manifest hash v2.** v1 hashed `null` for every surface, so `genieManifestHash` never varied with the
inches (every 2026-09-02 draw reported `879291d3…`). v2 (`designpro.genie-manifest.v2`, explicit
`hashContract: designpro.genie-manifest-hash.v2`) hashes the six surfaces. Historical rows are NOT
rewritten: `docs/GENIE-MANIFEST-HASH-CUTOVER.md`, locked by `tests/genie-manifest-hash.test.mjs`.

**DEPLOYED-VERIFIED 2026-09-02 on `24a8b446` through the real intake at os.designproai.com**
(`docs/GENIE-PREP-LIVE-VALIDATION-2026-09-02.md`): Enter → prep READY in 78 ms resolver time, zero
provider calls; vehicle change mints a new GenerationID (stale prep unreadable by construction) and the
same-GenerationID RPC path marks the old row `superseded` and the worker reclaims the queued one;
Generate on GenerationID `84a3eadf…` consumed prep `a377be67…` (`prepHit: true`, `genieMs: 67`, inline
resolver skipped, manifest hash `766258a0…` identical on prep and revision) and the unchanged v23 Call-1
request produced master `1564c66d…`, six panels, seven views, Calls 8–11 and `pack.activate` in 3 m 49 s.
Creative defects seen on that master (wheel-arch/body-line drawing, inverted rear, mirrored passenger)
are the frozen conditioning question, not the lifecycle.

## 🧬 CALL-1 v19 — CREATIVE PARITY RECOVERY (owner ruling, Trish 2026-09-01)

**This supersedes the v17 boundary contract and RULE 0.30's authoring half
below, on every point where they conflict.** It is the result of an executed
parity diff, not a theory: both prompt builders were run against one identical
fixture (DID-2D918868's own stored `request_input`) at eleven commits.

### What the measurement found

The creative regression was never `7ee1f868`. Creative conditioning held at
**exactly 2,490 characters** from the last near-working master
(**DID-2D918868**, GEN `2d918868-44e9-4121-9a72-3fbbfc85ff33`, 2026-08-27
10:18:04Z, source `36e5acc4` — the only commit carrying both version strings
that revision recorded) through 08-28. Then:

| commit | date UTC | creative chars | what it did |
|---|---|---|---|
| `36e5acc4` | 08-27 04:14 | **2,490** | the known-good state |
| **`c5479313`** | **08-30 22:12** | **2,025** | **deleted 465 chars of proven creative direction** |
| `334c79f0` | 09-01 03:08 | 2,394 | still 96 short; format/refusal text up 54% |

`c5479313` ("Isolate A.T.L.A.S. Call 1 to neutral topology masks") is the
six-field-livery anonymization. RULE 0.0 later reversed its vocabulary but
never restored its deleted text. It removed: the customer-selected **finish
spec**; *"with real dimension rather than flat shapes on bare panel"*;
*"never an on-vehicle photograph"*; and three persona anchors — *"installed on
real trucks and vans"*, *"readable at a glance from across a parking lot"*,
*"worth what the customer paid"*.

**Rewriting creative framing to fix a pixel defect is what RULE 0.1 forbids,
and it is what happened here.** Four subsequent releases each added more
format and refusal language on top of the loss.

### The Call-1 request, as of v19

1. the DPAG creative assembly, with `36e5acc4`'s language restored;
2. the **MANDATORY OWNER-APPROVED LABELED FLAMINGO A.T.L.A.S. TEACHING PROOF**
   — exact owner bytes, SHA-256
   `684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded`
   (3,430,273 bytes, 1254×1254 PNG, contract
   `designpro.atlas-labeled-teaching-proof.v3`). Verified byte-identical to
   the owner's copy. Never recreate, repair, crop, relabel or re-encode it;
3. verified customer references, if any.

Two text parts, one teaching image, customer references. That is the whole
request.

**NOT sent, and not to be restored without owner approval and evidence:**

- the **normalized `[0,1]` topology table**. GENIE and the runtime keep full
  mathematical authority — `manifest.zones`, `normalizedZoneTopology` and the
  request-body `normalized` field are unchanged and still validated — but the
  OS owning the math does not require Gemini to consume it. Layout reaches the
  model as the prompt's named panel list, which is how the proven RestylePro
  `mode:'artboard'` call has always worked;
- the **blank neutral guide / container image**. A blank canvas handed to an
  image model reads as content to interpret;
- the **Houdini flat/3D teaching pair**;
- the authoring-side **`OUTPUT CLASS — ABSOLUTE`** refusal block. See below;
- an explicit **`temperature`**. DID-2D918868 sent no temperature field, so
  Gemini applied its own default; `7ee1f868` pinned 1.0 on the same commit
  that changed six other things and it has never been isolated. Parity
  recovery does not introduce even a plausible config difference.

### The gate stays; its words do not

RULE 0.30's post-generation output-class gate is **unchanged and still
blocking** — `classifyAtlasCandidate`, `runtime/atlas-output-class.cjs`,
`masterOutputClass`. It runs after generation and cannot affect design pixels;
it only decides whether bad output may become canonical. The same words
injected into the *authoring* prompt are a long negative that displaces
creative direction and makes the model over-index on the forbidden thing, so
they are removed from Call 1's conditioning. **A post-generation gate cannot
reduce creative quality. Authoring conditioning can.**

### The finish comes from the customer, never from a release

Gloss / Matte / Satin / Chrome / Brushed arrives on the request
(`input.finish` → `atlasEdgeRequestBody` → `body.finish`) and selects its text
from the shared `FINISH_SPECS` table exactly as it always has. **That table is
not edited and no finish is pinned.** `atlasFinishSpec()` applies two flat-
master-only adjustments: it stops the caller prefixing a label the table
already opens with (`Finish: GLOSS — GLOSS — …`), and it rewrites the two
entries that describe sheen landing on physical *body panels* — vehicle
anatomy Call 1 must never be taught. Calls 2–8 keep the pinned wording
verbatim, because a body panel is exactly what the photographer photographs.

### Call 1 designs; Calls 2–8 present. Verified from code.

- **A.T.L.A.S. proofs** are rendered by **`persona-photographer-render`**
  (`ATLAS_PROOF_STAGE`, `runtime/designpanel-server-provider.cjs:1052`) in
  `mode: "atlas-proof"`. **Standard** proofs use `generate-color-render`
  (`designpanel-edge-provider.cjs`). Both names in the history are real; they
  are two different pipelines and neither replaces the other.
- The proof request carries `sourcePanelStoragePath` + `sourcePanelHash` +
  `sourceMasterHash`, resolved per shot by `panelFor()` → `surfaceForProofView`.
  The edge **refuses rather than renders** on mismatch:
  `atlas_proof_surface_mismatch` and `atlas_proof_panel_hash_mismatch`. The
  selected finish rides through, so it stays consistent across Call 1 and the
  proofs.

Prompt versions: runtime `designpro-flat-first-atlas-20260901.v19-creative-parity-recovery`,
edge `atlas-artboard-designiq.20260901.v19-creative-parity-recovery`.

**Do not re-add creative conditioning to fix a pixel defect.** If a master
comes back wrong, the gate refuses it; diagnose the input contract, not the
creative language. Locked by `tests/designpro-persona-contract.test.mjs`,
`tests/atlas-artboard-edge-call1.test.mjs`,
`tests/atlas-clean-authoring-contract.test.mjs`,
`tests/atlas-cohesion-teaching-pair.test.mjs`,
`tests/atlas-output-class-gate.test.mjs`.

## 🧭 SUPERSEDED — CALL-1 v17 BOUNDARY CONTRACT (kept for history)

The owner's Call-1 boundary contract supersedes the v15/v16 teaching-input
wording below wherever they conflict. The Call-1 model request is exactly:

1. the DPAG creative assembly (unchanged);
2. the **GENIE-derived normalized `[0,1]` mathematical topology** — a text part
   (`surface | x | y | width | height | orientation`, four decimals, computed
   from `manifest.zones`; contract `designpro.atlas-normalized-topology.v1`).
   It is the SOLE target-vehicle geometry/proportion authority;
3. the **MANDATORY OWNER-APPROVED LABELED FLAMINGO A.T.L.A.S. TEACHING PROOF**
   — exact owner bytes, SHA-256
   `684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded`
   (3,430,273 bytes, 1254×1254 PNG,
   `runtime/atlas-examples/flamingo-labeled-atlas-teaching-proof.png`,
   contract `designpro.atlas-labeled-teaching-proof.v3`). Its labels establish
   panel identity ONLY; its arrangement is NOT target geometry; never
   recreate, repair, crop, relabel or re-encode it;
4. verified customer references, if any.

**NO blank neutral target-guide image** (suspected conditioning regression —
do not restore it), **NO correctiveNote** on any attempt, `temperature: 1.0`
pinned, `gemini-3-pro-image`, `1:1`, native `4K`, exactly ONE image request.
Prompt versions: runtime `designpro-flat-first-atlas-20260901.v17-labeled-teaching-topology`,
edge `atlas-artboard-designiq.20260901.v17-labeled-teaching-topology`. The
superseded unlabeled "repaired flat cohesion example" (`20085eb5…`) must not
reach Call 1. Locked by `tests/atlas-cohesion-teaching-pair.test.mjs`,
`tests/atlas-artboard-edge-call1.test.mjs`,
`tests/atlas-clean-authoring-contract.test.mjs`,
`tests/atlas-designiq-artboard.test.mjs`.

## 🎯 RULE 0.30 — CALL 1 IS A.T.L.A.S. AUTHORITY ONLY (owner ruling, Trish 2026-09-01)

Owner, verbatim: **"The only valid Call-1 image output is ONE flat A.T.L.A.S.
panel-layout source containing ONE cohesive vehicle wrap unwrapped flat. Any
installed vehicle, 3D vehicle, vehicle montage, presentation board, camera
view, studio render, or mockup is categorically invalid at Call 1. The 3D
presentation system exists downstream and has zero authority over Call 1. Do
not allow any Call-1 candidate that is not A.T.L.A.S. to become canonical or
fan out downstream."**

Why it exists: DCA generation `470cb0e9` (v17, 2026-09-01) proved Gemini can
answer the approved request with a photoreal vehicle-mockup montage (edge
master `6200fd41…`) that passes EVERY deterministic structural gate — those
gates convict silhouettes/voids/template leakage, and a bright render measures
as 94%+ "artwork" — after which the six canonical panels faithfully cut
pictures of a van. Provenance proved the montage bytes were authored directly
by Call 1 (`atlas-call1/aba7fbbf….png`, hash-equal to the edge `masterSha256`,
written before any proof existed), so the fix is Call-1 conditioning +
blocking acceptance, never artifact-authority wiring.

Enforced twice (prompt version `…20260901.v18-atlas-output-class`):
1. **Conditioning** — the flat-master contract carries "OUTPUT CLASS —
   ABSOLUTE"; both authoring scenes bind the output to the teaching example's
   object class.
2. **`runtime/atlas-output-class.cjs`** — one binary Gemini class question
   (temp 0, `gemini-2.5-flash`) inside the authoring gate, AFTER deterministic
   checks and BEFORE acceptance. An explicit `vehicle_depiction` verdict fails
   CLOSED (`flat_atlas_master_output_class_invalid`, re-roll within the
   bounded budget, never canonical, never fans out). Inspector transport
   failure fails OPEN with a durable `unavailable` receipt
   (`metadata.masterOutputClass`) — an outage must not brick authoring, and
   this is the ONE semantic question allowed to refuse Call 1; all other
   semantic review remains advisory. Locked by
   `tests/atlas-output-class-gate.test.mjs` and
   `tests/atlas-repair-before-reroll.test.mjs`.

## 📋 DCA PHASE 1 — CURRENT STATUS BOARD (2026-08-31, release `5d3ad9b`)

**This is a status board, not a rule.** It records what is true right now so a
session does not re-derive it, and so nothing gets reported as proven that a
live generation has not actually proven. Every rule below still governs.

**Three evidence levels are used, and they are not interchangeable:**

| level | means |
|---|---|
| **DEPLOYED-VERIFIED** | read back off the running system this session (deployed edge-function body hashed against the branch, live DB row, workflow log) |
| **CODE-LOCKED** | in the release and covered by a named test that was verified to fail against the defect it describes — but no fresh live generation has exercised it |
| **OPEN** | not done, not proven, or deferred |

### Release / deployment state

- Droplet (web, gateway, runtime) is on `37c4807`, deploy run `33433458730`,
  `Deployed web, gateway, and two exact-SHA DesignPro runtime replicas`,
  2026-08-31 20:02:34Z. `ops/deploy.sh` switches the `public` pointer after
  acceptance and exits 12 if it does not land, and Caddy roots
  `designproai.com` at `/opt/designproai-os/public/web/dist`, so that pointer
  IS the public path. "Caddy, DNS, and public traffic were not changed" in the
  log means the ROUTING CONFIG was untouched, not that the release is dark.
- `deploy-production.yml` does **not** ship Supabase edge functions. They are a
  separate dispatch-only workflow (`deploy-edge-functions.yml`). On 2026-08-31
  `persona-photographer-render` was found three days stale on the live project,
  missing the pickup-bed clause from PR #278; redeployed as v17 and verified
  byte-identical. **Check both halves before calling a SHA deployed.**
- `5d3ad9b` (the GENIE ambiguity retry) is merged and deploying at the time of
  writing. It is NOT yet deployment-verified.

### Contract and authority status

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Call 1 A.T.L.A.S. is the SOLE creative authority | **DEPLOYED-VERIFIED** | deployed `design-panel-ai-generate` index.ts hashes `a5b3c1e850d7eca4`, byte-identical to the branch; `tests/atlas-sole-design-authority.test.mjs` |
| 2 | Mandatory Flamingo FLAT teaching example pinned in the live Call-1 edge path | **DEPLOYED-VERIFIED** | SHA-256 `20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa` present in the deployed body; prompt version `atlas-artboard-designiq.20260831.v15-flat-example-only`. The installed Flamingo proof is NOT attached (canary `33389124918`) |
| 3 | DesignPanelAI Commercial/ReStyle persona + edge stack preserved | **DEPLOYED-VERIFIED** | all 11 shared deps of `design-panel-ai-generate` match the branch; RULE 0.29 pins verified live — `persona-photographer-prompt.ts` `11cb76524211e42a`, `view-angles-os.ts` `8890be50c124a2c5`, `studio-os.ts` `7b02814bb1e9e867` |
| 4 | Raw Gemini can STILL return silhouette / black-surround invalid A.T.L.A.S. output | **OPEN — by design** | unchanged model behaviour. `normalizeAtlasMaster` only resizes and masks gutters, so it cannot introduce in-zone black: the contract is first violated at the raw Gemini output. This is now CAUGHT, not prevented |
| 5 | `edgeHoleRatio` blocking acceptance gate | **CODE-LOCKED** | `runtime/atlas-master-qc.cjs`, `MAX_ZONE_EDGE_HOLE_RATIO = 0.35`; commit `cf36b0b`, shipped in `37c4807`. Closes the hole where `edgeOpaqueRatio` measured ALPHA and a silhouette on black scored 1.00000. Fixtures in `tests/atlas-master-qc.test.mjs` |
| 6 | Structural POST-REPAIR re-validation | **CODE-LOCKED** | `flat_atlas_repaired_master_invalid` in `runtime/flat-first-atlas.cjs`, commit `dbcb051`. Determinism proves a repair is repeatable, not that its result is valid |
| 7 | Post-repair validated bytes BECOME the canonical accepted master | **CODE-LOCKED** | `acceptedMasterBytes` / `acceptedMasterHash`; `tests/atlas-accepted-master-is-the-repaired-one.test.mjs`. Promotion happens only AFTER re-validation passes. Clean masters are byte-identical and pay no extra transform |
| 8 | `preRepairMasterHash` is PROVENANCE ONLY | **CODE-LOCKED** | same commit and test; it may never again be called canonical, accepted, or what "Master QC passed" refers to |
| 9 | All six Call-1 panels bind `sourceMasterHash` to the ACCEPTED master hash | **CODE-LOCKED** | `cutCallOnePanels(surfaceSourceBytes, manifest, acceptedMasterHash, …)` and `sourceMasterHash: acceptedMasterHash`, both asserted. **Not yet proven by a fresh live generation** |
| 10 | PanelPro / RevisionStudio display the ACCEPTED master and panels, never pre-repair authority | **CODE-LOCKED** | the published root carries `contentHash: acceptedMasterHash`; revision row records it. **Not yet proven by a fresh live generation** |
| 11 | Exactly six canonical surfaces | **CODE-LOCKED** | `SURFACE_KEYS = ["driver","passenger","hood","roof","front","rear"]`, frozen, `runtime/flat-first-atlas.cjs:98`. Front is the bumper/fascia surface |
| 12 | No downstream AI panel producer; Call 9 is verification/promotion only | **CODE-LOCKED** | RULE 0.25; Call 9 creates no artwork and changes no bytes |
| 13 | Customer 2D Proof and internal 2D Production Proof are SIBLING BRANCHES and may not gate panel publication | **CODE-LOCKED** | `docs/ATLAS_ONE_ARTIFACT_GRAPH.md` §7B (PR #278). Call 1 streams panels per cut and builds each proof authority the instant its panel exists; `proof.build` sits after the panel and logo branches. No barrier to remove |
| 14 | Server-owned orchestration required; browser becomes observer-only | **OPEN** | standing requirement, not fully proven |
| 15 | False-serialization audit | **OPEN** | remains open wherever not completed |
| 16 | GENIE `genie_grounding_ambiguous` corrective re-ask | **CODE-LOCKED, DEPLOY IN FLIGHT** | `fd4a35e`, merged as `5d3ad9b` (PR #280). Both new failure tests verified to fail against the pre-fix resolver |
| 17 | Fresh DCA must verify the PERSISTED vehicle payload before any GENIE/A.T.L.A.S. work | **OPEN — required next** | the 2026-08-31 20:09:20Z failure stored `model: "F150"`; do not assume user error. Read `request_input->'vehicle'` and compare to what was typed BEFORE proceeding |
| 18 | Input contract drops cab/bed configuration | **OPEN — backlog, NOT this release** | `designpro.calls-1-7-input.v3` carries only `make`/`type`/`year`/`model`. Configuration-critical for F-series: the catalog's own 2008-2010 rows put Crew Cab Long Box at 251″ and Crew Cab Short Box at 234″. Do NOT widen the contract unless a fresh DCA proves it blocks progress |
| 19 | 2022 F-series geometry is PROVISIONAL / grounded estimation | **DEPLOYED-VERIFIED (data)** | the whole Ford catalog has 5 rows covering 2022 and all five are Transit vans. Every F-150 row ends 2020, every F-250 row ends 2016. Report such runs as estimated/provisional, never catalog-authoritative |
| 20 | Creative design-quality tuning | **DEFERRED** | deferred until DCA Phase 1 is complete. Do not start it from a documentation pass |

### CURRENT DCA CHECKLIST

**Leave every box unchecked until a FRESH live generation proves it.** Nothing
below is checked, because no DCA has completed on this release.

- [ ] Fresh DCA submitted on the deployed release; build SHA confirmed in the footer
- [ ] Persisted `request_input.vehicle` matches exactly what the owner typed
- [ ] GENIE resolves without `genie_grounding_ambiguous`
- [ ] Geometry source reported honestly (catalog-authoritative vs grounded/provisional), with the resolved `sub_type` named
- [ ] Call 1 executes exactly once and returns a master
- [ ] Deterministic master checks report per-surface measurements
- [ ] Repair ran / did not run — recorded either way
- [ ] `preRepairMasterHash` recorded when repair changed the source, null when it did not
- [ ] Accepted canonical master hash + storage path recorded
- [ ] Six Call-1 panel hashes recorded
- [ ] All six `sourceMasterHash` values equal the accepted canonical master hash
- [ ] Six surface identities correct: Driver, Passenger, Hood, Roof, Front, Rear
- [ ] A.T.L.A.S. master published to PanelProStudio and RevisionStudio, showing the ACCEPTED sheet
- [ ] Progressive panel publication timing recorded
- [ ] Driver proof first, then the remaining six concurrently; fan-out timing recorded
- [ ] Owner visual inspection at PanelProStudio: master → six clean panels → matching 3D proofs
- [ ] **STOP HERE.** No Full QC and no creative changes until the owner approves those artifacts

**If Call 1 refuses the master:** report the exact structural rejection and the
per-surface measurements. Do not work around it and do not change conditioning.

## 🗺️ RULE 0.0 — A.T.L.A.S. IS ONE VEHICLE-WRAP DESIGN, NOT SIX ANONYMOUS DESIGNS. (Trish 2026-08-31)

This owner correction supersedes any later historical wording in this file
that tells Call 1 to hide the target vehicle, replace named surfaces with
anonymous `FIELD A–F` language, or treat its six regions as generic livery
canvases.

**A.T.L.A.S. means one cohesive vehicle-wrap design arranged flat as six named
printable production surfaces for one exact target vehicle.** The vehicle is
design and installation context; Call-1 output pixels are not a vehicle
photograph, rendering, silhouette or anatomy drawing. Driver, Passenger, Hood,
Roof, Front and Rear are coordinated rectangular surfaces of one composition,
never six independent creative prompts.

The image model receives the server-resolved year/make/model, GENIE body class,
the named surface mapping and coverage context it needs to design for the
installed vehicle. GENIE/code remains the geometry authority. Numerical
dimensions and installer geometry never become printable prompt furniture.

For pickups, exterior bed sides and tailgate receive the coordinated artwork;
the bed floor and inner bed walls remain unwrapped under the downstream vehicle
application/proof coverage contract. Do not claim a dedicated bed contour mask
exists unless a durable contract and artifact prove it. That exclusion never
punches a hole into Call 1: all six source panels remain pure, opaque,
uninterrupted, full-bleed rectangles.

Call 1 accepts and durably binds the master plus the six canonical panel files.
Separating those exact rectangles is deterministic byte handling, not a later
creative extraction. Both the master and all six Call-1 panels publish to
PanelProStudio immediately after Call-1 acceptance. Call 9 only re-reads,
hash-verifies and promotes those unchanged bytes; it is never their creator and
never their first UI publication boundary.

The quality baseline remains the proven DesignPanelAI vehicle-wrap designer
persona and its populated structured inputs. Call 1 receives one hash-pinned,
owner-approved **flat Flamingo A.T.L.A.S. example** plus the neutral target
guide. An installed/3D vehicle proof is not a Call-1 teaching input: production
canary `33389124918` proved that the finished-vehicle image overpowered the
flat-source instructions and leaked vehicle/template anatomy into the canonical
rectangles. The flat example is reference-only and may not contribute customer
artwork, branding or production authority. Do not silently restore a
stylistically or structurally contaminating installed example.

## 🎯 RULE 0.1 — TWO SEPARATE GOLD STANDARDS. DO NOT MIX THEM. (Trish 2026-08-17)

Design quality and output-pipeline correctness are judged against **different
references**. Conflating them is how a good hero render got read as "the
pipeline works", and how a working July-24 pipeline got read as "the designs
are fine".

| Layer | Gold standard | Judge |
|---|---|---|
| **Design quality / generation behaviour** | the proven pre-regression DesignPanelAI production body of work (including Flamingo Pools, the commercial fleet gallery and owner-identified strong designs) | is one vehicle-specific design premium, cohesive and consistent across its six surfaces and presentation descendants |
| **Output / production pipeline** | the **July 24** working state, `docs/LAST-WORKING-STATE-2026-07-24.md` | does the chain still produce the artifacts it produced then |

The distressed Martini Porsche used a customer-requested one-off camera angle.
Neither that angle nor an aspect-ratio change is the regression being diagnosed.
Do not turn either into a new global design contract. Do not use July 24 alone
to judge current design-generation quality.

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

- **The accepted flattened A.T.L.A.S. is weak or internally inconsistent** →
  parity-diff Call 1 first: exact prompt, designer persona, canonical vehicle,
  body class, named surface relationships, customer fields, references and
  hashes. A short prompt or unpopulated structured inputs means the Call-1 port
  or caller is incomplete.
- **The accepted A.T.L.A.S. is cohesive but a presentation descendant drifts** →
  trace only that view's `persona-photographer-render` / angle / surface-panel
  input. `generate-color-render` is historical presentation behavior, not a
  substitute creative authority and not an automatic diagnosis.

**Do not touch Calls 8+ during that determination.**

Once the seven-view layer is proven, switch models back to July-24 regression
for output. The question there is not "how should the pipeline work" — it is
**"what exact wiring or state difference stops today's system behaving like
July 24?"** Keeping the front-half and back-half investigations separate is
what stops the output path being treated as greenfield again.

**Where the proven quality came from.** The production body of work used
`design-panel-ai-generate` with its vehicle-wrap designer persona and populated
structured brief inputs. Studio and angle contracts governed the 3D
presentation descendants. A weak accepted flattened master is therefore a
Call-1 conditioning/input regression; a correct master with one drifting view
is a presentation-projection regression. Keep those diagnoses separate.

## 🛞 RULE 0.15 — A WRAP PANEL IS A SOLID RECTANGLE. THE INSTALLER CUTS THE HOLES. (Trish 2026-08-23)

**Every A.T.L.A.S. zone, every canonical Call-1 panel, every print file is one solid
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
  is `designpro-flat-first-atlas-20260831.v16-flat-example-only`; older masters are refused for
  NEW authoring/regeneration only, never migrated — and never hidden: existing
  generations stay readable/viewable/downloadable on every read surface
  (owner protection #1, locked by `tests/atlas-historical-read.test.mjs`).

  **REFERENCE STATUS CORRECTION (2026-08-31, after production canary
  `33389124918`).** The earlier installed↔flat teaching pair is historical and
  must not be sent to Call 1. The accepted master under GenerationID
  `083d2a70-edac-4e75-9caa-1336542baf7c` preserved wheel-well shapes, white
  guide/gutter bands and template furniture even though it passed the older
  deterministic gates. Request inspection proved that the installed Flamingo
  Driver proof was the strongest visual instruction and reintroduced the
  anatomy that source rectangles must exclude.

  Call 1 therefore presents the release-pinned, pure-rectangle Flamingo flat
  teaching example (SHA-256
  `20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa`)
  before verified customer references, then presents the current neutral
  target guide last. The historical GenerationID remains
  `5b2eb96c-77b5-4705-8cad-fef00af677fe`; its installed proof remains useful as
  historical/presentation evidence but is not attached to Call 1. Surface
  names and IDs remain server metadata and prompt mapping only. They must never
  appear as labels, captions, legends, headers or printable pixels. The
  historical Houdini pair stays dormant.

  **An A.T.L.A.S. master is one flat production atlas FOR a vehicle wrap.**
  Canonical YMM, GENIE body class and the six named surfaces reach the prompt as
  design context. The returned pixels remain six pure printable rectangles and
  carry no vehicle photograph, outline, anatomy, wheel, window, seam, void or
  shaped opening. Numeric geometry, coverage and production dimensions remain
  code/GENIE authority. Hiding all physical meaning behind anonymous `FIELD
  A–F` removed the context that makes the composition a vehicle wrap rather than
  abstract art; drawing that context into the pixels is the opposite error.

  The output defect is any vehicle depiction or opening rendered into the
  printable rectangles instead of artwork painted through at full opacity.
  The sheet must read as **ONE cohesive flat production master**, not six
  designs sharing a canvas and not a flattened vehicle illustration.

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

  The `2026-08-31` production master exposed a separate deterministic class:
  **cross-surface structural template leakage**. A repeated signature of
  mirrored flank gutters beside full-axis guide lines plus matching outlined
  bands on multiple centre surfaces is a blocking structural failure. The
  signature is deliberately narrow: a legitimate white-base livery does not
  fail merely for containing white artwork. This gate does not use semantic AI
  and does not repaint opaque white anatomy with the dark cut-out fill.

**Do not relax deterministic structural thresholds to get a run through.** A
master that fails required container coverage, opacity, canonical artifact,
hash, dimensions or lineage is invalid. Semantic/visual review is advisory and
may not refuse or delay Call 1. Production defaults to one creative image call;
an explicit operator authoring attempt may use the existing bounded retry
contract, but a browser/network retry may never mint a second master.

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
| **blocking** — structurally invalid authority | blank/missing zone, broken container coverage, invalid canonical bytes/hash/lineage | fatal; downstream production has no valid source |
| **cut-out** — a defect in the *panel* | wheel arch, glass, bed opening punched out | design and proofs survive, affected surfaces flagged |

Semantic review may report coherence, brief-fidelity or lettering concerns, but
it is advisory. It cannot block publication of a deterministically valid Call-1
authority. `masterCutoutSurfaces` / `masterCutoutFindings` remain durable
forensic evidence for PanelPro human review.

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

### ⚠️ SUPERSEDED — THE ACCEPTED MASTER *IS* THE REPAIRED SHEET (Trish 2026-08-31)

**Owner, reading the code after the post-repair re-validation landed:** *"even
after successfully repairing and re-validating the sheet, the progressive/
canonical A.T.L.A.S. object still points to the ORIGINAL pre-repair masterBytes
and masterHash … A.T.L.A.S. shown to humans = bad original, Panels/proof
authority = repaired derivative. That is not one canonical authority."*

That is the contradiction PanelPro printed on its face — *"repaired sheet ·
Master QC passed"* over a sheet visibly full of holes — and it is why the owner
saw a corrupt A.T.L.A.S. while the panels were cut from something else.

**So the two-master model below is retired.** After structural re-validation
passes, the repaired bytes BECOME the accepted canonical master:

```text
acceptedMasterBytes = cutoutFill.changed ? surfaceSourceBytes : masterBytes
acceptedMasterHash  = cutoutFill.changed ? panelSourceHash    : masterHash
```

and the published root, the six panels' `sourceMasterHash`, the persisted bytes,
the revision row, the proof authority and both UIs all cite that one hash.

**Why this does not reintroduce the defect the old rule guarded against.** The
old warning was real: publishing the repaired hash as the panel lineage made a
correct pair report *"the proof and the panel came from different masters"* —
true while TWO masters exist and the panels cite the one that is not canonical.
Promoting the repaired sheet to canonical DISSOLVES that split rather than
moving it: afterwards there is exactly one accepted master.

The pre-repair sheet is kept as `preRepairMasterHash` — **provenance only**. It
may never again be called the canonical master, the accepted master, or the
thing "Master QC passed" refers to.

On a clean master this is identity: `fillMasterCutouts` returns the same buffer,
`changed` is false, both bindings fall through to the original bytes and hash,
the storage path is the one already derived, and the re-validation is skipped —
no extra transform, no extra hash, byte-identical output. Locked by
`tests/atlas-accepted-master-is-the-repaired-one.test.mjs`, which convicts a
pre-repair canonical root, a pre-repair panel lineage, and promotion before
validation.

**Also blocking now: a zone whose artwork never reaches its own border.**
`edgeOpaqueRatio` was the full-bleed test and it measures ALPHA — and black is
opaque, so a vehicle silhouette on a black surround scored 1.00000 and was
accepted. `edgeHoleRatio` measures the same border ring with the same `holeAt`
predicate the cut-out detector and the fill share; a majority-artwork zone whose
border is >35% hole is a BLOCKING structural failure, not a repairable cut-out.
The threshold is this file's own v4 measurement (good masters: border median
135–177; the failing run: 63–83% of each border dark). The bright-majority guard
keeps a legitimate black wrap legal, with its own fixture.

#### HISTORICAL — the two-master model, superseded above

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

**The canonical Call-1 panel is ARTWORK authority. The photographer/view/studio stack
is PRESENTATION authority only.** Every output must persist `generationId`,
`atlasRevisionId`, `sourceMasterHash`, `surfaceKey`, the source panel artifact
id + hash, and `shotKey`, so both UIs can prove a proof came from its matching
panel.

### ✅ IT IS NOW WIRED THAT WAY — THE DEPLOYED PHOTOGRAPHER RENDERS EVERY PROOF (Trish 2026-08-28)

Owner, verbatim: **"DO NOT CREATE ANOTHER 3D EDGE FUNCTION. Use
`supabase/functions/persona-photographer-render/index.ts` with
`persona-photographer-prompt.ts`, `view-angles-os.ts`, `studio-os.ts`. For
ATLAS, replace the historical `heroRenderUrl` artwork reference with the
matching persisted `sourcePanelUrl`/`sourcePanelHash`. Passenger must receive
its Passenger panel. Driver must receive Driver. Hood receives Hood, etc. Do
not skip the panel input for Passenger. Do not use Driver as artwork continuity
authority. ATLAS panel = artwork authority. Photographer + angles + studio +
lighting = presentation authority only."**

Until this date the pin above was a REFERENCE the runtime imitated: the proofs
were produced by `createAtlasDesignPanelProvider`, which built its own
`buildAtlasProjectionPrompt` and called Gemini through the key pool. It reached
the same studio and the same angles by importing the same kernels, so no single
line of it was wrong — but a second implementation of a proven stage drifts, and
the A/B against the pin showed exactly that: a Driver continuity photograph the
proven stack never sent, a 3.5K prompt against the photographer's 1.4K, its own
retry ladder, its own aspect ratio, and a nine-contract acceptance judge with no
counterpart in the pin at all. Live cost on request `f3eb40c1`: every one of the
eight refusals was a JUDGE VERDICT on a rendered image, not a renderer error.

**The producer is now the deployed function, in `mode: "atlas-proof"`:**

| authority | owner | changed? |
|---|---|---|
| words | `persona-photographer-prompt.ts` → `buildPhotographerPrompt` | no |
| camera, framing | `view-angles-os.ts` → `CAMERA_ANGLES[shotKey]` | no |
| studio, lighting | `studio-os.ts` | no |
| model + fallback | `model-config.ts` | no |
| **artwork** | **the surface's persisted canonical Call-1 panel (later Call-9-promoted without byte change)** | **yes — this is the one** |

`persona-photographer-prompt.ts`, `studio-os.ts` and `view-angles-os.ts` stay
byte-pinned. `persona-photographer-render/index.ts` is now ADAPTED, per this
rule's own "adapt, do not restore blindly", and
`tests/proof-stack-pinned-sources.test.mjs` asserts the adaptation touched the
artwork input and nothing else.

**Four behaviours that must never come back:**

1. **`skipHeroShots = ['passenger-side', 'close-up']`.** The hero path dropped
   the reference image for those two shots because a DRIVER-SIDE hero biased
   the camera. That reasoning dies with the swap: the passenger panel is not a
   driver photograph, it is the passenger side's own artwork, and dropping it
   leaves the model to invent that flank. Every shot gets its own panel.
2. **A text-only retry.** The hero path re-sent `[{ text: prompt }]` on attempts
   2+. Under a hero that lost a hint; here it loses the ARTWORK and the proof
   becomes a different wrap. The panel rides every attempt.
3. **The Driver continuity reference.** Added 2026-08-26, ruled out by name
   here. Cross-view identity rests on the shared master, hash-bound per
   surface — a stronger guarantee than injecting one render into the others.
4. **A public URL for the panel.** `wrap-files` is private; a public URL 400s.
   The panel travels as a STORAGE PATH plus sha256, and the function verifies
   the bytes are the artifact the caller named (`atlas_proof_panel_hash_mismatch`),
   as does the caller on the returned proof.

The roof is included even though `PHOTOGRAPHER_SHOT_SEQUENCE` is the historical
SIX-shot magazine sequence: `CAMERA_ANGLES` carries all seven, so `atlas-proof`
resolves against `ATLAS_SHOT_SURFACES` instead. That changes which pinned angle
may be requested, never the angle text. A shot handed the wrong surface's panel
is refused (`atlas_proof_surface_mismatch`), never rendered.

## 📐 RULE 0.28 — ONE NAMED VEHICLE A.T.L.A.S. ON GENIE CONTAINERS, FILLED EDGE TO EDGE, WITH NO BODY LINES (Trish 2026-08-27; corrected 2026-08-31)

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
2. **One geometry, two consumers.** The durable installer guide carries the
   named surfaces, GENIE dimensions and 5″ bleed for humans and forensic
   checks. The image model receives the same six-region geometry as a clean,
   unlabeled mask plus a server-authored text mapping for Passenger, Driver,
   Rear, Roof, Hood and Front. It does not receive anonymous `FIELD A–F`
   aliases, pixel dimensions or installer annotations.
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

5. **Unwrapped regions never become holes in Call-1 artwork.** Owner: *"masked
   truck bed must not have any wrap design."* A pickup's bed floor and inner
   walls carry no installed vinyl, but Call 1 still fills every source rectangle
   completely. That exclusion belongs to downstream vehicle application/proof
   mapping. Do not claim a dedicated deterministic bed contour mask exists
   unless its durable contract and artifact are identified.
6. **Every 3D proof is built from that side's canonical Call-1 panel, and nothing
   waits.** Owner: *"ALL 3d from extracted panels — no waiting. Individual
   panels fed to 3d sides and duplicated, put in RevisionStudioIQ alongside 3d
   proofs and in PanelPro with all upscaled assets."* `panel(surface) → 3D
   proof(surface)` the moment that panel is cut. `buildViewAuthorities` /
   `viewAuthorityFor` must hash-bind to the persisted Call-1 panel rather than
   to a fresh crop of the master — same strictness, pointed at the artifact the
   customer actually buys. Each panel is then duplicated and published without
   waiting for the set: RevisionStudioIQ beside that side's proof, PanelPro with
   the upscaled assets.

### THE SHELL IS THE OWNER'S TOPO SHEET (Trish 2026-08-27)

**CURRENT CONTRACT — 2026-08-31.** The master uses one fixed 4096×4096
six-region canvas. That square storage canvas is not an aspect-ratio quality
fix. `CENTER_ORDER` is `rear → roof → hood → front`. The model-facing guide is
an unlabeled, unstroked deterministic mask so labels and dimensions cannot be
copied into artwork. Canonical YMM, body class and the named Driver, Passenger,
Rear, Roof, Hood and Front mapping travel in the Call-1 text/data contract. The
separate human installer map may show labels, IDs and dimensions. Do not restore
anonymous `FIELD A–F`, model-facing technical furniture, or a vehicle silhouette.

#### HISTORICAL SHELL DESCRIPTION — SUPERSEDED; DO NOT IMPLEMENT

Historical spec: **"A.T.L.A.S. FLATTENED – TOPO TOP VIEW · SINGLE SOURCE MASTER · SIX
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

Historical contract `atlas-artboard-designiq.20260827.v5`, folded into the Call-1 `promptHash`
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
cutover. This paragraph is historical; the current v15/v14 contracts and
2026-08-31 correction at the top of this file are authoritative.

## 🧬 RULE 0.27 — ONE ARTIFACT GRAPH. CODE OWNS THE ARTBOARD; A.I. OWNS THE DESIGN. (Trish 2026-08-27)

**Full directive: `docs/ATLAS_ONE_ARTIFACT_GRAPH.md`. Read it before touching
RevisionStudioIQ, PanelPro Studio, Call-1 panel separation/publication or the proof fan-out.**

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
   rectangular surface containers, their real GENIE proportions, positions,
   surface IDs and the master canvas. The model-facing mask stays free of
   printable labels; the Call-1 data/text maps every region to its named
   vehicle surface. DesignPanelAI then authors ONE cohesive wrap INSIDE those defined
   interiors in ONE Call 1. **The A.I. owns the design; the code owns the
   geometry.** Still one source design, still one authoring call.
2. **THE MASTER FANS OUT IN PARALLEL, IMMEDIATELY.** Canonical Call-1 panels
   (+5" bleed), logo/asset analysis, and the Driver proof all start on master acceptance. The
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

Status 2026-08-31: server fan-out and Call-1 panel persistence exist. The
observed regressions are specific: Call 1 was conditioned as anonymous fields;
PanelPro treated a thin index record as a hydrated job and hid Call-1 panels;
the Hood proof staging allowlist rejected `hood_detail`. Repair those proven
defects without adding a producer or changing graph authority.

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
  `PROMPT_VERSION` = `designpro-flat-first-atlas-20260831.v16-flat-example-only`.
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
- Acceptance (owner correction 2026-08-31): do not run speculative canaries and
  do not substitute a canary for the real deployed customer-style DCA. After
  the earlier no-canary instruction, the owner explicitly authorized a fresh
  production canary while away so the observed source and Call-8 defects can be
  verified on the deployed path. That authorization is specific; acceptance is
  still pending until the corrective release is deployed and the new run
  produces inspectable evidence.
  Publish the accepted master and six Call-1 panels immediately; continue the
  same lineage through the required views, Call 8 and Call-9 promotion; then
  stop the real DCA in PanelProStudio for owner confirmation before Full QC.

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

### ✅ THE v4 FLANK REGRESSION IS NOW LOCATED AND REPAIRED

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

The current repair is evidence-based: the Call-1 contract restores canonical
year/make/model, GENIE body class, the six named physical surfaces and the
proven vehicle-wrap designer persona. It removes anonymous `FIELD A–F`
conditioning and the active Driver-to-Passenger rewrite. Passenger remains its
own authored Call-1 region; continuity is required at the design-system level,
not by forcing pixel mirroring. A production canary may diagnose the live graph
when the owner explicitly requests it; the real owner-visible production DCA
remains the final customer-path acceptance test.

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

The live Call-1 teaching input does not come from that bucket. It is one
release-owned, hash-pinned solid-rectangle flat example from Flamingo
GenerationID `5b2eb96c-77b5-4705-8cad-fef00af677fe`, SHA-256
`20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa`.
The model sees that flat example and the current neutral target guide. It does
not see the historical installed Driver proof: canary `33389124918` proved that
finished-vehicle imagery teaches wheel wells, body anatomy and template
furniture back into the source. Dedicated role text forbids copying the
historical artwork, wording, logo, brand, palette, typography or industry.
Surface names/IDs are metadata-only mapping and must never render into the
canvas.

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
| **STRUCTURAL** | the one release-pinned Flamingo pure-rectangle flat example plus neutral target guide | how ONE cohesive wrap composition occupies six flat print-art rectangles | contribute installed vehicle anatomy, artwork, wording, logo, colour, brand, style, target geometry, visible labels or production authority |
| **CREATIVE** | the customer's own VisionBoard images | artwork authority under `exact_reference`; style authority under `style_inspiration` | — |
| **PRESENTATION** | the 3D proof example + Studio OS | vehicle presentation, camera, studio, photorealism, wrap realism | contribute artwork or redesign the customer's wrap |

Exactly one flat structural example is attached, and its hash plus historical
GenerationID enter the immutable example-set/reuse fence. The installed
Flamingo proof and historical Houdini pair are not Call-1 inputs. The flat
example teaches cohesive rectangular output only and never becomes creative or
production authority.

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
built panels in the browser; here Call 1 deterministically separates and stores
the six authored regions. Call 9 verifies and promotes those same bytes. A side
with no Call-1 panel is reported as server work, never hand-patched — adding
those buttons back is the second producer the one-sanctioned-chain rule forbids.

A side may display its canonical Call-1 panel as soon as it exists. Production-
promotion/QC state appears only after Call 9 verifies that same panel; a view
render alone never substitutes for either state.

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
RevisionStudio and PanelProStudio receive immediately. That
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

Left is that surface's 3D proof. Right is the deterministically separated
canonical Call-1 A.T.L.A.S. panel for that exact `surfaceKey` at GENIE
dimensions + 5" bleed — **never
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
`correctedAt` and a required reason; a correction with no Call-9-promoted
canonical Call-1 panel to correct is refused. The branded panel is **never touched**, so `source.verify`'s
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
instant it lands. Call 1 separates and stores the six authored regions
deterministically before any proof renders, so panel publication is never on
the AI critical path.

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
bleed — no AI re-render for manufacturing and no cross-side reuse. Passenger is
its own named Call-1 authority and must never be replaced by mirrored Driver
pixels, whether automatically or as a hidden operator shortcut. An operator
may request a new proof or customer revision under the existing lineage rules.

Full spec, acceptance criteria, measured starting position, and the A/B session
split: **`docs/BEHAVIORAL-SPEC.md`.**

### CALL-8 DIMENSION TOTALS USE ONE ROUNDING BOUNDARY (2026-08-31)

Production canary run `33389124918`, GenerationID
`083d2a70-edac-4e75-9caa-1336542baf7c`, reached Entice `proof.build` but
correctly deferred with `genie_total_square_feet_mismatch`. The six verified
surface dimensions summed to `305.53` square feet when raw areas were summed
and rounded once. The design-time manifest instead rounded each surface first
and summed those rounded values, producing `305.54`.

That one-cent mismatch was a contract-construction defect, not a GENIE geometry
failure and not a reason to change any panel dimensions. Both the design-time
manifest and Call-8 request must compute total square feet from the same raw
surface areas and apply `nearest-0.01-after-raw-sum` exactly once. The repair is
not accepted as live until its release is tested, merged, deployed and a fresh
authorized production run produces the Call-8 proof.

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
| **9** | byte/hash/lineage verification plus production-promotion receipts for the six existing **branded canonical Call-1 panels**; it creates no artwork and changes no bytes |
| **10** | logo asset registration/separation for that accepted design |
| **11** | **duplicate** the six Call-9-promoted Call-1 panels, remove the **logos** from the **duplicates only**, and push those six `qc-panel` duplicates to PanelProStudio for human sizing/template QC |

**The hard order: Design/Call-1 panels → views + Call 8 → Call-9 promotion → Separate/Register logos → Duplicate +
de-logo → PanelPro QC → Topaz → Final outputs → ZIP → WrapBox.** Topaz upscales
the *approved* panels after human/template QC passes on the de-logoed
duplicates. **No Topaz before PanelPro. No mutation of the Call-1 branded
panels, ever.**

The runtime's frozen `STAGES` list already puts `await_panelpro_preflight_qc`
before `enhance.upscale`, so that constraint holds today — do not reorder it.
Call 11 inserts between `logos.extract` and `await_panelpro_preflight_qc`.

**Two sets exist on purpose:** the branded canonical Call-1 panels are the untouched
production artwork; the de-logoed duplicates are the working QC/template
validation set. **Call 11 may never overwrite or replace the branded production
panel set.**

### CALL 11 — DE-LOGO DUPLICATE SET (owner contract, verbatim)

> Input: the six immutable branded Call-1 panels after Call-9 promotion.
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

Each `qc-panel` keeps its canonical `surface_key` and its source Call-1 panel hash,
and may never enter Topaz/output/ZIP as production artwork. The exact functions
to port (`locateBrandingElements`, `collapseContainedBrandingElements`,
`strictGeminiBox2d` in `restylepro-os` `worker/index.js`) and the dilation /
clamp / honest-no-op pattern that goes with them: `docs/BEHAVIORAL-SPEC.md`.

### 6A — do not fabricate separability that does not exist

**There is no authoritative pre-branding base artwork, and no session may
synthesize one.** Calls 1–8 emit a single composited raster per surface
(`proof.build:455`, `role: canonical-production-surface`), Call 9 consumes
those exact Call-1 bytes (`panels.build:513`, *"Consume, never cut"*), and the
revision snapshot carries no base-artwork field. Do not erase, inpaint,
regenerate, pixel-lift, approximate a clean background, or reclassify baked-in
artwork as an overlay after the fact. That is a frozen-seam violation, not a
Manufacturing workaround.

This is a standing prohibition, not an open question. **Call 11's `qc-panel`
duplicates are not that base** — they are derived downstream from the immutable
branded Call-1 panels in their Call-9-promoted state, are non-authoritative, are never printed, and are never
Topaz/output/ZIP inputs. They must never be relabelled as production artwork,
promoted into the output set, or allowed to overwrite the canonical Call-1 panel set.

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
| Calls 1–7 port scope and named-surface authority | `docs/CALLS-1-7-PORT-SCOPE.md` |
| What ships first and what is unproven | `docs/GO-LIVE-READINESS.md` |
| Reference checkout | `restylepro-os` alongside this repo (clone it if absent) |
