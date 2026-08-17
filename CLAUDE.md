# CLAUDE.md — designproai-os

## 🎯 RULE 0.1 — TWO SEPARATE GOLD STANDARDS. DO NOT MIX THEM. (Trish 2026-08-17)

Design quality and output-pipeline correctness are judged against **different
references**. Conflating them is how a good hero render got read as "the
pipeline works", and how a working July-24 pipeline got read as "the designs
are fine".

| Layer | Gold standard | Judge |
|---|---|---|
| **Design quality / generation behaviour** | the recent **distressed Martini Porsche** job | is the design language, studio consistency and creative quality acceptable |
| **Output / production pipeline** | the **July 24** working state, `docs/LAST-WORKING-STATE-2026-07-24.md` | does the chain still produce the artifacts it produced then |

**Do not use the Porsche to infer whether the output pipeline works. Do not use
July 24 to judge current design-generation quality.**

The July-24 flow is a **regression target**, not a redesign brief:

> design approved → automatic 2D Production Proof → six correct production
> sides → RevisionStudio paired 3D render + 2D production panel per side →
> Production Layers → production pack / output path.

**If July 24 proves the architecture already worked, do not redesign it.**
Identify the smallest wiring/contract difference between then and now, and
replace only components proven defective.

### Judge the seven-view run at the artifact level, not "looks good"

A visual impression cannot tell you whether a weak design means the port is
incomplete or the inputs were empty. Record, for all seven views:

`prompt hash · prompt length · model · studio contract version ·
view-angle contract version · structured inputs actually populated ·
whether branding/phone/logo fields were present · retries · image hash`

Then the diagnosis is mechanical rather than aesthetic:

- **Quality below the Porsche baseline** → parity-diff against that exact
  stack before changing any creative logic. A short prompt or unpopulated
  structured inputs means the port or the caller is incomplete; it never
  means A.C.E. needs new creative direction.
- **Individual quality passes but cross-view identity drifts** → port
  `generate-color-render` only. Nothing else.

**Do not touch Calls 8+ during that determination.**

Once the seven-view layer is proven, switch models back to July-24 regression
for output. The question there is not "how should the pipeline work" — it is
**"what exact wiring or state difference stops today's system behaving like
July 24?"** Keeping the front-half and back-half investigations separate is
what stops the output path being treated as greenfield again.

**Where the Porsche's quality came from.** It was produced by the live
RestylePro stack — `design-panel-ai-generate` with `_shared/studio-os.ts` and
`_shared/view-angles-os.ts`. That is exactly the stack ported into
`runtime/designiq-prompt.cjs`, `runtime/studio-os.cjs` and
`runtime/view-angles.cjs`. So the design-quality baseline and the port target
are the same thing; a design that does not reach Porsche quality means the
port is incomplete, not that a new creative approach is needed.

## ⛔ RULE 0 — OPTIMIZE FOR BEHAVIORAL PARITY, NOT ARCHITECTURE (Trish 2026-08-17)

**The screenshots in `docs/LAST-WORKING-STATE-2026-07-24.md` are the spec.**
The question is not "what is the elegant architecture?" — it is "how does the
app behave like the working product again?" Sessions burned weeks debating
design masters, surface masters, proof regions, synthetic masters and
view-vs-origin philosophy while the product behaviour stayed absent.

**Stop archaeology. Do not propose alternate manufacturing models. Do not
redesign the product.**

The operating invariant — for each of the six surfaces the system must produce
AND show: (1) an approved side proof, (2) a matched print panel, (3) a composed
2D proof sheet, (4) all six side outputs visible in the UI. The PRINT PANEL is
deterministically derived for **that same side** at GENIE dimensions with 5"
bleed — no AI re-render for manufacturing, no cross-side reuse, and passenger
mirror is an explicit operator action, never pipeline default.

Full spec, acceptance criteria, measured starting position, and the A/B session
split: **`docs/BEHAVIORAL-SPEC.md`.**

## 🔒 RULE 0.25 — DESIGNID COMPLETION CONTRACT (Trish 2026-08-17, verbatim)

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

