# WPW Cut Contour Spec — canonical reference

Source: weprintwraps.com cut-path setup docs + Carley's Illustrator
walkthrough (transcript captured on 2026-05-20).

This is the spec EVERY studio / graphics-pro production pack must
satisfy before it goes to a Roland / Graphtec / Summa plotter.
Treat this file as the source of truth for prompts and validators.

## 1. File structure — three layers, top-to-bottom

```
[Cut    ] — CutContour spot color, hairline 0.25 pt stroke
[Art    ] — CMYK / RGB artwork (the actual printed pixels)
[Bleed  ] — black offset path, 0.1–0.2" outside the cut line
```

The plotter only reads the Cut layer. The print head only renders
the Art + Bleed layers. The bleed layer prevents white substrate
showing through if the blade misregisters by a millimeter.

## 2. Spot color — exact specification

| Property | Value |
|---|---|
| Swatch name | `CutContour` (capital C, capital C — case sensitive) |
| Type | **Spot** (not process / not global) |
| Color mode | CMYK |
| C | 0 % |
| M | 100 % |
| Y | 0 % |
| K | 0 % |
| Stroke weight on cut path | 0.25 pt (hairline) |
| Fill on cut path | None |

The 100 % magenta is what Roland VersaWorks / Graphtec CutStudio /
Summa GoSign look for to route a path to the blade instead of the
print head. The literal swatch name `CutContour` is the matching
key — anything else (cut, CUTCONTOUR, Cut Contour, CutLine) will
get printed as magenta lines and never cut.

## 3. Bleed — how to construct it

```
1. Copy the unified cut path (after Pathfinder → Unite)
2. Paste In Place on the Bleed layer
3. Change fill to black, remove stroke
4. Object → Path → Offset Path
     offset = 0.1" for prints ≤ 13"
     offset = 0.2" for prints > 13"
     joins = Round
```

The bleed is **always solid black** on the WPW workflow because the
edges of the artwork are predominantly dark — black bleed prevents
a visible white ring when the cut is slightly off. If a customer's
artwork has light edges, they need a custom bleed color review.

## 4. Stroke outlining — before unifying paths

Every stroke in the source artwork must be outlined BEFORE running
Pathfinder → Unite:

```
Object → Path → Outline Stroke
```

Without this step, strokes stay as math-defined paths and the unite
operation only merges fills, leaving stray hairlines.

## 5. Manual review triggers

A studio job MUST flag for manual WPW review when ANY of these are
true:

- Any letter or numeral is **< 2 inches** tall in real print size
- Artwork contains intricate / hairline details (< 0.05" stroke width)
- The customer chose a non-black bleed (light-edged artwork)
- Total cut path has > 200 vertices after vectorize (likely needs
  hand simplification)
- Source file was raster-only and vectorize confidence < 0.85

These cases break on a plotter even when the spot color is right.
The frontend surfaces the warning as soon as the trigger is known;
the production-flow QC step blocks dispatch until a human signs off.

## 6. Carley's tutorial — workflow we automate

The Illustrator path Carley demonstrates:

```
1. Three layers: Cut (top), Art (middle), Bleed (bottom)
2. Copy artwork → Edit → Paste In Place on Cut layer
3. Object → Path → Outline Stroke
4. Pathfinder → Unite (single outline)
5. Swatches → New Swatch → "CutContour" / Spot / CMYK / 0,100,0,0
6. Apply to Stroke, set stroke 0.25 pt, remove fill
7. Lock Cut layer
8. On Bleed layer: Paste In Place, change to black fill,
   Object → Path → Offset Path 0.1–0.2" Round
9. Re-show all layer eyeballs before export
```

Our pipeline does steps 1–8 automatically. The customer never
opens Illustrator. The studio canvas IS step 1, the zone draw +
mockup IS step 2, vectorize-it IS steps 3–4, and the production
pack writes steps 5–8 into the output file. The customer just
clicks Generate Cut Contour Pack.

## 7. Output format target

The current SVG output covers the geometry. The full WPW deliverable
is a **PDF** with:

- CMYK color space
- A real `CutContour` spot color definition in the PDF color
  resources dict (not just a path attribute)
- All three layers preserved as PDF Optional Content Groups

That PDF conversion lives in `package-production-files`. Studio
jobs land in panelizer_jobs with `cut_path_svg_url` set and
`concept_json.source = "graphicspro_studio"` — the packager
picks them up and emits the PDF.
