# A.T.L.A.S. PANEL QC — does a required element survive the cut?

**Contracts:** `designpro.atlas-panel-qc.v1` · `runtime/atlas-panel-qc.cjs`
and `designpro.atlas-panel-repair.v1` · `runtime/atlas-panel-repair.cjs`
**Locked by:** `tests/atlas-panel-qc.test.mjs`, `tests/atlas-panel-repair.test.mjs`,
`app/src/components/designpro/SixPanelBoard.test.ts`,
`supabase/tests/atlas_panel_qc_receipt.test.sql`

---

## 1. What is actually broken

Nothing about Call 1. The v24 one-field prompt, the DPAG creative assembly, the
persona, the conditioning and the model pin are **unchanged, byte for byte**.
A.T.L.A.S. produced this sheet on generation `63e6629a-1e56-42e3-a129-456f97f0aea4`
(2022 Toyota Prius, master `10779204…`, 4096×4096), and it is good work: one
cohesive ice-and-yeti wrap, a mascot lockup on the driver band, an installer
photograph and a second lockup on the passenger band, one contact lockup across
the bottom band.

**The cut is what is broken.** v24 asks the model to compose in three equal
horizontal thirds and the model obeyed exactly. The runtime then takes **six
unequal territories**, and the bottom third alone is crossed by three boundaries
the model was never shown:

| boundary | master px | splits |
|---|---|---|
| vertical | `x = 1071` | roof \| hood |
| vertical | `x = 2198` | hood \| front, hood \| rear |
| horizontal | `y = 3335` | front \| rear |

The bottom band carries ONE contact lockup — an `ARCTIC AIR` badge at
`x 985..1240` followed by a `Www.ArcticAir.com` banner at `x 1250..3080`, both
spanning `y 3240..3560`. All three boundaries run through it. The delivered
panels show precisely that:

| surface | what it got |
|---|---|
| driver | the full yeti lockup — **clean** |
| passenger | the installer photograph and the wordmark — **clean** |
| roof | a sliver of the badge, severed at its right edge |
| hood | the rest of the badge, then `Www.Arct`, severed at its right edge |
| front | the top sliver of the banner, severed at left and bottom |
| rear | `ticAir.com`, severed at left and clipped at top |

**The two flanks survived because, and only because, `driver` and `passenger`
map 1:1 onto a third.**

## 2. Why nothing caught it

Every existing gate measures the **sheet**: container coverage, opacity,
`opaqueRatio`, `edgeOpaqueRatio`, `edgeHoleRatio`, `concentratedFlatBlackRatio`,
cross-surface template leakage, and the RULE 0.30 output class. All of them
passed, and all of them were right to — the sheet is cohesive, opaque,
anatomy-free and full-bleed. **None of them asks whether a wordmark straddles a
cut line.**

`Print panels 6/6` then reported six files, which is true and useless.

## 3. Why this is not a pixel heuristic — and what was tried

A wrap panel is full-bleed **by contract** (RULE 0.15, RULE 0.28 §3): artwork
MUST run off all four edges or the edge prints white. So "ink at the panel edge"
is the normal, required state, and cannot be the test.

Three pixel statistics were built and measured against the six real panels
before this approach was chosen. All three failed, and the way they failed is
the reason the containment method exists:

| attempt | result |
|---|---|
| sharp-gradient density in the outer edge band, against the panel interior | convicted hood and front on their **top** edges, where the sharpest transition in the image is; scored the rear panel **clean** while `ticAir.com` was visibly severed |
| the same, restricted to pixels far from the panel's median luminance, worst 6% window per edge | separated the six panels correctly **only for one choice of median**. Sampling the panel's top 200k pixels gives rear a median of 169 and convicts it at 0.181; sampling the whole panel gives 82 and clears it at 0.086. The verdict moved with an arbitrary baseline. |
| connected sharp components touching the border | driver and passenger score zero contacts, which is right — but front's ice shards bleeding off its top edge score `T26`/`T28`, which is legitimate full bleed reported as a defect |

The measurements are kept because they are the argument: **ice bleeding off the
front panel's top edge and `ticAir.com` severed on the rear panel's left edge
are the same measurement to every edge statistic tried.** Tuning a threshold
between them is choosing which panel to be wrong about.

## 4. What it does instead

Ask the question that is actually being asked, once, on the master:

1. **Locate the required elements on the accepted master.** One call. Reuses the
   Call 11 detector already ported from RestylePro (`runtime/logo-removal.cjs`:
   `strictGeminiBox2d`, `collapseContainedLogoElements`) with its
   **re-ask, never guess, never drop** contract. RULE 1: recover before you
   invent. The prompt is deliberately WIDER than Call 11's — Call 11 narrows to
   logo marks because it is choosing what to **erase**; here nothing is erased,
   so an extra box costs one containment test while a missing box costs a
   severed phone number reaching print.