**One DesignID owns Calls 1–8.** The customer-approved DesignID/revision is
frozen after Call 8; everything after it is deterministic manufacturing of that
exact design. **No second design generation after approval. No independent
manufacturing artwork. No reinterpreting the brief downstream.**

Design cycle: Calls 1–7 create the design and all locked-angle customer views
under one DesignIQ identity → Call 8 completes the 2D Production Proof for that
accepted DesignID/revision using the same approved state and GENIE geometry.
**At that point design work is complete.** Then manufacturing:

| Call | Produces |
|---|---|
| **9** | the six extracted **branded** production panels, at GENIE geometry + 5" bleed, independent immutable hashes — this is the original production artwork, and it is never mutated again |
| **10** | logo asset registration/separation for that accepted design |
| **11** | **duplicate** the six branded panels, remove the **logos** from the **duplicates only**, and push those six `qc-panel` duplicates to PanelProStudio for human sizing/template QC |

**The hard order: Design → Extract → Separate/Register logos → Duplicate +
de-logo → PanelPro QC → Topaz → Final outputs → ZIP → WrapBox.** Topaz upscales
the *approved* panels after human/template QC passes on the de-logoed
duplicates. **No Topaz before PanelPro. No mutation of the Call 9 branded
panels, ever.**

The runtime's frozen `STAGES` list already puts `await_panelpro_preflight_qc`
before `enhance.upscale`, so that constraint holds today — do not reorder it.
Call 11 inserts between `logos.extract` and `await_panelpro_preflight_qc`.

**Two sets exist on purpose:** the branded extracted panels are the untouched
production artwork; the de-logoed duplicates are the working QC/template
validation set. **Call 11 may never overwrite or replace the branded production
panel set.**

### CALL 11 — DE-LOGO DUPLICATE SET (owner contract, verbatim)

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

The runtime today emits no Call 11 and no duplicate stage, so **this is a real
gap against the intended product behaviour, not a numbering quibble.**

**OWNER DECISIONS — BLOCKERS CLOSED (2026-08-17). No further architecture
decision is required; implement by matching the proven RestylePro behavior.**

1. **Do not add Generation-side placement geometry** merely to implement Call
   11 — that is another seam redesign. Recover the proven RestylePro
   logo-removal/detection behavior and apply it to **Call 11 QC duplicates
   only**. Its constrained AI/logo detection **is allowed here**, because the
   output is a non-authoritative QC instrument, never production artwork.
2. **Call 11 removes logos.** A.C.E.-authored company name / contact / type
   treatment **may remain** — a phone number on a QC duplicate does not defeat
   a sizing check. **Do not expand Call 11 into general lettering/text
   removal.**
3. **`qc-panel` artifact kind approved.** Preserve the exactly-six panel
   invariant **unchanged** — never relax that assertion to make room.
4. Call 11 sits between Call 10 and `await_panelpro_preflight_qc`.
5. Topaz stays after PanelPro preflight and runs on the **authoritative branded
   production path**, never the QC derivatives.

Each `qc-panel` keeps its canonical `surface_key` and its source Call 9 hash,
and may never enter Topaz/output/ZIP as production artwork. The exact functions
to port (`locateBrandingElements`, `collapseContainedBrandingElements`,
`strictGeminiBox2d` in `restylepro-os` `worker/index.js`) and the dilation /
clamp / honest-no-op pattern that goes with them: `docs/BEHAVIORAL-SPEC.md`.

### 6A — do not fabricate separability that does not exist

**There is no authoritative pre-branding base artwork, and no session may
synthesize one.** Calls 1–8 emit a single composited raster per surface
(`proof.build:455`, `role: canonical-production-surface`), Call 9 consumes
those exact bytes (`panels.build:513`, *"Consume, never cut"*), and the
revision snapshot carries no base-artwork field. Do not erase, inpaint,
regenerate, pixel-lift, approximate a clean background, or reclassify baked-in
artwork as an overlay after the fact. That is a frozen-seam violation, not a
Manufacturing workaround.

