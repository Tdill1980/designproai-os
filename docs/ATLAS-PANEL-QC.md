# A.T.L.A.S. PANEL QC — does a required element survive the cut?

**Contract:** `designpro.atlas-panel-qc.v1` · `runtime/atlas-panel-qc.cjs`
**Locked by:** `tests/atlas-panel-qc.test.mjs`, `supabase/tests/atlas_panel_qc_receipt.test.sql`

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
