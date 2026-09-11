# Test 17 — the 2026-08-22 Call-1 request, verbatim, on today's model (run `34615923338`)

Owner (Trish, 2026-09-11), holding the labeled Flamingo Pools sheet: *"It was
working, now it's code spaghetti."*

## 1. What "it was working" actually was

The sheet is generation `5b2eb96c`, authored 2026-08-22 05:53Z by the runtime
at commit `0b8ddf99` (prompt `designpro-flat-first-atlas-20260822.v2`). The
copy the owner holds is her own labeled teaching proof, retouched. The raw
accepted master, measured read-only (run `34615226749`,
`docs/ab/v2-flamingo-5b2eb96c-accepted-master-raw.jpg`):

| surface | largest dark shape | non-artwork (colour-blind) | seen |
|---|---|---|---|
| driver | 4.71% | 10.7% | two black half-discs at the wheel positions, door seam, window outline, handle |
| passenger | 4.74% | 10.7% | same |
| hood / roof / front / rear | 0.27% / 0 / 0 / 0 | 2.8% / 17.9% / 30.2% / 22.4% | cohesive, filled |

So the Aug 22 master was one pass, cohesive, and it carried the wheel discs
and body lines that this whole month has been about. The defect was never
"the design"; it was two discs, which is a fill problem.

**Two CLAUDE.md claims were false.** "v2's prompt text is not in this
repository" and "flat-first-atlas.cjs was created at v4" were written from a
shallow clone. The v2 module exists at `0b8ddf99` and is vendored
byte-for-byte under `scripts/fixtures/atlas-v2-0b8ddf99/` (hashes in
`MANIFEST.json`), with the stored manifest and request input of `5b2eb96c`
(`flamingo-5b2eb96c.json`, canonical manifest hash matches the row).

## 2. The Aug 22 request, exactly

`generateOrReuseFlatAtlas` v2 sent, in this order, one call, 1:1, 4K, no
temperature, no gate of any kind:

1. the deterministic guide PNG (grey rounded rectangles on #111 with a
   PASSENGER / REAR / ROOF / HOOD / FRONT / DRIVER legend in the margin);
2. `atlasPrompt`: topology lock, zone map in pixels, output cleanliness, the
   paired-lesson and reference-firewall paragraphs, then the v2
   `buildFlatDesignIQDirection` creative direction (5,532 chars total);
3. the Houdini flattened top-view and its finished 3D proof, as a
   "paired flat-to-finished lesson";
4. customer logo and references (none on Flamingo).

Test 17 (`scripts/atlas-v2-parity-ab.mjs`, workflow `17-v2-parity`) executes
the vendored modules on the stored guide bytes (the vendored renderer
reproduces them byte for byte) and the stored manifest, and sends that request
four times to `gemini-3-pro-image`. The only variable that cannot be held is
the model's weights today.

## 3. Result: 1 of 4

| draw | time | what came back | output class | gate |
|---|---|---|---|---|
| 1 | 32 s | a die-cut SEDAN template on a grey board, "Guide Layout" caption, artwork inside vehicle-shaped pieces | vehicle_depiction | pass (the holes are grey, not black) |
| 2 | 40 s | six body-shaped pieces (hood, roof, front, rear, two van sides with wheel arches) on a checkerboard, each captioned | vehicle_depiction | REFUSE, 6 blocking |
| 3 | 41 s | two van side profiles with wheel arches on black, a photo and a roof panel | vehicle_depiction | cut-outs on four surfaces, edge hole 57% driver |
| 4 | 43 s | **the guide layout followed**: two tall flanks, four centre rectangles, one cohesive pool design, flanks with photo plus brand band, no wheel disc | flat_atlas | pass, 0 cut-outs |

Previews: `docs/ab/v2-parity-34615923338-draw-N-raw-1600.jpg`; the good draw's
driver and passenger crops `…-draw-4-panel-{driver,passenger}-1600.jpg`.

## 4. Reading

1. **The Aug 22 recipe is not reproducible on today's model.** The identical
   request that produced the owner's best sheet now draws a vehicle 3 times
   in 4. Aug 22 was n=1, and it was the good quarter.
2. **This is the same finding as every six-surface measurement since:** a
   layout shown to the model becomes a vehicle. The rate here (25% usable) is
   better than the labeled Flamingo teaching proof (0 of 17) and worse than
   the one-field contract (17 of 18 without body lines).
3. **Draw 4 is what the owner wants**, and it is worth keeping as the
   reference for what a six-surface success looks like: rotated flanks
   composed for the flank, centre surfaces each their own composition, no
   disc. At 1 in 4 it cannot be the product call.
4. **The two things the good draws still need are the same on every shape:**
   a masked fill for discs when they appear (test 16, 3 of 4) and gates that
   flag for PanelPro instead of ending the run.

## 5. Where the code went

| | 2026-08-22 | 2026-09-11 branch |
|---|---|---|
| Call-1 runtime module | 1,079 lines | 4,037 |
| ATLAS runtime modules | 4 | 18 (8,822 lines) |
| Call-1 prompt versions shipped | v2 | 27 distinct in 20 days |
| commits to `runtime/flat-first-atlas.cjs` since Aug 22 | 0 | 84 |
| gates on the master | none | cut-out, edge-hole, output class, template leak, post-repair re-validation |
| CLAUDE.md | short | 2,237 lines, 38 sections, several superseding each other |

Nothing in this document changes code.
