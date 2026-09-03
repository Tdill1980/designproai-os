# The behavioral spec — match the product, not an architecture

Owner directive, 2026-08-17. The screenshots in
`docs/LAST-WORKING-STATE-2026-07-24.md` **are the spec.** Optimize for
behavioral parity with the working product. Do not propose alternate
manufacturing models, and do not redesign the product.

Sessions got lost answering *"what is the elegant architecture?"* — design
master, surface masters, proof regions, synthetic masters, view-vs-origin. The
question is *"how does the app behave like the working product again?"*

## Required output behavior

1. Generate a **2D Production Proof** showing the six surfaces laid out with
   dimensions.
2. Generate **six per-side production cards**: Driver, Passenger, Front, Rear,
   Hood, Roof.
3. Each card shows **two things**: the **REAL DESIGN PROOF** (approved
   customer-facing side render) and the **PRINT PANEL** (print-ready panel for
   that same side).
4. The PRINT PANEL is **deterministically derived for that same side**, from
   the approved side/proof contract, at GENIE dimensions with **5" bleed**.
5. **No AI re-render for manufacturing.**
6. **No cross-side reuse.** Driver artwork must never appear as rear, front, or
   passenger.

**6A. Do not fabricate separability that does not exist.**

**There is no authoritative pre-branding base artwork, and no session may
synthesize one.** Calls 1–8 emit a single composited raster per surface; there
is no layer beneath it to recover. To manufacture one — by erasing, inpainting,
regenerating, pixel-lifting, approximating a clean background, or reclassifying
baked-in artwork as an overlay after the fact — is a frozen-seam violation, not
a Manufacturing workaround.

This is a standing prohibition, not an open question. The six `qc-panel`
de-logoed duplicates that Call 11 produces are **not** such a base: they are
derived downstream from the immutable branded Call 9 panels, are
non-authoritative, are never printed, and are never Topaz/output/ZIP inputs.
7. **Passenger mirror is an explicit UI action only** ("Mirror from driver"),
   never the default truth of the pipeline.
8. The UI supports the operations in the screenshots: **Pull panel**, **Upload
   panel**, **Approve side**, and the side-by-side proof/panel presentation.
9. The 2D proof stays a **visible proof artifact**; the per-side print panels
   are the **production artifact**. Both stay bound to the same side/source.
10. Do not redesign the product. Match this behavior.

## DesignID completion contract

Owner text, verbatim:

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

The critical invariant: **one DesignID owns Calls 1–8.** The customer-approved
DesignID/revision is frozen after Call 8, and everything after it is
deterministic manufacturing of that exact design. No second design generation
after approval. No independent manufacturing artwork. No reinterpreting the
brief downstream.

| Phase | Calls | Produces |
|---|---|---|
| Design | 1–7 | the design and all required locked-angle customer views, under one DesignIQ identity |
| Design | 8 | the 2D Production Proof for that accepted DesignID/revision, from the same approved state and GENIE geometry — **design work complete here** |
| Manufacturing | 9 | six immutable branded production panels |
| Manufacturing | 10 | logo asset registration/separation |
| Manufacturing | 11 | duplicate the Call 9 panels; remove **logos only** from the duplicates |
| Delivery | — | Order Production Pack → PanelProStudio/QC → Topaz upscale → output files → ZIP → WrapBox |

### The approved artifact contract

**Call 11 is real and required.** The runtime's missing Call 11 is a genuine
gap against intended product behaviour, not a numbering quibble. (An
intermediate "no Call 11, no duplicate stage" note was withdrawn the same day
and must not be re-applied.)

| Stage | Produces |
|---|---|
| **Calls 1–8 — DesignID** | approved/frozen design state · authoritative frozen overlay inventory · approved side renders · 2D Production Proof |
| **Call 9** | the six extracted **branded** production panels · GENIE geometry + 5" bleed · independent immutable hashes · **original production artwork, untouched from here on** |
| **Call 10** | logo asset registration/separation for that accepted design |
| **Call 11** | **duplicate** the six branded panels → remove **logos only** **from the duplicates only** → six `qc-panel` de-logoed duplicates → PanelProStudio |
| **Then** | PanelProStudio validates the de-logoed duplicates against templates/geometry → Topaz/output → ZIP → WrapBox |

