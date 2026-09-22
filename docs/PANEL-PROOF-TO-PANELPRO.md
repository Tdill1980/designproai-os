# The Production Panel Proof and its assets in PanelPro Studio — what reaches it, what processes it, and what does not

**Owner request, 2026-09-22:** *"Also must send production panel proof and its
assets to panel pro studio / For processing and qc."*

This is the measured answer, traced through the runtime, the gateway, the
migrations and the live database on 2026-09-22. It is written so the next
session does not re-derive it, and so nothing here is claimed that a row or a
line of code does not prove.

**The headline, stated plainly: the assets DO reach PanelPro Studio and they DO
ship in the paid ZIP. What was missing is that no QC check asked about any of
them.** That is a narrower gap than "it isn't wired", and a different fix.

**Status, later the same day:** steps 1–4 of §7 are built (see §7 for what each
one is and where it is locked). Step 5 remains a product decision. §8 lists
what is still unproven.

---

## 1. What Call 1 actually produces, and in what form

`assemblePanelProofMaster` (`runtime/atlas-panel-proof-topology.cjs`) returns
five things. They are **not** equally durable, and the difference is the whole
story.

| artifact | stored in `wrap-files`? | artifact ROW? | recorded where |
|---|---|---|---|
| the three-zone **proof document** (the sheet) | yes — `atlas-panel-proof/<sha>.png` | **no** | `provenance.proofStoragePath` |
| **Zone 1** — six branded panels | **no** | **no** | described in `provenance.quadrants.branded[]`; the pixels become the accepted master |
| **Zone 2** — six clean panels | yes — `atlas-panel-proof/quadrants/<sha>.png` | **no** | `provenance.quadrants.clean[]` |
| **Zone 3** — cut graphics | yes — `atlas-elements/<sha>.{png,svg}`, or the customer's own upload path | **no** | `provenance.quadrants.cutGraphics[]` |
| the assembled **master** | yes (by the graph node) | **no** at Call 1 | `designpro_flat_atlas_revisions.master_storage_path` — real columns |

`putImmutableBytes` (`runtime/generation-store.cjs`) uploads content-addressed
bytes and writes **no database row of any kind**. Nothing in Call 1 touches
`designpro_artifacts`.

So: **exactly one durable identity exists at Call 1 — the master, as columns on
the revision row.** Everything else is a storage object plus a JSON identity
inside `metadata.panelProofAuthoring`.

**Zone 1 is deliberately never stored twice.** It IS the assembled master, and
its durable form downstream is the six Call-9 `panel` artifacts cut from that
master. A second copy would be the two-master shape the 2026-08-31 ruling
retired by name (RULE 0.21).

---

## 2. How it reaches the handoff

One write point: `runtime/flat-first-atlas.cjs` sets

```
metadata.panelProofAuthoring = generated?.panelProof || panelProofDocument?.provenance || null
```

`handoff_designpro_generation_to_production` then copies that **whole blob**
verbatim into `designpro_revision_sources.snapshot`, alongside `callOnePanels`,
`atlasRevisionId` and `sourceMasterContentHash`.

Migration `20260922051200` is what makes that happen on **every** accepted
handoff. Before it, the attach sat inside `IF v_logo IS NOT NULL`, so a brief
with no uploaded logo carried no proof at all. Confirmed live: 20 snapshots up
to 09-21 carry no `panelProofAuthoring`; the 09-22 snapshot carries it with an
empty logo inventory.

---

## 3. What the humans can see

Both PanelPro surfaces mount the three-zone sheet, and both reach it through
**one** endpoint and **one** component — RULE 0.21's one-reader-per-artifact:

- `GET /api/generation/requests/:id/panel-proof` → `designpro_atlas_panel_proof_paths`
  (owner-scoped, exact-name storage policy, five-minute signed previews, every
  raw path stripped).
- `AtlasPanelProofSheetLoader`, wrapped by `ProductionProofSourceCard` on the
  per-surface board and mounted directly in the control room.

**Zone 2 and Zone 3 both render as openable, downloadable images.** Zone 1 is
described rather than re-served, because it became the master, which `/atlas`
already signs.

Zone 2 appears a second time on the board as the Call 11 `qc-panel` artifact
with its own download link.

`{panelProof:false}` is a **state**, not a failure — a legacy six-surface or
field revision is a real design with no three-zone document.

---

## 4. What actually processes it

Exactly **three** stages read `snapshot.panelProofAuthoring`:

| stage | reads | does |
|---|---|---|
| `panels.delogo` (Call 11) | `quadrants.clean` | copies the frozen Zone 2 bytes verbatim as the `qc-panel` — `backgroundsReused: true`, **zero model calls** |
| `enhance.upscale` (Call 12) | `quadrants.clean` | fits each clean crop into the branded panel's own pixel rectangle, enhances to (trim + 10") × 150 → `upscaled-clean-panel` |
| `zip.build` | the sheet, the master, `quadrants.cutGraphics` | packages all three under `proofs/` |