2. **Test containment with integer arithmetic** against the manifest's own
   `zones`. Three outcomes, no thresholds to tune:

   | status | meaning |
   |---|---|
   | `contained` | the box sits inside one zone's **trim**. It prints whole. |
   | `in_bleed` | the box sits inside one zone's **container** but reaches past its trim. The installer's trim cut takes a bite out of it. |
   | `severed` | the box crosses a **container** boundary, so the cut has already split it across two or more panels — or it lands where no zone covers the sheet, and no panel carries it at all. |

3. **Two provider-free geometry checks per panel.** The panel's pixel aspect
   must match its zone **container**; the container's aspect must match the
   surface's trim inches **plus the 5″ bleed on all four sides**. Comparing a
   container to bare trim inches convicts every correct panel, which is what a
   first cut of this check did to all six Arctic Air surfaces.

The only tuned number is `BOX_SLOP_RATIO` (4% of the box's shorter side, floor
6 px), which absorbs localization slop — the ported detector's own call site
dilates by 3% for glows and outlines. A real severance takes a visible bite: the
rear panel lost roughly a third of `Www.ArcticAir.com`.

## 5. The verdict on the real run

Run against `63e6629a`'s own master, its own six panel files and its own
manifest geometry (`runtime/atlas-panel-qc.cjs` → `inspectAtlasPanels`):

```
ELEMENT CONTAINMENT
  CONTAINED  yeti shield lockup                px(688,332 2601x667)    prints whole on driver
  CONTAINED  installer photograph              px(504,1577 2359x946)   prints whole on passenger
  CONTAINED  arctic air wordmark               px(2351,1602 1229x696)  prints whole on passenger
  SEVERED    arctic air badge                  px(983,3240 258x319)    cut across 2 surfaces (roof, hood)
  SEVERED    www.arcticair.com contact banner  px(1249,3256 1831x299)  cut across 3 surfaces (hood, front, rear)

PER-SURFACE VERDICT
  DRIVER     PASS   4096x1221 landscape   intact=[yeti shield lockup]
  PASSENGER  PASS   4096x1221 landscape   intact=[installer photograph, arctic air wordmark]
  ROOF       FAIL   1071x1207 portrait    severed=[arctic air badge]                              cut at right
  HOOD       FAIL   1127x828  landscape   severed=[arctic air badge, contact banner]              cut at left, cut at right
  FRONT      FAIL   1898x605  landscape   severed=[contact banner]                                cut at left+bottom
  REAR       FAIL   1127x590  landscape   severed=[contact banner]                                cut at left+top

FAILING: roof, hood, front, rear
PASSING: driver, passenger
```

Every named edge matches what the corresponding panel file shows.

## 6. What it must never do

- **It never redesigns.** Nothing in `atlas-panel-qc.cjs` writes a pixel or asks
  a model to author anything, and `tests/atlas-panel-qc.test.mjs` asserts the
  locate prompt contains no authoring verb. WHICH surfaces fail is the whole
  output, because a repair that touches a passing panel is a redesign nobody
  asked for.
- **It never touches Call 1.** The v24 prompt, the creative assembly, the region
  arrangement and the model's own branding are preserved byte for byte.
- **A locator outage fails OPEN with a durable receipt.** Same shape RULE 0.30
  fixed for the output-class gate: an outage must not brick a generation.
  `elementsLocated` is `null`, `locateUnavailable` carries the reason, and no
  surface is reported as passing — **"we could not look" must never read as "we
  looked and it was fine."**

## 7. Element boxes in the fixture

`tests/atlas-panel-qc.test.mjs` supplies the Arctic Air element boxes directly
rather than calling a provider, so the containment half is provable in CI. Those
boxes are **measured off the master's own pixels** — see §1 — not estimated. The
localization half is the already-proven ported detector, exercised by its own
tests here and by Call 11's in `source-tests/runtime/logo-removal.test.mjs`.

---

## 8. The repair — move Gemini's own pixels, never redraw them

The obvious repair is to ask an image model to re-author the failing surface.
The owner ruled that out, and it is wrong twice over: it would **redraw** the
branding rather than preserve it, and it would give the system a second design
producer — the exact thing RULE 0.30 and
`tests/atlas-sole-design-authority.test.mjs` exist to prevent.

So `runtime/atlas-panel-repair.cjs` moves the element instead. Its pixels are
still on the master, intact, because **the master was never the problem — the
cut was.** Three deterministic steps, no provider, ~3.5 s on a 4096 sheet:

1. **LIFT** the element's exact pixels out of the accepted master.
2. **HEAL** the rectangle it came from with `diffuseInto` — the same
   boundary-averaging the cut-out fill already uses, promoted from `_test` to a
   shared export. It grows the surrounding design inward from every side and
   invents nothing (RULE 0.15).
