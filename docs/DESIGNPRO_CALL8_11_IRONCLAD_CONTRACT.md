# DesignProAI Calls 8–11 — Iron-Clad Output Contract

Status: FROZEN PRODUCT CONTRACT

This document is not an architecture proposal. It records the required behavior of the existing DesignPro production-output chain and the invariants that code and tests must enforce.

## Core product truth

The **flattened 2D Production Proof is the authoritative manufacturing source for Call 9**.

That is the product behavior that previously worked approximately 85–90% of the time and must be made deterministic and fail-closed.

The six production panels are not independently invented, redrawn, promoted from unrelated per-side renders, or guessed from aliases. Call 9 deterministically extracts each named side from the exact corresponding region of the approved Call 8 flattened 2D Production Proof.

## Scope

Calls 1–7 are upstream creative generation. They feed the approved design state into Call 8.

This contract governs:

- Call 8 — authoritative flattened 2D Production Proof
- Call 9 — deterministic six-side extraction from that proof
- Call 10 — exact duplication/save of the six branded Call 9 panels
- Call 11 — de-logo/de-letter processing of the duplicate set only
- RevisionStudioIQ / Production Layers consumption
- PanelProStudio QC consumption

## Non-negotiable sequence

```text
Calls 1–7 approved design views
        ↓
Call 8 — FLATTENED 2D PRODUCTION PROOF
        ↓
Call 9 — deterministic extraction of SIX BRANDED production panels FROM THAT PROOF
        ↓
Call 10 — save + exact duplicate of all six branded panels
        ↓
Call 11 — de-logo/de-letter ONLY the duplicated set
        ↓
RevisionStudioIQ / Production Layers
        ↓
PanelProStudio QC
```

No stage may skip ahead, mutate an earlier authoritative artifact, substitute a side, or substitute a different producer.

# 1. Call 8 — Flattened 2D Production Proof

Call 8 creates exactly one authoritative customer-facing **flattened 2D Production Proof** for the approved revision.

This proof is not decorative. It is the **single manufacturing source sheet** from which Call 9 extracts the six production panels.

The proof must contain six named, machine-addressable regions:

- driver
- passenger
- hood
- roof
- front
- rear

The proof must carry:

- the approved design
- all six flattened vehicle elevations/surfaces
- exact named region coordinates for each surface
- GENIE trim dimensions
- +5 inch bleed/print dimensions
- total square footage
- revision identity
- approval presentation

The customer proof artifact must be identified by exact semantic role:

```text
kind = flat-proof
metadata.role = customer-2d-production-proof
```

It must never be selected by:

- missing surfaceKey
- first flat-proof
- array order
- flat-wrap-layout
- best available artifact

## Call 8 side-region contract

The proof must contain exactly one region for each canonical surface:

```text
driver
passenger
hood
roof
front
rear
```

Every region must carry:

```text
surface_key
x
y
width
height
sheet_width
sheet_height
proof_content_hash
region_content_hash
revision_id
dimension_manifest_id
GENIE dimensions
```

No region may overlap another region in a way that makes side identity ambiguous.

No surface may be inferred from appearance, array position, fuzzy aliasing, or another side.

# 2. Call 9 — Deterministic extraction FROM the approved 2D proof

Call 9 produces exactly six authoritative branded production panels.

**The approved Call 8 flattened proof raster is the pixel source.**

The source rule is frozen. The wire literal is the one
`complete_designpro_stage` validates on the Call 9 receipt
(`supabase/migrations/20260806180100_designpro_workflow_rpcs.sql`), so it may
not be renamed without a migration:

```text
one-own-surface-region-per-output-side
```

Read it as *one exact proof region per output side* — the "own surface region"
is the side's own named region on the approved Call 8 proof raster, never a
region of another side and never a re-render.

The extraction map is literal:

```text
driver proof region    → driver production panel
passenger proof region → passenger production panel
hood proof region      → hood production panel
roof proof region      → roof production panel
front proof region     → front production panel
rear proof region      → rear production panel
```

Call 9 must:

1. download and hash-verify the exact approved Call 8 proof;
2. resolve the exact named region for the requested canonical `surface_key`;
3. deterministically crop/extract only that rectangle from the proof;
4. deterministically size the extracted side to its matching GENIE production geometry;
5. add the required +5 inch bleed using deterministic pixel operations only;
6. save the resulting branded panel under the same canonical `surface_key`;
7. record the source proof hash and source region hash on the panel artifact.

Once Call 8 is complete, Call 9 performs **zero generative/model pixel authoring**.

Forbidden:

- DRIVER fallback for another side
- passenger derived from driver
- fuzzy side aliases at the manufacturing boundary
- first-match region selection
- neighboring proof tile
- shared generic rectangle
- AI redraw/recreation
- per-side independent re-render as Call 9 source
- best-looking source selection
- silent fallback when a named proof region is missing

If the exact named proof region does not exist or fails hash/geometry validation, that side fails closed. It is never replaced with DRIVER or any other side.

Each Call 9 panel must preserve:

```text
surface_key
revision_id
proof_content_hash
proof_region coordinates
proof_region_hash
GENIE trim dimensions
+5 inch bleed contract
```

Call 9 branded artifacts are authoritative production artwork and immutable after creation.

Expected artifact set:

```text
6 × kind = panel
surface_key ∈ {driver, passenger, hood, roof, front, rear}
```

All six surface keys must be present exactly once.

# 3. Call 10 — SAVE, THEN EXACT DUPLICATION

Call 10 does not edit artwork.

The six Call 9 branded panels must already be completely saved before Call 10 begins.

Precondition:

```text
exactly 6 authoritative Call 9 branded panels exist and are hash-verified
```

Call 10 creates one independent working duplicate of each branded Call 9 panel.

Before any Call 11 operation:

```text
duplicate bytes == source Call 9 bytes
duplicate content hash == source Call 9 content hash
duplicate surface_key == source Call 9 surface_key
duplicate revision == source Call 9 revision
```

The duplicate has its own artifact identity/storage path even though its initial bytes are identical.

Call 10 must never overwrite, relabel, clean, erase, or mutate the Call 9 panel.

# 4. Call 11 — De-logo / de-letter DUPLICATES ONLY

Call 11 may consume only the six Call 10 working duplicates.

It must never edit, overwrite, replace, or re-save a Call 9 branded panel as a clean panel.

Required outputs per side:

```text
1 clean/de-logoed duplicate panel
0..N separated logo/text assets
```

The clean/de-logoed artifact is not authoritative production artwork. It is a QC/editing instrument for PanelPro and Production Layers.

```text
Call 9 branded panel  → remains branded and unchanged forever
Call 10 duplicate     → exact working copy
Call 11 qc-panel      → de-logoed/de-lettered derivative
Call 11 logo assets   → separated branding elements
```

Before Call 11 completes, the system must re-read/re-hash the original six Call 9 branded panels and prove they remain byte-identical to their Call 9 receipt.

A mismatch fails closed with invariant errors such as:

```text
call11_branded_receipt_mismatch
call11_branded_panel_mutated
```

Call 11 must never write `kind = panel`.

Clean duplicates use a distinct non-authoritative artifact kind:

```text
kind = qc-panel
authoritative = false
printable = false
```

# 5. Hard stage gates

Invalid ordering must be impossible.

```text
Call 9 cannot complete unless Call 8 exists, hashes correctly, and contains all six exact named regions.

Call 10 cannot begin unless exactly six distinct branded Call 9 panels are saved and hash-verified.

Call 11 cannot begin unless six exact Call 10 duplicate working copies exist.

PanelPro cannot treat Call 11 qc-panels as authoritative production panels.
```

Mandatory responsibility order:

```text
proof.build
→ panels.build
→ duplicate/save stage
→ panels.delogo
→ PanelPro preflight
```

Naming may differ internally, but responsibilities and ordering may not.

# 6. RevisionStudioIQ / Production Layers contract

RevisionStudioIQ is not retired.

It consumes/displays:

- authoritative Call 8 flattened 2D Production Proof
- six branded Call 9 panels extracted from that proof
- matching approved 3D render per side
- six Call 11 clean/de-logoed duplicates
- separated Call 11 logo/text assets

No stale-revision mixing is permitted.

After a revision, Call 8 must be rebuilt for the new approved design and Calls 9–11 must be regenerated from that new proof before the UI presents the production set as current.

# 7. PanelProStudio contract

PanelProStudio is a consumer/QC workspace, not a production-panel producer.

It may consume:

- Call 9 branded panels
- Call 11 qc-panels
- separated logo/text assets
- matching approved 3D views
- GENIE/template/dimension metadata

It must not invoke a second image producer to manufacture replacement production panels.

# 8. Print-size/output rule

The correct side artwork is established by deterministic Call 9 extraction before enlargement.

Upscale/output stages may increase resolution but may not alter:

- side identity
- artwork content
- GENIE geometry
- revision lineage
- Call 8 proof/region lineage

Final print-size output consumes the exact branded Call 9 panel for the matching `surface_key`.

Never route a different side into an upscale job because an expected artifact is missing.

# 9. Acceptance gate

No status flag or green test alone proves this feature.

A real run must physically demonstrate:

```text
1 correct flattened Call 8 2D Production Proof
6 exact named proof regions
6 distinct branded Call 9 panels deterministically extracted from those six regions
6 byte-identical Call 10 duplicates before cleaning
6 clean Call 11 qc-panels
separated logo/text assets where branding exists
```

For all six sides verify:

```text
correct proof region
correct surface_key
correct artwork
correct GENIE dimensions
correct revision
correct proof hash lineage
no driver-side substitution
```

After Call 11, re-open the six Call 9 originals and confirm they remain branded and unchanged.

Only then are Calls 8–11 PRODUCT-PROVEN.

# 10. Forbidden reinterpretations

Do not:

- redesign this architecture
- change Call 9 back to independent per-side master promotion
- treat the flattened 2D proof as display-only
- retire RevisionStudioIQ
- collapse branded and clean panels into one artifact
- remove the Call 10 duplication boundary
- let Call 11 mutate Call 9
- reintroduce driver-to-passenger or driver-to-any-side fallback
- create another panel producer
- use an image model to regenerate production panels after Call 8
- silently substitute a different proof region
- call anything fixed merely because code is merged or tests pass

The flattened Call 8 2D Production Proof and its six exact named regions are the manufacturing authority for Call 9.

This contract remains the implementation authority for Calls 8–11 until explicitly changed by the product owner.
