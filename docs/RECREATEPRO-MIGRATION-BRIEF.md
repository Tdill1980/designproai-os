# RECREATEPRO — MIGRATION BRIEF

**For a dedicated session. Branch: `claude/recreatepro-migration`.**
Do NOT use `claude/atlas-design-ui-fixes-0en7k6` — another session holds it.

Owner-directed 2026-09-16: *"I need to make sure that recreatepro is still
working and its migrated to os.designpro and wired to file output system asap
i need to film a demo."*

**Read before writing code:** `CLAUDE.md` RULE 1 (RestylePro is the reference
implementation — recover, do not invent) and `docs/GRAPHICSPRO-END-TO-END.md`,
which is the proven template for exactly this kind of migration. Follow its
shape: recovered edge functions, deliberate inline deltas, a named lock.

---

## 1. WHERE RECREATEPRO ACTUALLY LIVES (verified, `restylepro-os`)

**It is not a page.** It is an inline panel inside
`src/pages/ProductionFlow.tsx`, state beginning around line 789:
`recreateExpanded`, `recreateFiles`, `recreatePreviews`, `recreateStoredUrls`,
`recreateYear` / `recreateMake` / `recreateModel`, `recreateVehicleType`,
`recreateFinish` (Gloss | Satin | Matte, with auto-detect from the notes text),
`recreateNotes`, `recreateRendering`, `recreateRenderUrl`, `recreateProgress`,
`recreateStage`.

Flow: **customer photos + year/make/model + finish + notes → render.**

The single provider call is at `ProductionFlow.tsx:2171`,
`supabase.functions.invoke(recreateFn, { … })` — note `recreateFn` is a
variable, so resolve which function it actually holds before porting.

### Its edge functions, `restylepro-os/supabase/functions/`

| function | role |
|---|---|
| `recreatepro-analyze` | reads the customer's uploaded photos |
| `designpro-recreate-3d` | the render; calls `design-panel-ai-generate` internally |
| `recreatepro-flat-panels` | per-side flats derived from each approved 3D view |
| `recreatepro-build-print-files` | **RETIRED 2026-07-24 — DO NOT PORT** |

`recreatepro-build-print-files` was killed in RestylePro's own CLAUDE.md as *"a
second producer into the `panel_artboard_jobs` admin hub."* Porting it would
violate the one-sanctioned-chain rule here as well.

### Other callers worth reading first

`src/lib/buildProductionPanels.ts` · `src/pages/ArtboardFirstDesignPro.tsx` ·
`src/pages/AdminCarWrapPro.tsx` · `src/components/designpanelpro/ArtboardTestPanel.tsx`

---

## 2. WHAT designproai-os HAS TODAY: NONE OF IT

Verified: zero `recreate*` edge functions, zero app references. This is a full
port, not a repair.

---

## 3. THE ONE ARCHITECTURAL DECISION — MAKE IT BEFORE WRITING CODE

RestylePro derives flats **from approved 3D views**. designproai-os is
**flat-first**: Call 1 authors an A.T.L.A.S. master, the six panels are cut from
it deterministically, and the proofs are conditioned on those panels. That is
the opposite order, and it is the whole of the port's difficulty.

**(a) RecreatePro produces an A.T.L.A.S. master from the photos.**
The entire existing chain then runs unchanged — panel cut, seven proofs, Call 8,
Call 9 promotion, Call 11 de-logo, Topaz, ZIP, WrapBox. **Strongly preferred:
nothing downstream changes, and nothing on the frozen seam moves.**

**(b) RecreatePro produces six panels directly.**
Requires `source.verify` to accept a non-A.T.L.A.S. source. That is RULE 0.5
frozen-seam territory and an **owner-level decision** — stop and ask, do not
proceed on your own judgement.

Take (a) unless you can prove it impossible. State your choice and the evidence
for it before writing code.

---

## 4. "WIRED TO FILE OUTPUT" MEANS THE EXISTING CHAIN