Two sets exist **on purpose**:

- **Branded extracted panels** — original production artwork, untouched.
- **De-logoed duplicate panels** — the working QC/template-validation set for
  PanelProStudio.

#### CALL 11 — DE-LOGO DUPLICATE SET (owner contract, verbatim)

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

**The critical protection is that Call 11 operates on duplicates and never
mutates Call 9's branded panels.** Step 3 is the one to enforce mechanically:
re-verify the branded panel's hash after Call 11 runs, and fail the run if it
moved.

#### The hard order

**Design → Extract → Separate/Register logos → Duplicate + de-logo → PanelPro
QC → Topaz → Final outputs → ZIP → WrapBox.**

**No Topaz before PanelPro.** Topaz upscales the *approved* production panels,
after human/template QC has passed on the de-logoed duplicates — never before.
And no mutation of the original Call 9 branded panels at any point.

**The runtime already orders this correctly.** `STAGES`
(`designpro-standalone-claimant.cjs:29`) is frozen as:

```
revision.freeze → manifest.resolve → proof.build → panels.build →
logos.extract → pack.verify → pack.activate → source.verify →
await_panelpro_preflight_qc → enhance.upscale → output.build →
output.verify → await_final_human_qc → stamp.build → zip.build →
wrapbox.deliver
```

`await_panelpro_preflight_qc` sits **before** `enhance.upscale`, so Topaz
already runs after the PanelPro gate. That constraint is satisfied today and
must not be reordered.

**Every production file carries the panel data slug (owner, 2026-09-02).**
`output.build` renders a 1.5" data strip on the top (leading) edge of every PNG, TIFF
and EPS, outside the bleed, from the run's panel map (`panel-map` artifact,
`designpro.atlas-panel-map.v1`); Call 11's QC duplicates carry the same strip
at a fixed 120 px so the team reads it at preflight. `output.verify` refuses a
file without it. The canonical Call-1 panels are never touched. Contract:
`docs/PANEL-DATA-SLUG.md`.

**Call 11's insertion point is between `logos.extract` and
`await_panelpro_preflight_qc`** — its output is precisely what the PanelPro
gate is supposed to be validating.

#### How this squares with 6A

They are compatible, and the distinction is worth stating precisely because a
session will otherwise read them as contradictory.

**6A forbids inventing a pre-branding base and treating it as authoritative
artwork.** Calls 1–8 emit no such base, and no session may synthesize one.

**Call 11's output is not that base.** It is derived *from* the branded panel,
downstream of it, bound to its source hash, and it is a **QC instrument — never
printed, never authoritative, never a production deliverable.** Its job is to
let a human lay a logo-free panel on a vehicle template and check that the
sizing fits.

That difference in purpose also sets the fidelity bar. The RestylePro lesson
that "stripping smears" was learned when stripped output was treated as a
deliverable base. As a sizing-check artifact, imperfect removal is tolerable —
the panel only has to be dimensionally honest, not print-clean.

**The boundary a session must not cross:** a de-logoed duplicate may never be
relabelled as production artwork, promoted into the output/ZIP set, or written
back over a Call 9 panel.

### OWNER DECISIONS — BLOCKERS CLOSED (2026-08-17)

All three blockers below are **resolved**. They are kept on the record because
they explain *why* the decisions are what they are, but **no further
architecture decision is required — implement by matching the proven RestylePro
behavior.**

1. **Do not add Generation-side placement geometry merely to implement Call
   11.** Recover and use the proven RestylePro logo-removal/detection behavior,
   applied to Call 11 QC duplicates only. Forcing Generation to emit new
   placement rectangles would be another seam redesign, and the product already
   had a Call 11-style removal operation. **Where the proven implementation uses
   constrained AI/logo detection, that is allowed here** — the output is a
   non-authoritative QC instrument, never production artwork.