This is a standing prohibition, not an open question. **Call 11's `qc-panel`
duplicates are not that base** — they are derived downstream from the immutable
branded Call 9 panels, are non-authoritative, are never printed, and are never
Topaz/output/ZIP inputs. They must never be relabelled as production artwork,
promoted into the output set, or allowed to overwrite Call 9.

## 🧊 RULE 0.5 — THE GENERATION ↔ MANUFACTURING SEAM IS FROZEN (Trish 2026-08-17)

Generation owns producing the approved per-side artifacts. Manufacturing/UI
owns consuming them and binding them to the production board and the
downstream deterministic flow.

**Neither session may unilaterally change the shape, naming, identity, storage
contract, or semantics of the approved side-render interface.** Manufacturing
adapts to the existing contract instead of reshaping generation output;
Generation preserves it instead of changing it for UI convenience.

**If you conclude the seam must change: STOP and report the proposed contract
change to the owner.** Do not coordinate a silent change with the other
session. Any seam change is an owner-level decision.

Frozen, by real name: `SURFACE_KEYS` / `surface_key` · content-addressed
`storagePath` in private `wrap-files` (never a URL) · sha256 `contentHash` ·
`revisionId` embedded in the path · receipt kind + `receipt_hash` ·
`source.verify`'s exactly-two-proofs / exactly-six-distinct-panels check, which
is what makes implicit mirroring impossible.

**Geometry is NOT on this seam** — dimensions resolve from the vehicle at
`manifest.resolve` via the GENIE manifest. Generation must not emit dimensions.

Enforcement points, the full frozen list, and what counts as a breaking change:
**`docs/SEAM-FREEZE.md`.**

## ⛔ RULE 1 — RESTYLEPRO IS THE REFERENCE IMPLEMENTATION. RECOVER BEFORE YOU INVENT.

**Applies to every session in this repository.** If a capability worked in
`Tdill1980/restylepro-os`, find that implementation and reuse it. Do not design
a new one.

Use restylepro-os as the behavioural and code reference for the last working
per-side manufacturing path. For every post-approval stage you touch here,
**first locate the corresponding proven implementation in restylepro-os and
compare them side by side**, then port the smallest proven behaviour that
closes the gap.

**Do not redesign** — port as-is:
per-side source binding · `proofRegion` provenance · `brandedMaster` /
`cleanMaster` relationships · deterministic side identity · GENIE geometry ·
logo separation · PanelPro handoff.

**Adapt only what the standalone boundary actually changes:**
persistence · auth · CAS/hash storage · durable stage execution · droplet and
runtime plumbing.

**Before writing code**, name the exact RestylePro file and function you are
using as the reference. If the standalone version differs, explain the delta
before you change it. If no RestylePro counterpart exists, say so explicitly —
that is what licenses new design, and it should be rare in the post-approval
half.

**Do not restore old infrastructure wholesale. Do restore the working logic.**

The goal is **working restylepro-os production behaviour inside the new
designproai-os operating-system contracts** — not new manufacturing behaviour
invented again.

Per-stage reference map (`stage_key` → RestylePro file/function), the frozen
list, and the one documented exception:
**`docs/RESTYLEPRO-REFERENCE-RULE.md`. Read it before touching a
post-approval stage.**

## Where things are

| | |
|---|---|
| Required behaviour + acceptance criteria + session split | `docs/BEHAVIORAL-SPEC.md` |
| The frozen cross-session seam | `docs/SEAM-FREEZE.md` |
| What the working system produced (the spec, in screenshots) | `docs/LAST-WORKING-STATE-2026-07-24.md` |
| Post-approval stage dispatch | `runtime/designpro-standalone-claimant.cjs` |
| Calls 1–7 port scope and the passenger-mirror exception | `docs/CALLS-1-7-PORT-SCOPE.md` |
| What ships first and what is unproven | `docs/GO-LIVE-READINESS.md` |
| Reference checkout | `restylepro-os` alongside this repo (clone it if absent) |
