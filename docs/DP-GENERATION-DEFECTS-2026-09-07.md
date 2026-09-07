# DesignPro generation defects — owner review, 2026-09-07

Seven defects the owner named after reviewing live generations. One entry each,
so they can be fixed surgically rather than as one "generation is broken" push.

**Reference runs.** `e3ade856-4837-41e9-bf5c-5d342516a385` (2026-09-07 06:42Z,
2022 Ford Transit Connect, "Arctic Air") is the run under review.
`586abc83-980b-4e36-a8f2-10d7e36cb200` and `63e6629a` (2026-09-04, Toyota Prius)
and `a503b91b` / `634c5b28` / `58565bd7` (2026-09-06, F250) are comparisons.

**Evidence levels.** Every claim below is one of:

| level | means |
|---|---|
| **MEASURED** | read this session from the production database or the source at `origin/main` |
| **OWNER-OBSERVED** | the owner saw it on screen; not independently reproduced |
| **UNVERIFIED** | stated as a cause but not yet demonstrated |

Nothing here is inferred from a prior session's notes. Where a cause is not
established, it says so instead of guessing.

---

## Summary

| # | Defect | Root cause | Status |
|---|---|---|---|
| 1 | Brief not followed (missing requested photo) | not established — same brief succeeded on an earlier run | **OPEN** |
| 2 | Passenger side missing from the view set | proof refused twice; authority crop did not read as passenger artwork | **CAUSE FOUND · MERGED, NOT DEPLOYED** |
| 3 | Passenger design differs from driver | passenger authored independently; drift, not intent | **FIX MERGED, NOT DEPLOYED** |
| 4 | Same logo re-created across generations | model convergence — no reuse, and nothing tracks prior logos | **OPEN — no mechanism exists** |
| 5 | Professional designer persona must hold | not established as lost; needs a measurement | **OPEN** |
| 6 | Panels must display correctly in RevisionStudioIQ | artifacts present; UI never verified by eye | **OPEN — data proven, screen unproven** |
| 7 | Panels must display correctly in PanelPro Studio | same | **OPEN — same** |

---

## 1. Design degradation — the brief was not followed

**Owner:** the design did not do what the prompt asked.

The brief, verbatim:

> *"Arctic Air HVAC company wrap create a design and a yeti mascot in a new logo
> 24/7 service and in 3/ sides and rear add a photo of a arctic air tech
> installing an ac"*

| asked | delivered on `e3ade856` | |
|---|---|---|
| Arctic Air HVAC wrap | yes | MEASURED (master accepted, QC passed) |
| yeti mascot | yes | OWNER-OBSERVED |
| new logo | yes | OWNER-OBSERVED |
| "24/7 service" | yes | OWNER-OBSERVED |
| **photo of a tech installing an AC** | **absent** | OWNER-OBSERVED |
| "3/4 sides" | absent | MEASURED — impossible by contract, see below |

**What is established.** The same brief on `586abc83` (2026-09-04) DID include
the technician photograph. Same words, same photo-realism path, different
outcome. So the capability is present and this run dropped it — run-to-run
variance in Call 1, not a missing feature.

**"3/4 sides" cannot be honoured and never could.** The seven camera angles are
a frozen contract (`CALLS_1_7_VIEW_PLAN`, `acceptedCalls1To7ViewPlan` throws
`generation_contract_drift` on any other plan). A three-quarter view is not one
of them. This is a **product gap, not a defect**: the brief accepts a request
the system will silently ignore. Either the intake should say so, or the ask
should be routed to the close-up view.

**Not yet established:** why the photograph was dropped. `briefWantsPhoto()`
keys on explicit words and "photo" is present, so the switch should have fired.
Nobody has compared the two runs' assembled prompts.

**Surgical next step.** Diff the two Call-1 requests (`586abc83` vs
`e3ade856`) — same fixture, one carries the photo and one does not. That is a
two-run comparison, not an investigation.

---

## 2. Passenger side missing from the view set

**Owner:** only six view tabs; "Finish all 7 design views to order" blocks the order.

**MEASURED.** `designpro_generation_slots` for `e3ade856`:

| view | state | provider calls | rejections |
|---|---|---|---|
| side, hood_detail, front, rear, roof, close-up | `accepted` | — | 0 |
| **passenger-side** | **`failed`** | **2** | **2** |

`reason = provider_attempts_exhausted`. Both attempts were refused by the proof
inspector on `atlasContinuityContract` — the one contract that can block:

