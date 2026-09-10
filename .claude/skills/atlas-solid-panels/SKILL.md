---
name: atlas-solid-panels
description: The A.T.L.A.S. tire-hole rule and how to work under it. Load before touching Call 1 conditioning, the master gates, cut-out fill, panel extraction, or before judging any A.T.L.A.S. master or panel. Owner ruling; do not re-derive it.
---

# A.T.L.A.S. panels are solid rectangles. The installer cuts the holes.

Owner (Trish): *"The biggest issue is the holes for tires. Why do I need to
keep explaining this?"* This skill exists so nobody has to. Read it before
any work on Call 1, the master gates, the cut-out fill, panel extraction, or
before saying an A.T.L.A.S. output is good.

## The rule, in one paragraph

An A.T.L.A.S. surface (Driver, Passenger, Hood, Roof, Front, Rear) is ONE
CONTINUOUS RECTANGULAR SHEET OF PRINTED VINYL BEFORE INSTALLATION. The
artwork prints straight through the place where a wheel opening, window,
door glass, light, handle, seam, bumper or bed opening will later sit. The
installer lays the solid sheet on the vehicle and cuts the opening out of it
during installation. A hole in the master prints as a hole in the vinyl, and
there is nothing to cut. **The vehicle is where the media goes; it is not
what the media looks like.** (CLAUDE.md RULE 0.15, RULE 0.28, RULE 0.32.)

So, for every surface, the acceptance contract is:

> SIX CONTINUOUS RECTANGULAR ARTWORK REGIONS, EDGE TO EDGE, WITH NO
> MISSING-ARTWORK FIELDS OR VEHICLE-ANATOMY CONTOURS.

A missing-artwork field is a defect whatever colour it is: black disc,
grey surround, white margin, plain mount. A flank drawn as a side profile
with wheel arches is a failed master even when the arch is filled with flat
colour. A panel name or caption painted into the artwork is a failed master.

## What this means for each kind of work

**Call 1 conditioning (the prompt).** State what the output IS in terms
that contain no vehicle: printed artwork, a roll of vinyl laid flat, the
print before anything is cut. Never add wheel-well, tire, window or body
negatives ("no tire cutouts", "do not draw wheels"): Gemini over-indexes on
the forbidden noun and draws it. Measured, not theory: harness v4 of test 10
(run `33650898106`) added exactly one three-word negative, "No tire
cutouts.", and regressed to full body pieces with larger tire cutouts. Do
not rewrite the creative assembly above the tail to chase a hole (RULE 0.1).
Do not hand the model normalized coordinates, fractions, thirds, "areas" or
positional rows: every one of those was painted into the artwork (v24
thirds as framed passages; v2/v25 coordinate rows as numerals; test 6's
labels came back as text).

**Which Call-1 configuration draws holes.** Every six-surface request on
record (fifteen variants, `docs/ATLAS-CALL1-*.md`, `docs/ab/`) drew vehicle
anatomy into at least one flank. The one-field request (RULE 0.33,
`designpro.atlas-field-prompt.v3`, `runtime/atlas-field-territories.cjs`)
has drawn no wheel arch, silhouette or body line in 17 of 18 real draws
(`33659500846`, `34425798511` ×4, `34430841234` ×4, `34441561338` ×4,
`34539589338` arm A ×4; the one exception, A3 of that run, is a hood-shaped
piece on a blue surround that every gate passed). That is the measured
difference between the two branches. Its costs are two different defects:
with no positional language the code cut can slice lettering across a
territory boundary (2 of 4 in `34441561338`, 3 of 5 in `34539589338`), and
"on one square 4K image ... seen straight on" is sometimes read as a print
OBJECT in a scene: a mounted square, a framed square, a photographed roll
(`34539589338`: 5 of 12 across all arms). Do not "fix" either by adding
positional text or a negative; the mount is a gate item (the border-ring
telemetry sees a flat-colour mount, not a busy frame), and which branch is
primary is an owner decision.

**A vehicle-shaped example is never a model input.** Test 14 sent the
Houdini Huracán design layout as the only image beside the v3 tail: 0 of 4
usable, the Urus drawn from above with its doors spread, a hood-shaped piece
with seam lines, a mounted print and a photographed roll. The Lamborghini
sheet is the right picture for PanelPro to SHOW a human as a code-composed
unroll of the accepted field; shown to Gemini it is reproduced as an object.

**The gates (`runtime/atlas-master-qc.cjs`).** They are colour-conditional
proxies, not the contract. `holeAt` is near-black-or-transparent
(`FLAT_BLACK_CHANNEL_MAX = 24`); `edgeHoleRatio > 0.35` on a bright-majority
zone is blocking (a silhouette on a surround); a concentrated near-black
component ≥ 0.25% of a bright zone is a non-blocking "cut-out". Two things
follow. A hole that is grey, white, pale or any colour but near-black passes
every gate (2026-09-02 `5d727ea9`: a filled disc at rgb(25,19,23) survived
with 22 px flagged). And a legitimately dark patch inside a photograph can be
convicted as a wheel hole (`34441561338` F1: the stone wall behind the
customer's facial photo on the hood, 3.6% component, non-blocking). Read a
gate result with that in mind; never relax a threshold to get a run through,
and never call a gate pass "no holes" without looking at the image.

**Repair (`runtime/atlas-cutout-fill.cjs`).** A convicted cut-out is filled
deterministically from its own border and the repaired sheet becomes the
accepted master after re-validation. Fill is a safeguard for small genuine
defects. It cannot recreate artwork Gemini never drew, and turning a hole
into nearly-black pixels is not repair. Never re-roll for a cut-out. A large
missing-artwork field fails closed.

**Judging output.** Look at the raw master AND the six cut panels, at full
size. The proof projections mask the master to the painted body, so a hole
is invisible in every 3D proof and only becomes real at the panel cut. A
beautiful seven-view set proves nothing about the panels. The 911 Turbo
master `2165a36c7f52738b` reached "Master QC passed", 6/6 promoted, with a
black wheel disc on both flanks: that is the failure this skill is about.

## Checklist before claiming an A.T.L.A.S. is good

- [ ] Every one of the six panels is artwork corner to corner at full size.
- [ ] No wheel arch, disc, silhouette, door or window shape, body line, seam or bumper contour in any panel, in any colour.
- [ ] No plain surround, margin, frame, mount or gutter inside any panel.
- [ ] No panel name, caption, numeral, ruler or coordinate painted anywhere.
- [ ] Lettering whole and legible inside the panel that carries it; nothing sliced at a cut.
- [ ] The gate receipt is reported with the numbers, and the image was looked at anyway.

## Where the rule lives

CLAUDE.md: RULE 0.15 (solid rectangle, installer cuts), RULE 0.28 (filled
edge to edge, no body lines), RULE 0.32 (printed media, not a vehicle; the
acceptance contract; do not add negatives or relax thresholds), RULE 0.33
(one-field product, code-only territories). Locks:
`tests/atlas-master-qc.test.mjs`, `tests/atlas-cutout-fill.test.mjs`,
`tests/atlas-clean-authoring-contract.test.mjs`,
`tests/atlas-one-field-call1.test.mjs`, `tests/atlas-output-class-gate.test.mjs`.
