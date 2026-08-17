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