Everything else is blind to it: `revision.freeze`, `panels.build` (Call 9 reads
only `callOnePanels`), `logos.extract` (Call 10 reads only
`expectedLogoInventory`), `proof.build` (Call 8), `pack.verify`,
`pack.activate`, `manifest.resolve`, `source.verify`, `output.build` /
`output.verify`, `stamp.build`, `wrapbox.deliver`.

The paid ZIP carries:

```
proofs/call1-three-zone-production-proof.png
proofs/atlas-master.png
proofs/cut-graphics/<role>-<hash12>.<ext>
flat-proof/…                 the Call 8 dimensioned production proof
qc-panel/…                   the six Zone 2 duplicates
output/<side>[-clean].{png,jpg,pdf,tiff,eps}
```

Call 8 and the Call 1 sheet are **distinct objects on purpose**; the code says
so in its own comment.

---

## 5. The real gap

Three things, in order of how much they cost.

### 5.1 No QC check asks about the proof, Zone 2 or Zone 3

This is the substantive one.

- The per-surface checklist is 13 items (`SURFACE_QC_CHECKLIST`): template,
  surface, version, fit, safeArea, openings, trimDims, printDims, bleed, dpi,
  customerText, artworkIntact, finalFileInspected.
- The preflight evidence block is 6 items: `dimensionsVerified`,
  `sourceRegionsVerified`, `fiveInchBleed`, `panelHashesVerified`,
  `logoInventoryVerified`, `textLockVerified`.

**Neither mentions the three-zone proof, the clean panels or the cut graphics.**
A reviewer can look at the sheet; nothing requires them to, and nothing records
that they did. The owner's instruction is "for processing and QC" — the
processing exists, the QC does not.

### 5.2 Zone 3 is packaged, never processed

`cutGraphicArchiveFiles` takes `persisted` entries **verbatim**. No stage
enhances, re-renders or cut-contours them. They carry no inches by contract
(sized at the plotter) — which is correct — but the cut-contour builder that
exists for GraphicsPro (`_shared/cut-contour/`) is never invoked for them.

### 5.3 The board that carries the checklist cannot submit it

`PanelProStudioBoard.tsx` submits `{ ...checks, approvedSides }` with **no
`surfaceQc`**, which `exactQc` refuses (400 `preflight_qc_evidence_incomplete`).
The UI that does send it is `AdminGeminiCompareStudio.tsx` — the route actually
mounted at `/designpro/jobs/:id/panelpro`. So the working preflight control is
the control room, and the per-surface board's button cannot complete the gate.

---

## 6. Two defects found while tracing this, both from `91d0b8e`

Recorded here because they are the difference between "the assets reach
PanelPro" and "the workflow that carries them is ever created".

### 6.1 `composition.contract`

Three consumers require the exact literal
`designpro.production-zone-composite.v1`:

| consumer | what a wrong value does |
|---|---|
| `designpro_private.panel_proof_is_composed` (20260920011000:9) | gates the graph-sourced read **and the storage signing policy** — the customer cannot see their own sheet |
| `designpro_private.panel_proof_logo_inventory` (20260920022906:22) | `generation_logo_placement_manifest_required` — the handoff fails |
| `zip.build` (`designpro-standalone-claimant.cjs:3407`) | `zip_call1_proof_incomplete` — the pack never builds |

**No runtime test can see any of them.** The string is now a named export,
`COMPOSITION_CONTRACT`, with the three readers listed beside it, and the
producer is recorded separately as `composition.brandedSource`.

### 6.2 `assetRole`

`panel_proof_logo_inventory` requires exactly one `quadrants.cutGraphics` entry
with `assetRole = 'logo'`. `91d0b8e` deleted the field from the Zone 3 mapping
and nothing has produced it since. Measured in the live rows:

```
2026-09-20 05:56   ["logo","typography","contact"]
2026-09-22 07:35   []
```

Because that gate sits inside `IF v_logo IS NOT NULL`, **the next customer to
upload a logo gets no entice workflow at all.** It went unnoticed only because
the runs after 09-20 carried no logo.

`tests/panel-proof-logo-handoff.test.mjs` hardcodes `assetRole:'logo'` into its
own fixture, so the SQL gate was proven against a field no producer emitted —
the fixture-laxer-than-reality shape CLAUDE.md already records six times. The
assertion now lives at the producer.

---

## 7. The fix, in the order it should ship

Nothing here adds a producer. Every step uses artifacts that already exist.

**Step 1 — shipped in this change.** Restore `assetRole`; pin
`composition.contract`; record `composition.brandedSource`. Without these the
workflow that carries the assets is never created for a logo-bearing order.

**Step 2 — make the QC gate see the proof. BUILT (2026-09-22).** Three keys
join the six in the preflight evidence block:

- `proofSheetReviewed` — the reviewer opened the three-zone sheet for this
  revision;