2. **Call 11 removes logos.** A.C.E.-authored company name, contact details and
   type treatment **may remain**. A phone number left on a QC duplicate does not
   defeat a sizing/template check. **Do not expand Call 11 into a general
   lettering/text-removal system.**
3. **The `qc-panel` artifact kind is approved.** Preserve the existing
   exactly-six panel invariant **unchanged**.
4. Call 11 sits between Call 10 and `await_panelpro_preflight_qc`.
5. Topaz remains after PanelPro preflight and operates on the **authoritative
   branded production path**, never the QC derivatives.
6. No further architecture decision is required.

#### The frozen Call 11 contract, as decided

> Call 11 = duplicate the six immutable Call 9 branded panels → remove logos
> from the duplicates using the proven RestylePro logo-removal behavior → save
> six QC-only derivatives → PanelProStudio.

- Do not remove A.C.E.-authored text merely because it is branding.
- Do not alter Call 9.
- Do not weaken the exactly-six production-panel assertion.
- Call 11 derivatives get their own `qc-panel` artifact kind.
- Each `qc-panel` retains its canonical `surface_key` and source Call 9 hash.
- `qc-panel` may never enter Topaz / output / ZIP as production artwork.

Flow: Call 9 branded six → Call 10 logo assets → Call 11 de-logoed QC
duplicates → PanelProStudio QC → Topaz **on the authoritative branded
production path** → final outputs → ZIP → WrapBox.

#### The proven reference to port (Rule 1)

Per `docs/RESTYLEPRO-REFERENCE-RULE.md`, the exact implementation to recover —
all in `restylepro-os` `worker/index.js`:

| Function | Line | Role |
|---|---:|---|
| `locateBrandingElements` | 4051 | the shared vision pass, with a re-ask/never-guess loop — the same one `/call7-sanity-check` consumes, so both see one detection |
| `collapseContainedBrandingElements` | 3783 | merges nested/contained boxes into one element |
| `strictGeminiBox2d` | 3750 | strict box parsing — malformed output is rejected, not guessed at |

The call-site pattern to port with it (≈4329): boxes come back normalized to a
0–1000 grid, are **dilated ~3% per side** to catch glows and drop shadows,
clamped to the panel, and filtered to a minimum 8px size. When no boxes are
found it is an **honest no-op** — a design with no branding has nothing to lift.
Preserve that; it is the behavior that stops a detection miss from becoming a
destructive edit.

### Why these were blockers — the measurements behind the decisions

Recorded for context. **These are closed; do not re-litigate them.**

**Blocker 1 — Call 10 carries no placement geometry.** Step 2 of the Call 11
contract says "remove the known logo regions." There are no regions.
`normalizeLogoAsset` (`runtime-contract.cjs:77`) returns exactly
`{bucket, storagePath, contentHash, byteSize, contentType}` — no x/y, no width,
no height, no bounding box. The Call 10 metadata adds `placementKey`,
`identityKey`, `displayName`, `targetSurfaceKey` and `sourceRegionHash`, but
`sourceRegionHash` is the hash of the **whole surface panel**, a binding proof
rather than a rectangle. So the inventory records *which side* a logo belongs
to and *which file* it is, never *where on the panel it sits*.

**Decided (owner decision 1): Call 11 detects the regions itself**, using the
proven RestylePro behavior named above. Generation is **not** to start emitting
placement rectangles for this — that would be a second seam redesign to buy
mathematical purity the product never needed. The constrained detection pass is
acceptable precisely because its output is a QC instrument, not artwork.

