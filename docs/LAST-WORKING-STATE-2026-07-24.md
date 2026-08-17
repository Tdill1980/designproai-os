# Last working state — RestylePro, 24 Jul – 1 Aug 2026

Observed baseline, captured from owner screenshots of the running RestylePro
system before migration. This is the acceptance target for the post-approval
half: what the standalone system has to reproduce.

It is a target for **structure and provenance**, not a pixel target, and two
defects are visible in the same frames. Those are recorded at the bottom so
they are not ported as features.

## Surface 1 — Studio Board, per-side card

`/admin/studio-board?order=RP-101032` · source
`src/pages/AdminGeminiCompareStudio.tsx` (3,766 lines).

Every side is one card holding **two artifacts side by side**:

| Slot | What it is |
|---|---|
| **REAL DESIGN PROOF** | the approved on-vehicle render for that side |
| **PRINT PANEL** | the flat, full-bleed artwork rectangle — no vehicle, no white space |

Plus a status chip (`Pending`), a GENIE dimension chip on the card header
(`56"×72"`, tagged `build-assets`), and the action row: **Pull panel** ·
**Upload panel** / **Add version** · **Compare** · **Edit** · **Flip** ·
**Download** · **Delete** · **Approve side**. Approvals count to 6/6
(`AdminGeminiCompareStudio.tsx:67`).

The pairing is the point. A side is legible because the flat panel sits next to
the render it came from, so a wrong panel is visible at a glance rather than
discovered at print. **Reproduce the pair, not just the panel.**

When a side has no panel yet, the PRINT PANEL slot reads `Not uploaded` — an
explicit empty slot, never a placeholder image and never a silent fallback.

## Surface 2 — RevisionStudio Production Layers

`src/components/revisioniq/ProductionFlowLayersCard.tsx`.

Per-side rows, each a **pair with its own Save**:

> `Print-ready panel` | `Your approved design`
> *"The panel is the print-ready base; your branding prints on top (shown in
> the approved design)."*

Each row is versioned and dimension-stamped in the header — `HOOD v1 · 71.5" ×
56"`, `REAR v1 · 76" × 54"`, `ROOF v1 · 74.3" × 54.8"`.

The footer disclosure is exact, and it is the pre-order honesty contract
(`ProductionFlowLayersCard.tsx:1206`):

> **Working-resolution previews.** These panels show the exact design,
> dimensions and layout for approval. When you purchase the Production Pack,
> every panel is processed to **full print resolution** and the complete pack
> is saved to **WrapBox** to download — track processing on the **GENIE
> Universal Panelizer** page.

## Surface 3 — the 2D Production Proof sheet

Header line, verbatim shape:

> **DesignProAI™ — 2D Production Proof**
> Vehicle: `2022 ford f250 crew cab` | Design: `"Precision Climate Solutions"`
> | Finish: `Gloss` | Coverage: `208.7 sq ft`

Six labelled orthographic views on one white sheet, each with drawn dimension
callouts: Driver Side View, Roof View, Passenger Side View, Front View, Rear
View, and the hood.

## GENIE dimensions — measured, and stable across designs

The two jobs in these captures are different designs on the same vehicle class
(2022 F250 crew cab): **Flamingo Pools** and **Precision Climate Solutions**.
Their dimensions agree exactly.

| Side | Dimensions |
|---|---|
| Driver / passenger | 153" × 56" |
| Hood | 71.5" × 56" |
| Rear | 76" × 54" |
| Roof | 74.3" × 54.8" |
| Front | 56" wide (height not legible in the capture) |

That agreement is the property to preserve: **GENIE resolves from the vehicle,
not from the design**, and the same numbers appear on the proof sheet and on
the panel rows because both read the same `panelizer-step-validate` result. If
the standalone system produces per-design drift here, the geometry is wired
wrong.

## Two defects visible in these same captures — do not port

**1. Passenger panel printed backwards.** The Flamingo Pools passenger PRINT
PANEL shows `Flamingo Pools` reversed, produced by a **`Mirror from driver`**
button on the passenger card. That button no longer exists anywhere in the
RestylePro tree, and the current source states the opposite rule at
`AdminGeminiCompareStudio.tsx:65`:

> *"A side with no source stays a recorded gap — the passenger is never
> mirrored from the driver, which would print all lettering backwards."*

So these captures predate the fix. This is the same finding already recorded in
`docs/CALLS-1-7-PORT-SCOPE.md`, now confirmed from the running system: the
mirror is a defect, the honest gap is the correct behaviour, and passenger
acceptance is semantic — readable branding and text orientation — never a hash
or a flip. (The removal commit could not be dated: the reference checkout is
shallow at 50 commits, so `git log -S` finds nothing.)

**2. The proof sheet failed and reported it.** The same frame carries
`Generation Failed — Edge Function returned a non-2xx status code`, and the
driver-side view in that sheet has a garbled text artifact overlaying the
vehicle. The failure surfacing loudly is correct behaviour and worth
reproducing; the artifact is the shared-sheet lettering problem that
`generate-2d-proof/proof-sheet.ts` later addressed with per-tile rendering
(`renderFlatTile`) and the literal text lock (`buildProofTextLock`).

**Port the later fixes, not the state in the photograph.** These captures are
evidence of the working shape — the paired card, the versioned dimensioned
rows, the honest empty slot, the stable GENIE geometry, the loud failure. They
are not a commit to restore.