- `cleanPanelsMatchBranded` — Zone 2 is the same six panels without type;
- `cutGraphicsInventoried` — Zone 3 holds the elements the brief called for.

They are **human attestations**, like the existing six, and they are
**conditional on the frozen snapshot**: migration
`20260922130000_designpro_preflight_names_the_proof.sql` text-patches
`approve_designpro_human_gate` (never re-emits it — that would revert
`20260908193134`) so the three are required only when
`jsonb_typeof(v_source.snapshot->'panelProofAuthoring')='object'`. A
six-surface / field revision has no three-zone document and is not asked;
a key present with a JSON `null` is absence. The refusal is
`panelpro_proof_evidence_incomplete`, checked after the six-key
`panelpro_preflight_evidence_incomplete` and before the Call 9/10 receipt
check. The gateway (`PROOF_CHECKS` in `exactQc`) forwards each key the browser
sent as `true`, refuses a request that sends one as anything else, and never
fabricates one. `PROOF_CHECKS` in `app/src/lib/designpro-stages.ts` carries the
labels; `PreflightQc` carries the optional keys.

**Ship order is the REVERSE of what this paragraph first said.** The gateway
and the app *supply* the keys; the database *requires* them. Deploy the web and
gateway first, then apply the migration. Until it applies, the extra keys pass
the six-key containment check unharmed. Applying it first would refuse every
three-zone preflight until the deploy caught up.

Locked by `tests/designpro-preflight-names-the-proof-db.test.mjs` (the real
migration on PGlite over the real predecessor body: refuses six keys on a
three-zone snapshot, accepts nine, releases a legacy snapshot on six, treats a
null key as absence, and the `apply:false` case reproduces the defect),
`tests/panelpro-preflight-names-the-proof.test.mjs` (one key set on every
layer), the gateway case in `gateway/tests/gateway.test.mjs`, and the
reconcile locks in `tests/schema-gateway-reconcile.test.mjs` and
`supabase/tests/schema_gateway_reconcile.test.sql`.

**Step 3 — surface the sheet inside the QC flow, not beside it. BUILT.**
`ProofSourceAttestations` in the control room renders the three boxes inside
the Production Pack card, under the six, with evidence read from the proof
itself through **the same query the sheet loader uses** — `useAtlasPanelProof`,
exported from `AtlasPanelProofSheet.tsx`, one query key declared once (RULE
0.21, one reader per artifact): the sheet hash and V-number on the first row,
the Zone 2 count on the second, the Zone 3 inventory on the third, and
thumbnails of the Zone 2 and Zone 3 assets beside the box that signs for them.
The boxes are required unless the read **positively** answers
`panelProof: false`; a loading or failed read cannot prove absence. The release
button waits on them. The "Build Print Files" shortcut, which submits the same
gate, sends only the ticked ones and stops with *"Sign for the Production Panel
Proof first"* when the proof is on this revision and they are not all signed —
it never hard-codes them, unlike the six it already sends as literal `true`
(recorded here, not repeated).

**Step 4 — fix the board's submit. BUILT, by removal.** `PanelProStudioBoard`
had no per-surface checklist state to send, and `ProductionWorkflow`'s generic
`QcGate` sent the six keys alone; `exactQc` refused both before the RPC, so
every click returned 400. Both now stop offering a submit they cannot complete
and link to the control room (`/designpro/jobs/:id/panelpro`), which is the one
place the preflight is submitted — with the six attestations, the per-surface
checklists, the three proof attestations and the approved sides together. The
workflow page's final gate was complete on its own and stays. Locked by
`tests/panelpro-preflight-names-the-proof.test.mjs`.

**Step 5 — decide about Zone 3 cut contours.** The builder exists
(`_shared/cut-contour/`) and produces real `Separation /CutContour` PDFs. Zone 3
elements are raster or SVG with no inches. Running the contour builder on them
is a product decision, not a repair — and the component is currently asserted to
say plotter-ready contours are produced in the production pack, which is where
that builder lives. **Do not represent Zone 3 raster crops as vector cut files
until this step is actually built.**

---

## 8. What is NOT proven

- **No live generation has run on the repaired Call-1 path.** Acceptance is the
  owner's eye on the exported sheet against the seeded Ridgeline proof.
- **No fresh paid run** has confirmed the v4 60-file set lands in a customer's
  ZIP.
- Step 5 above is **not built**; it is a product decision. Steps 2–4 are built
  and locked, but **no reviewer has released a three-zone preflight through
  the new attestations on the live system.** The first paid three-zone run
  through PanelPro is the proof that the migration, the gateway and the card
  agree in production, not the green suite.
- The pgTAP lock in `supabase/tests/schema_gateway_reconcile.test.sql` runs
  only in the `supabase-shadow` job; it is not runnable in this sandbox.

Probe on the **validated F250**. The 2022 Porsche 911 Turbo catalog row
(`0c211a9d`) has never been operator-validated, so every 911 run fails at GENIE
regardless of the design.
