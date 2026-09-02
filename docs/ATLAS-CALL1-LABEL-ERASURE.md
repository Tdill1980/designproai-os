# Test 6 — the labels do not come from the teaching image

Run [33589628761](https://github.com/Tdill1980/designproai-os/actions/runs/33589628761),
2026-09-02, deployed image `designproai-runtime:fb58f702…`, `gemini-3-pro-image`,
12 image calls + 12 output-class inspections, 6 draws per arm, interleaved.
Capture-only parity first
([33589591064](https://github.com/Tdill1980/designproai-os/actions/runs/33589591064), zero provider calls).

**A** = the owner teaching proof. **B** = the same proof with only the six
printed technical marks erased — `DRIVER SIDE`, `PASSENGER SIDE`, `HOOD`, `ROOF`,
`REAR`, `FRONT`. 26,816 pixels cleared; **0 changed inside any panel, 0 outside a
label box, every label box uniformly field.** All artwork and Flamingo branding
preserved by construction — each label box is proven disjoint from all six panel
rectangles before a pixel is written.

## PRIMARY ENDPOINT — null

**0 of 72 zones edge-to-edge compliant.** No draw of either arm produced six
continuous rectangular artwork regions filled to their authoritative boundaries.

| | worst non-artwork per draw | mean | contour | output class | latency |
|---|---|---|---|---|---|
| **A** | 77.8 · 63.3 · 84.3 · 64.6 · 56.2 · 70.6 % | 69.5% | 0.678 | `flat_atlas` 3 / `vehicle_depiction` 3 | 38.3 s |
| **B** | 92.7 · 55.5 · 48.6 · 59.4 · 63.7 · 42.5 % | 60.4% | 0.590 | `flat_atlas` 4 / `vehicle_depiction` 2 | 36.0 s |

B's mean is lower and its ranges overlap A's completely — **and B contains the
single worst draw of the entire investigation at 92.7% non-artwork.** Cohesion
shows no separation (A 0.0032–0.0769, B 0.0028–0.0931). Per the decision rule
this is null, and nothing changes in production.

## The result that matters is not in the table

**Arm B still prints technical labels.** Every de-labelled draw carries them, and
B6 prints a label that appears NOWHERE in the teaching image:

```
A.T.L.A.S. ARTBOARD      ← invented; not in the example, in either arm
REAR · ROOF · HOOD · FRONT · PASSENGER SIDE · DRIVER SIDE
```

B3 goes further and prints `Roof` twice, on two different panels.

So the leak is not image conditioning. Removing every printed mark from the
example changed nothing about the model's decision to letter the sheet. **The
labels come from the prompt**, which names all six surfaces in its panel list and
uses the phrase "A.T.L.A.S. ARTBOARD" — the exact string B6 rendered — while
instructing, in the same text, *"Set no panel names, surface IDs, legends or
captions anywhere in the artwork."*

The model is reading the surface list as content to draw, and the negative next
to it is not reaching it.

**This clears the teaching image of a defect it was suspected of, and relocates
that defect to the text.** It also settles the confound this test carried: the
proof's `DRIVER`-left / `PASSENGER`-right disagreement with `manifest.zones` was
erased in arm B along with the labels, and the output was unaffected either way.

## Standing after six isolated variables

| variable | result |
|---|---|
| teaching proof's black field | refuted |
| the blank neutral guide | removed the black, not the shape |
| normalized `[0,1]` topology text | inconclusive, then unattributable |
| teaching proof's centre order | null |
| the object-definition clause | null |
| **the teaching proof's printed labels** | **null — and the leak is proven to be textual** |

**0 compliant zones in every draw of all six tests.** Every variable tested so far
has been in the teaching image or one clause of the contract. None is causal.

## Where this points

Two findings now converge on the same place, and it is not the image:

1. The label leak is textual — the model draws the surface list it is given.
2. Test 5 showed panels drawn *smaller than their zones*: rectangles floating in
   a field, artwork not reaching the boundary it was assigned.

Both are consistent with the model reading the request as *"depict six labelled
panels somewhere on a sheet"* rather than *"these six regions ARE the printable
artwork."* That is the scale/extent conditioning question, and after six null
image-side variables it is the one left standing.

No production change. Teaching proof, hash pin, creative blocks, model,
temperature, canvas, GENIE, manifest, extraction, repair and thresholds all
untouched. The production teaching proof was never written.
