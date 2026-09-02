# Which Call-1 input teaches "vehicle body pieces"?

Audit only. Nothing changed. Read against RULE 0.32: **A.T.L.A.S. is the
continuous printed wrap sheets unwrapped flat, before installation and trimming.**

Four inputs reach Gemini. Two are now ruled out by inspection, two remain.

## Ruled out by inspection

**The teaching proof's panel shapes.** Cropped and read directly: the Flamingo
flank is one continuous rectangle of artwork, edge to edge, with no contour, no
wheel opening, no anatomy of any kind. All six panels are rectangles. The example
is teaching exactly the right object.

**The neutral target guide.** Removed in tests 3 and 4. The black wheel wells went
with it; the contoured die-cut panels did not. It is not the anatomy channel.

## Still live — 1: the flat-master OUTPUT CONTRACT carries both framings at once

Extracted verbatim from the deployed `design-panel-ai-generate` assembly, 1,965
chars. It contains the print-media framing the owner's definition asks for:

> "the same kind of image as a printed poster or a roll of printed vinyl laid flat
> on a table. **It is the artwork by itself, before anything is cut or applied.**"
> … "Every panel is opaque, unbroken and full-bleed to all four edges"

And, in the same block, it also asks for a flattened vehicle:

> "the full wrap laid out FLAT as rectangular print panels on one sheet — **the
> complete flattened panel layout of the vehicle**"
> … "a person walking around **the finished truck** sees one design, not two"
> … "The centre panels carry that same composition across **the truck's top and
> ends**"

"The complete flattened panel layout of the vehicle" is, read plainly, a request
for the vehicle's panels flattened — a body template. That is the artifact Gemini
keeps returning. The contract states the media framing and the anatomy framing as
equals, and the anatomy one comes first and is the more concrete of the two.

An output that flips between the two readings on identical requests — `flat_atlas`
3/3 in one run, `vehicle_depiction` 3/3 an hour later — is what a genuinely
ambiguous instruction produces.

**This is NOT the DesignPanelAI creative intelligence.** Per RULE 0.26 the
assembly executes the real `buildDesignerPrompt` and swaps only the presentation
tail for this flat-master output contract. The creative persona, logo
architecture, commercial depth and translation blocks are upstream of it and
untouched by anything proposed here.

## Still live — 2: the teaching proof's printed labels

`DRIVER SIDE`, `PASSENGER SIDE`, `HOOD`, `ROOF`, `REAR`, `FRONT` are printed in
the example's gutters. They are the only vehicle-anatomy vocabulary inside the
image input, and the identity contract declares them instructional-only
(`labelRule: labels-are-instructional-annotations-only-never-artwork`).

Gemini disagrees. Surface labels are burned into the output artwork in **20 of
the 21 measured draws** — the exception being the one draw that returned a
photoreal truck instead. The prompt tells it not to, in as many words: *"Set no
panel names, surface IDs, legends or captions anywhere in the artwork."* It does
it anyway, every time.

That is a demonstrated leak from this input. Whether it also carries the
body-piece interpretation is untested.

## Proposed next isolated variable — REPORT ONLY, no production edit

Test 5, same harness and discipline as tests 1–4, **6 draws per arm interleaved**
(3 is not enough: the same request returned `flat_atlas` 3/3 and
`vehicle_depiction` 3/3 in two runs an hour apart).

**A** = the deployed request. **B** = identical except one clause of the output
contract is reframed from vehicle anatomy to print media:

```
A   … on one sheet — the complete flattened panel layout of the vehicle.
B   … on one sheet — the complete set of printed vinyl sheets, before installation.
```

One clause. No negative added, no wheel-well language, no threshold touched, no
creative block altered, surface names retained because they carry placement.

Primary endpoint: **six continuous rectangular artwork regions, edge to edge, no
missing-artwork fields, no vehicle-anatomy contours** — measured colour-blind.
Secondary: output class, label contamination, cohesion, latency.

If the reframing does not move it, the labels are next, on the same discipline: a
harness variant with the label glyphs erased and every panel pixel preserved.