> *"Artwork from the authority crop (**Hood**) is not present on the vehicle's
> passenger side. The vehicle displays artwork from a different master zone."*
>
> *"The candidate proof shows a side view of a van with a large yeti graphic and
> 'Arctic Air' text… The authority crop shows a **hood** g[raphic]"*

**The render was fine. What it was measured against was not passenger artwork.**

**Not a wiring fault.** `viewAuthorityFor` hard-throws
(`flat_atlas_view_authority_identity_mismatch`) if a view's authority is not its
own surface, and it did not throw. So the passenger PANEL was correctly
addressed; its CONTENT did not read as a passenger flank. That points at the
master's passenger territory, which is defect 3.

**The run was right to complete.** An A.T.L.A.S. run with at least one accepted
view finishes as a PARTIAL set (owner ruling 2026-08-27) — one refused proof may
not destroy six good panels. The receipt recorded `callsCompleted: 6` and
`refusedViews: [{passenger-side, provider_attempts_exhausted}]` honestly. **The
system did not claim success.** What it could not do was tell the owner which
view was refused or why — fixed on branch `claude/atlas-proof-bed-coverage`
(`236e9d74`, `c67023ae`), not merged.

---

## 3. Passenger design differs from driver

**Owner ruling, 2026-09-07:** *"We need a mirrored version for passenger of driver."*

**MEASURED.** `passengerMirrorMae` — 0 would be a perfect mirror:

| run | MAE | flanks |
|---|---|---|
| `a503b91b` (09-06, clean) | 0.089 | near-twins |
| `e3ade856` (09-07) | **0.139** | visibly different |

Passenger has been authored as its own region since the 2026-08-27 ruling, and
`passengerMirrorMae` was deliberately excluded from the blocking set. The result
in practice was drift rather than intent — and on `e3ade856` a passenger
territory that did not compose as a flank at all, which is what refused its
proof (defect 2).

**FIX WRITTEN, NOT COMMITTED.** After acceptance — never inside the authoring
loop — the driver flank is mirrored into the passenger territory in code, and
the driver's brand bands are re-dropped **un-flipped** so lettering reads forward
on both sides. Declines and keeps the authored passenger when the lettering
cannot be located, so the worst case is today's behaviour. Every run records
`passengerSource: "mirrored-from-driver" | "authored-passenger-region"` with a
decline reason. Full suite 729/729.

**This should also close defect 2**: a mirrored passenger territory is real
flank artwork, so its proof has a coherent authority to match.

---

## 4. The same logo is re-created across generations

**Owner:** DesignPro must never produce the same logo again, even for the same
company name or a similar prompt.

**MEASURED — the obvious suspect is ruled out.** Four Arctic Air generations:

| gen | date | vehicle | prompt hash | master hash |
|---|---|---|---|---|
| `e3ade856` | 09-07 | Transit Connect | `67a89f26…` | `27088315…` |
| `3b9b3209` | 09-06 | Transit Connect | — | none (no master) |
| `63e6629a` | 09-04 | Prius | `1433f9e0…` | `10779204…` |
| `586abc83` | 09-04 | Prius | `0a96ed75…` | `de71a67c…` |

**Every prompt hash differs; every master hash differs.** No artifact was
reused. The reuse fence (`assertAtlasReuseContract`) is scoped to a single
`requestId` and cannot serve one generation's master to another. So this is
**not a caching bug, and clearing anything will not fix it.**

**What it actually is.** The same company name, the same industry and a brief
that explicitly says *"a yeti mascot in a new logo"* converge the model on the
same answer: a yeti with a wrench in an ice-shield lockup. The model is
following the brief. What the owner wants is **originality across generations**,
and **nothing in the system records what was drawn before or asks for something
different.**

**No mechanism exists.** There is no per-company logo history, no
already-produced inventory consulted at authoring time, and no diversity
instruction in the Call-1 assembly. `logos.extract` (Call 10) registers logos
*after* the fact and returned an empty inventory on every recent run.

**This is a new capability, not a repair.** Options, cheapest first, none built:

1. **Record what was drawn.** Persist a per-owner/per-company logo signature at
   Call 10 so repetition is at least detectable.
2. **Condition on the history.** Pass prior logo descriptions into Call 1 as
   "produce something different from these". Touches the frozen creative
   assembly — owner-gated under RULE 0.32.
3. **Detect and refuse.** Compare a new logo region against the company's
   history and re-roll on a match. Costs a render and re-introduces re-roll,
   which the standing rules discourage.

**Recommendation: (1) first.** Until repetition is measurable, any fix is
unfalsifiable.

---

