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
| Manufacturing | 9 | six correct per-side production panels |
| Manufacturing | 10 | duplicate of the exact extracted set |
| Manufacturing | 11 | logo/lettering separation + branded/clean panel state |
| Delivery | — | Order Production Pack → PanelProStudio/QC → Topaz upscale → output files → ZIP → WrapBox |

### Measured delta — the runtime does not match this numbering

Checked 2026-08-17 against `runtime/`. The receipt kinds the runtime actually
emits are, in full:

```
views.seven-source · call8.flat-proof · call9.surface-panels
call10.logo-inventory · call12.topaz-upscale
```

Against the contract above:

| Contract | Runtime | Status |
|---|---|---|
| 9 — six per-side panels | `call9.surface-panels` | agrees |
| 10 — duplicate the extracted set | *(nothing)* | **absent** |
| 11 — logo separation + branded/clean state | `call10.logo-inventory` | **different model, and renumbered** |
| 12 — upscale | `call12.topaz-upscale` | agrees |

Three substantive differences, not just a numbering slip:

1. **There is no Call 11 and no duplicate step.** The contract's Call 10
   (duplicate the exact extracted set) has no implementation, and logo work
   sits at 10 rather than 11.
2. **Logos are not separated — they are registered.** `logos.extract`
   (`designpro-standalone-claimant.cjs:576`) reads a frozen
   `expectedLogoInventory` from the revision snapshot, requires an explicit
   `none`/`listed` attestation, and stores each customer-supplied logo asset
   keyed to its `targetSurfaceKey` with a `sourceRegionHash` proving which
   panel region it targets — `separationContract:
   "designpro.deterministic-stored-overlay.v1"`. That is a stored overlay, not
   a pixel lift off the branded panel.
3. **No clean/blank panel state exists.** Nothing in `runtime/` produces a
   branded/clean pair — no `cleanMaster`, no `background_url` equivalent, no
   blank panel artifact of any kind.

Point 3 is the one with a downstream consequence. In RestylePro the blank
panels are load-bearing: the design team lays logo-free panels on vehicle
templates to validate sizing during human QC, and they are part of what the
PanelPro board receives. A manufacturing chain with no clean panel cannot serve
that step.

Point 2 is arguably the better model — a stored overlay is deterministic and
carries none of the smear risk that made RestylePro's lift path fragile — but
it is a different model, and whether it satisfies "logo/lettering separation +
branded/clean panel state" is the owner's call, not a session's.

**This is an owner decision, recorded not resolved.** Per `docs/SEAM-FREEZE.md`,
a session that concludes the contract or the runtime must change stops and
reports. No session may renumber the calls, invent a duplicate stage, or add a
clean-panel producer on its own reading of this table.

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