3. **PLACE** it, scaled to fit and never enlarged, wholly inside one surface's
   trim box with a 2″ installer tolerance held clear — in vehicle inches, so the
   tolerance is 2″ on the vehicle whatever a surface's pixel density is.

**Which surface it lands on is the owner's surface-content contract
(`designpro.atlas-surface-content.v1`), not a heuristic.** An earlier cut sent
the element to "whichever surface already holds most of it"; the owner rejected
that by name (2026-09-05) — on Arctic Air it put the website on the hood and
left the rear bare. The contract that replaces it:

| | |
|---|---|
| driver, passenger | never a relocation target by default; byte-identical when valid |
| explicit customer placement | always wins (`placements: { kind or label: surface }` on the request; the v3 input carries no structured field yet, so today the defaults apply) |
| default **rear** | website / contact information — and the badge beside a contact bar rides with it |
| default **hood** | complete logo / mascot / wordmark, or uninterrupted artwork |
| default **roof, front** | continuous artwork unless requested otherwise |
| any other kind (photograph, focal subject, tagline) | **no default — refused** unless the customer said where it goes |
| does not fit its assigned panel-safe area at ≥ 3″ | **the master is refused** (`flat_atlas_required_element_unplaceable`) — never shrunk below legibility, never relocated elsewhere |

There is no fallback surface and no second choice.

**Elements that belong together move together.** The badge and the banner are
separately located and sit 8 px apart on one contact bar. Moving them
independently would re-space or re-order them, which IS a redesign. Adjacent
severed elements resolving to the same surface are merged into one rectangle and
moved as a unit, so their relative geometry survives exactly.

**An element that cannot print legibly anywhere is refused, never shrunk to
fit** (`MIN_ELEMENT_HEIGHT_IN` = 3″ on the vehicle).

### Where it sits, and how it fails

Immediately after the cut-out fill's re-validation and **before canonical
acceptance**, so QC, the panel cut, the projection, the seven proofs, Call 8 and
the ZIP all see one finished sheet and there is never a second master. The
accepted sheet is the last one that passed — the authored master, the hole-filled
one, or the one whose lockup was moved — and `preRepairMasterHash` records what
Gemini returned in every repaired case.

After a repair the sheet is **re-validated structurally** and the elements are
**re-located on the repaired bytes**, because the element has moved and the only
honest verification is to look again at where it actually is. A sheet whose
lettering is still cut raises `flat_atlas_panel_repair_unverified` and never
becomes canonical: **a repair that cannot be verified is not a repair.**

### Measured on Arctic Air `63e6629a`

```
BEFORE  failing: roof, hood, front, rear   passing: driver, passenger

REPAIR PLAN  (designpro.atlas-surface-content.v1)
  MOVE [arctic air badge + www.arcticair.com contact banner]   kind: contact   basis: default
       from px(983,3240 2097x319) + halo, across [hood, rear, front, roof]
       -> REAR px(2313,3548 897x164)   scale 0.4113   10.03" tall

AFTER   failing: none   passing: driver, passenger, roof, hood, front, rear
```

Fidelity is proved through the real cutter, not a crop: `cutCallOnePanels` over
the ORIGINAL master reproduces all six exported production panel hashes
(`0af8ddf2…`, `4d7c9f7a…`, `47abc2c5…`, `46ebd8ff…`, `8cf181a6…`, `cf46a716…`),
and over the REPAIRED master the driver and passenger panels come out with
**those same two hashes**. The first measured run lost the master's
`density: 300` and every panel hash moved on identical pixels; the repaired
sheet now carries it.

### How the vacated band is healed, and what it took

The lockup sat on the design's own repeating gear-and-snowflake band. Three
fills were measured on the real bytes:

| fill | result on the hood |
|---|---|
| boundary averaging (`diffuseInto`) alone | vertical streaks, dark wedges in from the corners at 45°, and it healed DARK from the unpainted sheet just below the hood container |
| the same, sampling artwork only | streaks and wedges remain — inherent to a frontier walking in from the two short ends of a long thin rectangle |
| **row-wise mirrored continuation** (each vacated row filled from its own settled neighbours, left and right, reflection folded so a run wider than its neighbour still has a source, crossfaded through the middle; artwork only; diffusion only for a pixel with no source) | a continuous band. A soft horizontal seam remains at the top of the healed area where the plate's glow met the band; the lift carries a 15% halo for exactly that and 8% was not enough |

This is the reflection RULE 0.15 already uses for the 5″ bleed, applied across
a rectangle with straight edges. Nothing outside a zone is painted by a single
byte — asserted.

### The honest caveat

The repair is a safety net, not the root fix. The root fix is upstream: v24 asks
the model to compose in **three** fields while the runtime cuts **six** unequal
territories, and the bottom third is where that mismatch lives. Driver and
passenger are clean precisely because there the field IS the surface. Changing
the field layout is a creative variable RULE 0.33 says must be measured on a
real product generation, not assumed — and it is not part of this change.