## 5. The professional graphic-designer persona must hold

**Owner:** output must stay at senior-designer quality.

**UNVERIFIED — and deliberately so.** No measurement of "persona held" exists.
The persona lives in the deployed Call-1 assembly (`buildDesignIQPrompt` inside
`design-panel-ai-generate`), and the acceptance gates measure **structure**
(opacity, edge holes, cut-outs, output class), never **craft**.

What is MEASURED on `a503b91b`: every structural gate clean, output class
`flat_atlas` at confidence 1.0. What that does **not** say is whether the design
is good.

The advisory semantic reviewer that would speak to craft
(`masterSemanticVerdict`) has read `semantic_qc_advisory_not_run` on **every**
run since at least 09-04.

**Surgical next step.** Decide whether the advisory review should run again as a
recorded, non-blocking judgement. It cannot refuse Call 1 (2026-09-01 ruling)
but it can leave a quality record, which is the only way "the persona slipped"
becomes checkable rather than an impression.

---

## 6 & 7. Panels must display correctly in RevisionStudioIQ and PanelPro Studio

**Owner:** panels must render correctly on both surfaces.

**MEASURED — the data is complete.** For each of `a503b91b`, `634c5b28`,
`58565bd7` the entice pack completed with **13 artifacts**:

```
flat-proof ×1   panel ×6   qc-panel ×6
driver · passenger · hood · roof · front · rear
```

Stages all completed on attempt 1: `revision.freeze` (7 view receipts),
`proof.build` (Call 8, not deferred), `panels.build` (Call 9), `logos.extract`
(Call 10 — empty inventory), `panels.delogo` (Call 11), `pack.verify`,
`pack.activate`. And the fence that would withhold proofs passes:

```
designpro_private.flat_first_atlas_view_set_valid → true   (all three)
live views → 7 / 7
```

**UNVERIFIED — the screen.** Nobody has confirmed the panels RENDER on either
surface. The status board has carried these as OPEN (rows 28, 29) throughout,
and data completeness is not the same as a working UI.

**Two known gaps, both real:**

- **The Logo Pack will be empty.** Call 10 returned `inventory: []` with
  `exactSetVerified: true` — an honest empty, because no customer logo was
  uploaded. Untested: whether it populates when one is.
- **Call 8's text lock was empty** — `companyName`, `phone`, `website` all null,
  `frozenBodyText: []`. The lock is what stops the 2D proof inventing a phone
  number. It was empty because the brief carried those values in prose rather
  than the structured fields.

**Surgical next step.** One generation opened on both surfaces with a logo
uploaded and the structured fields filled, checked by eye. That closes rows 28
and 29 and exercises both gaps at once.

---

## What is fixed already — merged to `main` as `b4b06566` (PR #324)

Merged 2026-09-07, full suite 737/737, `supabase-shadow` replayed the new
migration on a fresh database. **Merged is not deployed**: the migration is
applied by an explicit protected dispatch and the droplet by a separate one, so
until both land the running system still has none of this.

| commit | defect | |
|---|---|---|
| `8b96b2e5` | — | pickup bed-coverage rule now graded on all seven proof views, not roof only |
| `236e9d74` | 2 | the create page names a refused view and its reason |
| `c67023ae` | 2 | RevisionStudioIQ does the same, via an additive DB function + gateway header |
| `f8e94c83` | — | migration-chain counts follow the new migration |
| `acbfffb1` | **3** | the deterministic passenger mirror — Passenger composed from Driver after acceptance, brand bands re-dropped un-flipped |
| `e72b6265` | 3 | that composition executed on real bytes, every decline path exercised as a path |

Defects 1, 4, 5, 6 and 7 are untouched by that merge and remain as stated above.

## Known debt introduced by those commits

`get_designpro_generation_request.failedShots` and the new
`designpro_generation_refused_views` are **two SQL projections of one question**,
and they differ: the new one carries a `NOT EXISTS` guard that skips a slot
which later produced a live view; the old one does not.

**MEASURED 2026-09-07: zero rows in the entire production database can
distinguish them.** No slot anywhere is `state='failed'` while a live view
exists for the same request and view type — `regenerateView` flips the slot to
`accepted` on success, so the guard is defensive and currently inert. The two
projections agree on all real data.

That is why consolidating was not done before the deploy: it means text-patching
`get_designpro_generation_request`, a live function the create page now depends
on, to remove a difference that no row exercises. It should still become one
`designpro_private` helper with two callers — as a pure refactor, with no
behavioural question attached, at a moment when nothing is shipping.