**Blocker 2 — A.C.E.-designed branding is not in the inventory at all.**
`expectedLogoInventory` holds **customer-supplied logo files**, normalized
through `normalizeLogoAsset` from the revision snapshot. The lettering A.C.E.
designs into the wrap — company name, contact bar, original typeface — is baked
into the composited raster and appears nowhere in that inventory, so logo
removal leaves the designed lettering in place.

**Decided (owner decision 2): this is not a blocker — it is the intended
behavior.** Call 11 removes **logos**. A.C.E.-authored company name, phone and
contact text, and designed lettering **may remain** — none of it defeats a
sizing/template check. "Remove logos" was never "remove every piece of
branding," and Call 11 must not become a general text/lettering-removal
system.

**Blocker 3 — the de-logoed set collides with the frozen exactly-six check.**
`source.verify` requires `sourcePanels.length === SURFACE_KEYS.length` and six
**distinct** `surface_key`s. That check is part of the frozen seam
(`docs/SEAM-FREEZE.md`) — it is what makes implicit mirroring impossible. Six
more panel artifacts in the same run would make it see twelve and fail as
`production_source_set_incomplete`.

`ARTIFACT_KINDS` (`designpro-standalone-claimant.cjs:39`) is likewise frozen and
has no slot for this:

```
flat-proof · panel · upscaled-panel · logo · output · stamp · zip · wrapbox-manifest
```

So the de-logoed duplicates need **their own artifact kind** (`qc-panel` or
similar), distinct from `panel`, so that:

- the branded six remain the only `panel` artifacts and the exactly-six check
  keeps working unchanged;
- the QC set can never be confused with production artwork by any downstream
  consumer, which is the same boundary rule stated under "How this squares with
  6A";
- each QC panel binds to its source branded hash and `surface_key` per step 5
  of the contract.

**Decided (owner decision 3): the `qc-panel` artifact kind is approved**, and
the exactly-six panel invariant is preserved **unchanged**. **Do not solve this
by relaxing the exactly-six assertion.**

### Supporting evidence — no separable base exists in Calls 1–8

This is the measurement behind rule 6A. It does not block Call 11 — Call 11
works downstream from the branded panel, not underneath it — but it is why no
pre-branding base may ever be synthesized:

**1. The revision snapshot carries no base artwork.** Every field
`designpro-standalone-claimant.cjs` reads off the accepted revision snapshot:

```
delivery · designId · designName · expectedLogoInventory
finish · generationId · logoInventoryAttestation · orderNumber · vehicle
```

There is no background, base, clean or underlying-artwork reference of any
kind.

**2. Calls 1–8 emit exactly one composited raster per surface.** `proof.build`
(line 455) persists each surface as a single PNG from `surface.bytes`, tagged
`role: "canonical-production-surface"`. One image per `surfaceKey`. No layer
stack, no alpha-separated branding, no clean variant.

**3. Call 9 consumes those exact bytes and cannot do otherwise.**
`panels.build` (line 513) is explicit in its own comment — *"Consume, never
cut. Each panel IS the surface Call 8 rendered from the canonical master…
There is no atlas to crop, no region to locate, and no generative pass anywhere
in this stage."* It re-hashes the bytes against what Call 8 recorded and fails
closed (`call9_surface_changed`) if they moved. It produces **one** panel
artifact per side.

So the branding A.C.E. designs into the artwork — original lettering, company
name, contact bar — is baked into that single composited raster and is **not**
represented in `expectedLogoInventory`, which holds customer-supplied logo
*files* normalized through `normalizeLogoAsset`. The two are different things.

**So there is no authoritative pre-branding base anywhere in Calls 1–8, and no
session may synthesize one.** That is 6A, and it still holds. It is not,
however, what Call 11 needs — Call 11 works downstream from the branded panel,
not underneath it.

### What is built, and what is missing

Checked 2026-08-17 against `runtime/`. The receipt kinds emitted, in full:

```
views.seven-source · call8.flat-proof · call9.surface-panels
call10.logo-inventory · call12.topaz-upscale
```