```
pack.activate → await_purchase → manifest.resolve → source.verify
  → await_panelpro_preflight_qc → enhance.upscale (Topaz)
  → output.build → output.verify → await_final_human_qc
  → stamp.build → zip.build → wrapbox.deliver
```

Do not build a parallel path — RULE 0.17 exists because A.T.L.A.S. was once
excluded from this chain and became a dead end by construction.

**Status of that chain as of 2026-09-16** (canary `35124251343`, run on
`f048fba6`): every stage through `zip.build` **completed**, producing 4.91 GB
across 60 real files — six Topaz-upscaled masters (130–343 MB each), eighteen
production outputs as PNG + TIFF + EPS, seven stamped proof views, the QC
certificate and the approval seal. `wrapbox.deliver` failed on
`delivery_zip_copy_failed`: Supabase's server-side `copy()` against a ~5 GB ZIP.
The runtime already has the resumable path this needs (`uploadSpoolWithTus`,
used precisely because large objects exceed the standard route); the ZIP
delivery is not yet using it. **Assume WrapBox delivery is not yet proven.**

---

## 5. FOUR TRAPS THAT HAVE ALREADY COST THIS PROJECT TIME

1. **The canonical-id linkage is RecreatePro's known failure.** Its jobs carry a
   `color_visualizations` id, not a DesignIQ id, so its assets cannot be found.
   RestylePro's own fix is the `admin_notes.designiq_generation_id` back-link —
   *"the fix is the link, not a re-slice."* Do not re-slice.
2. **No second producer.** Anything that regenerates panels rather than
   consuming the ones already cut violates the one-sanctioned-chain rule
   (RULE 0.18, RULE 0.21). Neither UI may synthesize a missing artifact either —
   a missing panel is reported missing.
3. **A new edge function needs a `supabase/config.toml` entry**
   (`verify_jwt = false`) or the gateway returns 401 before your code runs. A
   pre-push hook checks this; `bash scripts/check-config-toml.sh` audits it.
4. **Edge functions deploy separately from the droplet.**
   `deploy-production.yml` does not ship them — `deploy-edge-functions.yml`
   does. Check both halves before calling a SHA deployed, and read the deployed
   body back rather than trusting a green Actions run.

---

## 6. ACCEPTANCE

Not a green suite. **One fresh run, inspected in pixels**, per RULE 0.32's
standard and the repeated lesson that receipts have lied twice on this project:

- [ ] customer photos in → an accepted master
- [ ] six panels cut deterministically at GENIE dims + 5" bleed
- [ ] seven 3D proofs, each bound to its own surface's panel by hash
- [ ] 2D production proof
- [ ] human QC → stamp → ZIP
- [ ] WrapBox (blocked on §4's copy failure until that is fixed)
- [ ] every artifact bound to one `generationId` / DesignID / `atlasRevisionId`
- [ ] **open the exported panels before calling the run good** — do not report
      status from receipts

---

## 7. WHAT THE A.T.L.A.S. SIDE IS DOING, SO THE TWO DO NOT COLLIDE

As of 2026-09-16, deployed `eccc7393`, flags verified on the deploy log:

```
DESIGNPRO_ATLAS_TOPOLOGY=six-surface   DESIGNPRO_ATLAS_FIELD_FIRST=off
DESIGNPRO_ATLAS_CALL1_GRAPH=on         DESIGNPRO_ATLAS_PANEL_FINISH=off
```

- A.T.L.A.S. is on the **six-surface** contract (no coordinate table, passenger
  authored rather than mirrored).
- The cut-out fill is now a feathered clone with contour dilation, versioned as
  `FILL_CONTRACT_V2`; revisions rebuild under the contract they recorded.
- `docs/ATLAS-LAYERED-CALL1-CONTRACT.md` is a locked contract with **no code**
  behind it. Do not implement it from this brief.

If RecreatePro needs a change to Call 1, the panel cut, `source.verify` or any
shared runtime file, **say so rather than making it** — those are being worked
concurrently.
