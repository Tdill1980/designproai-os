# Test 13 — panel extend from the design layout (2021 Porsche 911 turbo)

Design layout `atlas-call1/737dcc5b-365f-4cba-98c5-306fcaa5f7e9.jpg` (4096×4096). Model `gemini-3.1-flash-image`, one edit turn per surface, 2K.

| surface | aspect | returned | gate | edgeHole | largest dark shape | colour-blind non-artwork (whole / trim) | border artwork | output class | time |
|---|---|---|---|---|---|---|---|---|---|
| driver | 4:1 | 4128×1024 | pass | 0 | 0.0001 | 49.1% / 56.9% | 82.5% | vehicle_depiction | 24.7s |
| hood | 4:3 | 2400×1792 | pass | 0 | 0.0097 | 48.8% / 59.9% | 62.6% | vehicle_depiction | 27.5s |

Owner acceptance: a flattened-topology design of a flattened vehicle, meaning no body lines. The eye decides; the numbers are telemetry.

## Edit-turn text (driver)

```text
The provided image is this wrap design pressed flat onto the 2021 Porsche 911 turbo: the design layout.
Output the DRIVER SIDE of that same wrap as it looks on the vinyl roll before installation: the whole output image IS the driver side print, filled with artwork from edge to edge on all four sides, seen straight on and flat.
Carry over exactly the artwork that covers the driver side in the design layout, at the same placement, colours, lettering and wear, and continue the stripes, textures and colours without interruption through every part of the image and off its edges, so the print is solid artwork corner to corner. The artwork is the only thing in the image.
Keep everything about the design exactly as in the provided image; change nothing else.
```
