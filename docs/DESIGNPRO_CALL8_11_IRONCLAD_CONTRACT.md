# DesignProAI Calls 8–11 — Iron-Clad Output Contract

Status: FROZEN PRODUCT CONTRACT

This document is not an architecture proposal. It records the required behavior of the existing DesignPro production-output chain and the invariants that code and tests must enforce.

## Scope

Calls 1–7 are upstream creative generation and are outside this contract except where their approved artifacts become immutable inputs to Call 8.

This contract governs:

- Call 8 — customer 2D Production Proof
- Call 9 — six branded production panels
- Call 10 — exact duplication of the six branded panels
- Call 11 — de-logo/de-letter processing of the duplicate set only
- RevisionStudioIQ / Production Layers consumption
- PanelProStudio QC consumption

## Non-negotiable sequence

```text
Calls 1–7 approved design state
        ↓
Call 8 — authoritative customer 2D Production Proof
        ↓
Call 9 — six BRANDED production panels
        ↓
Call 10 — six exact duplicate working copies
        ↓
Call 11 — de-logo/de-letter ONLY the duplicates
        ↓
RevisionStudioIQ / Production Layers
        ↓
PanelProStudio QC
```

No stage may skip ahead, mutate an earlier authoritative artifact, or substitute a different producer.

# 1. Call 8 — 2D Production Proof

Call 8 creates exactly one authoritative customer-facing 2D Production Proof for the approved revision.

The proof must contain the six named vehicle surfaces: driver, passenger, hood, roof, front, rear.

The proof must carry the approved design, GENIE dimensions, trim dimensions, +5 inch bleed/print dimensions, total square footage, and approval presentation.

The customer proof artifact must be identified by exact semantic role:

```text
kind = flat-proof
metadata.role = customer-2d-production-proof
```

It must never be selected by missing surfaceKey, first flat-proof, array order, flat-wrap-layout, or best-available selection.

Each named proof region binds to the corresponding approved full-resolution per-side production source:

```text
driver proof region    ↔ driver source
passenger proof region ↔ passenger source
hood proof region      ↔ hood source
roof proof region      ↔ roof source
front proof region     ↔ front source
rear proof region      ↔ rear source
```

For every side the binding includes surface_key, proof_region, proof_region_hash, approved_source_hash, GENIE dimensions, and revision identity.

The proof is approval/display identity. The manufacturing pixel source remains the matching full-resolution approved per-side source. Do not manufacture by cropping arbitrary pixels back out of the vehicle-shaped proof raster.

# 2. Call 9 — Branded production panels

Call 9 produces exactly six authoritative branded production panels.

The source rule is frozen:

```text
one-own-surface-region-per-output-side
```

```text
driver    → driver source only
passenger → passenger source only
hood      → hood source only
roof      → roof source only
front     → front source only
rear      → rear source only
```

Forbidden: DRIVER fallback for another side; passenger derived from driver; fuzzy side aliases at the manufacturing boundary; first-match artifact selection; neighboring proof tile; shared atlas rectangle; AI redraw/recreation; a new panel producer; crop of the customer proof raster as manufacturing source.

Each Call 9 panel preserves surface_key, revision, proof-region identity, source content hash, GENIE dimensions, and the +5 inch bleed contract.

Call 9 branded artifacts are authoritative production artwork and immutable after creation.

Expected artifact set:

```text
6 × kind = panel
surface_key ∈ {driver, passenger, hood, roof, front, rear}
```

All six surface keys must be present exactly once.

# 3. Call 10 — Exact duplication

Call 10 does not edit artwork. It creates one independent working duplicate of each Call 9 branded panel.

Precondition:

```text
exactly 6 authoritative Call 9 branded panels exist
```

For every Call 10 duplicate, before any Call 11 operation:

```text
duplicate bytes == source Call 9 bytes
duplicate content hash == source Call 9 content hash
duplicate surface_key == source Call 9 surface_key
duplicate revision == source Call 9 revision
```

The duplicate has its own artifact identity/storage path even though its initial bytes are identical. Call 10 never overwrites or relabels the Call 9 panel.

# 4. Call 11 — De-logo / de-letter duplicates only

Call 11 may consume only the six Call 10 working duplicates. It must never edit, overwrite, replace, or re-save a Call 9 branded panel as a clean panel.

Required outputs per side:

```text
1 clean/de-logoed duplicate panel
0..N separated logo/text assets
```

The clean/de-logoed artifact is not authoritative production artwork. It is a QC/editing instrument for PanelPro and Production Layers.

```text
Call 9 branded panel  → remains unchanged forever
Call 10 duplicate     → working copy
Call 11 qc-panel      → de-logoed/de-lettered copy
Call 11 logo assets   → separated branding elements
```

Before Call 11 completes, the system re-reads/re-hashes the original six Call 9 branded panels and proves they remain byte-identical to their Call 9 receipt.

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

The orchestration makes invalid ordering impossible.

```text
Call 9 cannot complete unless Call 8 is complete and the six side bindings are valid.
Call 10 cannot begin unless exactly six distinct Call 9 branded panels exist.
Call 11 cannot begin unless exactly six Call 10 duplicate working copies exist.
PanelPro cannot treat Call 11 qc-panels as authoritative production panels.
```

Mandatory responsibility order:

```text
proof.build
→ panels.build
→ duplicate/inventory stage
→ panels.delogo
→ PanelPro preflight
```

Naming may differ internally, but responsibilities and ordering may not.

# 6. RevisionStudioIQ / Production Layers contract

RevisionStudioIQ is not retired.

It consumes/displays the authoritative Call 8 customer 2D Production Proof, six branded Call 9 panels, matching approved 3D render per side, six Call 11 clean/de-logoed duplicates, and separated Call 11 logo/text assets.

No stale-revision mixing is permitted. After a revision, Calls 8–11 must be regenerated/rebound to that revision before the UI presents the production set as current.

# 7. PanelProStudio contract

PanelProStudio is a consumer/QC workspace, not a production-panel producer.

It may consume Call 9 branded panels, Call 11 qc-panels, separated logo/text assets, matching approved 3D views, and GENIE/template/dimension metadata.

It must not invoke a second image producer to manufacture replacement production panels.

# 8. Print-size/output rule

The correctness of the production panel is established before enlargement.

Upscale/output stages may increase resolution but may not alter side identity, artwork content, surface dimensions/aspect contract, or revision lineage.

Final print-size output consumes the exact branded production panel for the matching surface_key. Never route a different side into an upscale job merely because a preferred artifact is missing.

# 9. Acceptance gate

No status flag or green test alone proves this feature.

A real run must physically demonstrate:

```text
1 correct customer 2D Production Proof
6 distinct branded Call 9 panels
6 byte-identical Call 10 duplicates before cleaning
6 clean Call 11 qc-panels
separated logo/text assets where branding exists
```

For all six sides verify correct side, correct artwork, correct GENIE dimensions, correct revision, correct source-hash lineage, and no driver-side substitution.

After Call 11, re-open the six Call 9 originals and confirm they remain branded and unchanged.

Only then are Calls 8–11 PRODUCT-PROVEN.

# 10. Forbidden reinterpretations

Do not redesign this architecture; retire RevisionStudioIQ; collapse branded and clean panels into one artifact; remove the duplication boundary; let Call 11 mutate Call 9; reintroduce driver-to-passenger or driver-to-any-side fallback; create another panel producer; use an image model to regenerate production panels after the approved design state; use a customer proof screenshot/raster as an arbitrary manufacturing crop source; or call something fixed merely because code is merged or tests pass.

This contract is the implementation authority for Calls 8–11 until explicitly changed by the product owner.