| Contract | Runtime | Status |
|---|---|---|
| 9 — six immutable branded panels | `call9.surface-panels` | **correct as built** |
| 10 — logo asset registration/separation | `call10.logo-inventory` | **correct as built** |
| 11 — duplicate + remove logos from duplicates | *(nothing)* | **missing — build this** |
| 12 — Topaz upscale, after PanelPro preflight | `call12.topaz-upscale` | **correct as built** |

**Call 11 is the only missing stage.** Calls 9, 10 and 12 match the contract
and are not to be reworked.

For reference when implementing Call 11: Call 10 registers rather than lifts.
`logos.extract` (`designpro-standalone-claimant.cjs:576`) reads a frozen
`expectedLogoInventory` from the revision snapshot, requires an explicit
`none`/`listed` attestation, and stores each customer-supplied logo asset
keyed to its `targetSurfaceKey` with a `sourceRegionHash` —
`separationContract: "designpro.deterministic-stored-overlay.v1"`. That is the
approved model for Call 10 and stays as it is; Call 11 does its own logo
location on the duplicates, per owner decision 1.

No session may renumber the calls or add a de-logo producer on its own reading
of this table.

## The operating invariant

For each surface the system must produce, and show:

1. an approved side proof
2. a matched print panel
3. a composed 2D proof sheet
4. all six side outputs visible in the UI

If it cannot do that, it is not matching the existing product. Everything else
is secondary to this.

## Implementation rule

Recover and wire the proven behavior from the prior repo/runtime path that
produced this output. **Port the smallest working logic necessary. Do not
invent a new manufacturing architecture.** Per-stage references:
`docs/RESTYLEPRO-REFERENCE-RULE.md`.

## Acceptance criteria

A real run must produce:

- one visible 2D Production Proof
- six per-side cards
- each card containing the approved side proof **and** its matched print panel
- correct GENIE dimensions
- correct 5" bleed
- no cross-side contamination
- no missing panels
- no independent manufacturing art path

## Measured starting position (2026-08-17)

The UI half of this spec is a **wiring gap, not a build gap.**

`app/src/pages/AdminGeminiCompareStudio.tsx` is already in this repository and
is effectively identical to the RestylePro original — 3,766 lines, differing in
**four comment lines** where "RestylePro" was renamed to "DesignProAI". It
already contains the paired card, `Pull panel`, `Upload panel` / `Add version`,
`Approve side`, and the 6/6 counter.

**It has no route.** RestylePro serves it at `src/App.tsx:618`:

```
<Route path="/admin/studio-board" element={<RequireAdmin><AdminGeminiCompareStudio /></RequireAdmin>} />
```

`app/src/App.tsx` defines 51 routes and `/admin/studio-board` is not among
them, so the surface in the screenshots is currently unreachable in the
standalone app. That is the first thing to check before anyone concludes the
six-card behavior needs building.

The six sides are already frozen correctly in the runtime —
`runtime/gemini-flat-surface.cjs:19`:

```js
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
```

So the surface identity contract agrees with the spec. The work is binding the
panel producer to each side and putting the board back on a route — not
re-deriving what a side is.

## Session split — keep these clean, do not let them bleed

| | Owns | Does not touch |
|---|---|---|
| **Session A — manufacturing** | 2D proof · per-side proof/panel binding · Pull panel · GENIE dims and bleed · the six-card UI | generation quality, design composition |
| **Session B — generation** | missing edge functions · generation quality · `angles.ts` · `lighting.ts` · persona/brain · richer design composition | the manufacturing path above |

Both sessions still follow `CLAUDE.md` Rule 1: recover the proven RestylePro
implementation before creating anything new.

**The boundary between them is frozen.** The approved per-side artifact
contract is exactly where parallel work can create a new incompatibility, so
neither session may change its shape, naming, identity, storage contract or
semantics — including "helpfully," to make the other side's job easier. If
either concludes it must change, stop and report to the owner rather than
coordinating a silent change. See `docs/SEAM-FREEZE.md`.
